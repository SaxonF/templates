import {
  createContextClient,
  verifyAuth,
} from "npm:@supabase/server@1.1.0/core";
import type { SupabaseClient, User } from "npm:@supabase/supabase-js@2.108.2";

// =============================================================================
// Dual-mode authentication for the MCP server
// =============================================================================
//
// This Edge Function is an OAuth 2.1 *protected resource*; Supabase Auth is the
// authorization server. It accepts bearer tokens in TWO modes:
//
//   1. OAuth client (external MCP clients, e.g. Claude Desktop) — the token
//      carries a `client_id` and MUST be audience-bound to THIS resource (the
//      resource URL appears in `aud`, added by the custom access-token hook in
//      the migrations). Audience binding stops a token minted for some other
//      purpose from being replayed here.
//
//   2. First-party Supabase user JWT (e.g. an in-project agent forwarding the
//      caller's session token) — no `client_id`, no resource-audience binding.
//      Accepting it grants no more than PostgREST already does with the same
//      token. Gate it with MCP_ALLOW_FIRST_PARTY_JWT=false to require OAuth.
//
// Both modes then build a user-scoped Supabase client and confirm the live
// session, so revoked grants and deleted sessions take effect immediately.

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const FUNCTION_PATH = "/functions/v1/mcp-server";
const METADATA_PATH = "/.well-known/oauth-protected-resource";
const REQUIRED_SCOPE = "email";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
};

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type AuthConfig = {
  resourceUrl: string;
  metadataUrl: string;
  resourceName: string;
  authorizationServer: string;
  /** When false, only audience-bound OAuth tokens are accepted. */
  allowFirstPartyJwt: boolean;
};

export type AuthenticatedContext = {
  /** User-scoped Supabase client (the bearer token is already attached). */
  supabase: SupabaseClient;
  /** The raw bearer token. */
  token: string;
  /** The authenticated user (from a live session check). */
  user: User;
  /** The OAuth client_id the token was issued to, or null for first-party JWTs. */
  clientId: string | null;
  /** Verified JWT claims, forwarded to tools (e.g. to set DB request context). */
  claims: Record<string, unknown>;
};

type AuthenticationResult =
  | { ok: true; context: AuthenticatedContext }
  | { ok: false; response: Response };

// -----------------------------------------------------------------------------
// Public URL / config resolution
// -----------------------------------------------------------------------------
//
// OAuth resource and issuer values must be the canonical PUBLIC origin, not the
// internal one the Edge Function sees. We derive it from forwarded headers (or
// explicit env overrides) so discovery advertises URLs clients can actually use.

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/** Read an env var, trimmed and without a trailing slash; null if unset/empty. */
function readTrimmedEnv(name: string): string | null {
  const value = Deno.env.get(name)?.trim();
  return value ? trimTrailingSlash(value) : null;
}

function readTextEnv(name: string, fallback: string): string {
  return Deno.env.get(name)?.trim() || fallback;
}

/** First entry of a comma-separated forwarded header (e.g. X-Forwarded-Host). */
function firstForwardedValue(value: string | null): string | null {
  const first = value?.split(",")[0]?.trim();
  return first || null;
}

function publicRequestOrigin(request: Request): string {
  const internalUrl = new URL(request.url);
  const protocol =
    firstForwardedValue(request.headers.get("x-forwarded-proto")) ??
      internalUrl.protocol.replace(":", "");
  const host = firstForwardedValue(request.headers.get("x-forwarded-host")) ??
    firstForwardedValue(request.headers.get("host")) ??
    internalUrl.host;
  const port = firstForwardedValue(request.headers.get("x-forwarded-port"));

  if (protocol !== "http" && protocol !== "https") return internalUrl.origin;

  try {
    const publicUrl = new URL(`${protocol}://${host}`);
    if (port) publicUrl.port = port;
    return publicUrl.origin;
  } catch {
    return internalUrl.origin;
  }
}

export function getAuthConfig(request: Request): AuthConfig {
  const requestOrigin = publicRequestOrigin(request);
  // Allow explicit overrides (MCP_RESOURCE_URL / MCP_AUTH_ISSUER) for custom
  // domains; otherwise derive both from the public request origin.
  const resourceUrl = readTrimmedEnv("MCP_RESOURCE_URL") ??
    `${requestOrigin}${FUNCTION_PATH}`;
  const authorizationServer = readTrimmedEnv("MCP_AUTH_ISSUER") ??
    `${new URL(resourceUrl).origin}/auth/v1`;
  const allowFirstPartyJwt =
    (Deno.env.get("MCP_ALLOW_FIRST_PARTY_JWT")?.trim().toLowerCase() ??
      "true") !== "false";

  return {
    resourceUrl,
    metadataUrl: `${resourceUrl}${METADATA_PATH}`,
    resourceName: readTextEnv("MCP_SERVER_NAME", "supabase-agent"),
    authorizationServer,
    allowFirstPartyJwt,
  };
}

// -----------------------------------------------------------------------------
// Protected-resource metadata + challenges
// -----------------------------------------------------------------------------

export function isProtectedResourceMetadataRequest(request: Request): boolean {
  return (
    request.method === "GET" &&
    new URL(request.url).pathname.endsWith(METADATA_PATH)
  );
}

export function protectedResourceMetadataResponse(
  config: AuthConfig,
): Response {
  return applyCors(
    Response.json({
      resource: config.resourceUrl,
      resource_name: config.resourceName,
      authorization_servers: [config.authorizationServer],
      scopes_supported: [REQUIRED_SCOPE],
      bearer_methods_supported: ["header"],
    }),
  );
}

/** The WWW-Authenticate value that points clients at the metadata document. */
function challenge(config: AuthConfig): string {
  return `Bearer resource_metadata="${config.metadataUrl}", scope="${REQUIRED_SCOPE}"`;
}

function unauthorized(config: AuthConfig, description: string): Response {
  return Response.json(
    { error: "unauthorized", error_description: description },
    {
      status: 401,
      headers: { "WWW-Authenticate": challenge(config) },
    },
  );
}

// -----------------------------------------------------------------------------
// Authentication
// -----------------------------------------------------------------------------

/** Normalise the `aud` claim (string or array) to a list of strings. */
function audienceValues(audience: unknown): string[] {
  if (typeof audience === "string") return [audience];
  if (Array.isArray(audience)) {
    return audience.filter((value): value is string =>
      typeof value === "string"
    );
  }
  return [];
}

/**
 * Back-compat for client construction: older local stacks only expose
 * SUPABASE_ANON_KEY. If no publishable key is configured, feed the anon key in
 * as the default publishable key. Newer environments set publishable keys
 * directly, and this contributes nothing.
 */
function legacyPublishableKeyOptions():
  | { env: { publishableKeys: { default: string } } }
  | Record<never, never> {
  const legacyKey = Deno.env.get("SUPABASE_ANON_KEY")?.trim();
  const hasPublishableKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ||
    Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");

  if (legacyKey && !hasPublishableKey) {
    return { env: { publishableKeys: { default: legacyKey } } };
  }
  return {};
}

export async function authenticateRequest(
  request: Request,
  config: AuthConfig,
): Promise<AuthenticationResult> {
  // Step 1: verify the bearer token's signature and basic validity.
  const { data: auth, error } = await verifyAuth(request, { auth: "user" });

  if (error) {
    if (error.status >= 500) {
      console.error("Supabase authentication configuration failed", error);
      return {
        ok: false,
        response: Response.json(
          {
            error: "server_error",
            error_description: "Authentication is unavailable",
          },
          { status: 500 },
        ),
      };
    }

    return {
      ok: false,
      response: unauthorized(config, "A valid access token is required"),
    };
  }

  const claims = auth.jwtClaims;
  const audiences = audienceValues(claims?.aud);
  const clientId = typeof claims?.client_id === "string" && claims.client_id
    ? claims.client_id
    : null;

  // Step 2: checks shared by both modes — an authenticated user token.
  if (claims?.role !== "authenticated") {
    return {
      ok: false,
      response: unauthorized(config, "An authenticated user token is required"),
    };
  }
  if (!audiences.includes("authenticated")) {
    return {
      ok: false,
      response: unauthorized(config, "The token audience is invalid"),
    };
  }
  if (typeof claims?.sub !== "string" || !claims.sub) {
    return {
      ok: false,
      response: unauthorized(config, "The token subject is invalid"),
    };
  }

  // Step 3: mode-specific binding.
  if (clientId) {
    // OAuth client: the token must be issued by our authorization server and
    // audience-bound to THIS resource.
    if (claims?.iss !== config.authorizationServer) {
      return {
        ok: false,
        response: unauthorized(config, "The token issuer is invalid"),
      };
    }
    if (!audiences.includes(config.resourceUrl)) {
      return {
        ok: false,
        response: unauthorized(config, "The token audience is invalid"),
      };
    }
  } else if (!config.allowFirstPartyJwt) {
    // First-party JWTs are disabled; require an OAuth client token.
    return {
      ok: false,
      response: unauthorized(config, "An OAuth access token is required"),
    };
  }

  const token = auth.token;
  if (!token) {
    return {
      ok: false,
      response: unauthorized(config, "A bearer token is required"),
    };
  }

  // Step 4: build a user-scoped client that carries the bearer token.
  let supabase: SupabaseClient;
  try {
    supabase = createContextClient({
      auth: { token },
      ...legacyPublishableKeyOptions(),
    });
  } catch (contextError) {
    console.error(
      "Unable to create a user-scoped Supabase client",
      contextError,
    );
    return {
      ok: false,
      response: Response.json(
        {
          error: "server_error",
          error_description: "Database access is unavailable",
        },
        { status: 500 },
      ),
    };
  }

  // Step 5: online validation so revoked grants and deleted sessions take
  // effect immediately instead of waiting for the JWT to expire.
  const { data: userData, error: userError } = await supabase.auth.getUser(
    token,
  );
  if (userError || !userData.user || userData.user.id !== claims.sub) {
    return {
      ok: false,
      response: unauthorized(config, "The user session is no longer valid"),
    };
  }

  return {
    ok: true,
    context: {
      supabase,
      token,
      user: userData.user,
      clientId,
      claims: claims as Record<string, unknown>,
    },
  };
}

// -----------------------------------------------------------------------------
// CORS
// -----------------------------------------------------------------------------

export function optionsResponse(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** Return a copy of `response` with the CORS headers applied. */
export function applyCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(CORS_HEADERS)) {
    headers.set(name, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
