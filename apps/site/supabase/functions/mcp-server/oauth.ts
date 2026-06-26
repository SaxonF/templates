import {
  createContextClient,
  verifyAuth,
} from "npm:@supabase/server@1.1.0/core";
import type { SupabaseClient, User } from "npm:@supabase/supabase-js@2.108.2";

// =============================================================================
// OAuth resource-server logic
// =============================================================================
//
// This Edge Function is an OAuth 2.1 *protected resource*. Supabase Auth is the
// authorization server. This module handles three things for index.ts:
//
//   1. Discovery — answering /.well-known/oauth-protected-resource and issuing
//      `WWW-Authenticate` challenges so clients can find the auth server.
//   2. Authentication — verifying the bearer token's signature AND its claims
//      (issuer, role, client_id, audience), then confirming the live session.
//   3. CORS — permissive headers so browser-based MCP clients can connect.
//
// The audience binding (the resource URL must appear in the token's `aud`) is
// what stops a token minted for some other purpose from being replayed here; it
// is produced by the custom access-token hook in the migrations.

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

export type OAuthConfig = {
  resourceUrl: string;
  metadataUrl: string;
  resourceName: string;
  authorizationServer: string;
};

export type AuthenticatedContext = {
  /** User-scoped Supabase client (the bearer token is already attached). */
  supabase: SupabaseClient;
  /** The raw bearer token. */
  token: string;
  /** The authenticated user (from a live session check). */
  user: User;
  /** The OAuth client_id the token was issued to. */
  clientId: string;
  /** Verified JWT claims, used to set the agent SQL database request context. */
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

export function getOAuthConfig(request: Request): OAuthConfig {
  const requestOrigin = publicRequestOrigin(request);
  // Allow explicit overrides (MCP_RESOURCE_URL / MCP_AUTH_ISSUER) for custom
  // domains; otherwise derive both from the public request origin.
  const resourceUrl = readTrimmedEnv("MCP_RESOURCE_URL") ??
    `${requestOrigin}${FUNCTION_PATH}`;
  const authorizationServer = readTrimmedEnv("MCP_AUTH_ISSUER") ??
    `${new URL(resourceUrl).origin}/auth/v1`;

  return {
    resourceUrl,
    metadataUrl: `${resourceUrl}${METADATA_PATH}`,
    resourceName: readTextEnv("MCP_SERVER_NAME", "tasks"),
    authorizationServer,
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
  config: OAuthConfig,
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
function challenge(config: OAuthConfig): string {
  return `Bearer resource_metadata="${config.metadataUrl}", scope="${REQUIRED_SCOPE}"`;
}

function unauthorized(config: OAuthConfig, description: string): Response {
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
  config: OAuthConfig,
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
      response: unauthorized(config, "A valid OAuth access token is required"),
    };
  }

  // Step 2: verify the claims bind this token to THIS resource. The order is
  // issuer → user/client → audience, each failing closed with a 401 challenge.
  const claims = auth.jwtClaims;
  const clientId = claims?.client_id;
  const audiences = audienceValues(claims?.aud);

  if (claims?.iss !== config.authorizationServer) {
    return {
      ok: false,
      response: unauthorized(config, "The token issuer is invalid"),
    };
  }

  if (
    claims?.role !== "authenticated" || typeof clientId !== "string" ||
    !clientId
  ) {
    return {
      ok: false,
      response: unauthorized(config, "An OAuth user token is required"),
    };
  }

  if (
    !audiences.includes("authenticated") ||
    !audiences.includes(config.resourceUrl)
  ) {
    return {
      ok: false,
      response: unauthorized(config, "The token audience is invalid"),
    };
  }

  const token = auth.token;
  if (!token) {
    return {
      ok: false,
      response: unauthorized(config, "A bearer token is required"),
    };
  }

  // Step 3: build a user-scoped client that carries the bearer token.
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

  // Step 4: online validation so revoked OAuth grants and deleted sessions take
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
