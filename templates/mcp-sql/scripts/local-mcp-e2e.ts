import postgres from "npm:postgres@3.4.7";

import { type TestIdentity, validateIdentity } from "./validate-mcp.ts";

type CreatedUser = {
  id: string;
  email: string;
  password: string;
  sessionToken: string;
};

type OAuthClient = {
  client_id: string;
};

type TokenResponse = {
  access_token: string;
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() ??
  "http://127.0.0.1:54321";
const mcpUrl = Deno.env.get("MCP_TEST_URL")?.trim() ??
  `${supabaseUrl}/functions/v1/mcp-server`;
const adminUrl = Deno.env.get("MCP_TEST_ADMIN_URL")?.trim() ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const siteUrl = Deno.env.get("MCP_TEST_SITE_URL")?.trim() ??
  "http://127.0.0.1:3000";
const publishableKey = required("SUPABASE_PUBLISHABLE_KEY");
const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
const redirectUri = "http://127.0.0.1:49152/callback";
const schema = "agent_sql_validation";

function required(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function responseJson<T>(
  response: Response,
  operation: string,
): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${operation} failed (${response.status}): ${text}`);
  }
  return JSON.parse(text) as T;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(
    /=+$/,
    "",
  );
}

async function createUser(label: string): Promise<CreatedUser> {
  const suffix = crypto.randomUUID();
  const email = `agent-sql-${label}-${suffix}@example.test`;
  const password = `Mcp-${crypto.randomUUID()}-9a!`;
  const user = await responseJson<{ id: string }>(
    await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password, email_confirm: true }),
    }),
    `create ${label}`,
  );

  const session = await responseJson<{ access_token: string }>(
    await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: publishableKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    }),
    `sign in ${label}`,
  );

  return { id: user.id, email, password, sessionToken: session.access_token };
}

async function deleteUser(user: CreatedUser): Promise<void> {
  const response = await fetch(
    `${supabaseUrl}/auth/v1/admin/users/${user.id}`,
    {
      method: "DELETE",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    },
  );
  if (!response.ok) {
    console.error(
      `Unable to delete test user ${user.id}: ${await response.text()}`,
    );
  }
}

async function registerClient(): Promise<OAuthClient> {
  return await responseJson<OAuthClient>(
    await fetch(`${supabaseUrl}/auth/v1/oauth/clients/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: `Agent SQL local validation ${crypto.randomUUID()}`,
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    }),
    "dynamic client registration",
  );
}

async function oauthToken(
  user: CreatedUser,
  client: OAuthClient,
): Promise<string> {
  const verifierBytes = crypto.getRandomValues(new Uint8Array(48));
  const verifier = base64Url(verifierBytes);
  const challenge = base64Url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ),
  );
  const state = crypto.randomUUID();
  const authorize = new URL(`${supabaseUrl}/auth/v1/oauth/authorize`);
  authorize.search = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: redirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "email",
  }).toString();

  const authorizationResponse = await fetch(authorize, { redirect: "manual" });
  if (
    authorizationResponse.status < 300 || authorizationResponse.status > 399
  ) {
    throw new Error(
      `authorization request failed (${authorizationResponse.status}): ${await authorizationResponse
        .text()}`,
    );
  }
  const consentLocation = authorizationResponse.headers.get("location");
  if (!consentLocation) {
    throw new Error("Authorization response had no location.");
  }
  const consentUrl = new URL(consentLocation, siteUrl);
  const authorizationId = consentUrl.searchParams.get("authorization_id");
  if (!authorizationId) {
    throw new Error(
      `Authorization response had no authorization_id: ${consentUrl}`,
    );
  }

  const consentHeaders = {
    apikey: publishableKey,
    Authorization: `Bearer ${user.sessionToken}`,
    "Content-Type": "application/json",
    Origin: new URL(siteUrl).origin,
    Referer: consentUrl.toString(),
  };
  await responseJson(
    await fetch(
      `${supabaseUrl}/auth/v1/oauth/authorizations/${authorizationId}`,
      { headers: consentHeaders },
    ),
    "authorization details",
  );
  const consent = await responseJson<{ redirect_url: string }>(
    await fetch(
      `${supabaseUrl}/auth/v1/oauth/authorizations/${authorizationId}/consent`,
      {
        method: "POST",
        headers: consentHeaders,
        body: JSON.stringify({ action: "approve" }),
      },
    ),
    "authorization consent",
  );
  const callback = new URL(consent.redirect_url);
  if (callback.searchParams.get("state") !== state) {
    throw new Error("OAuth state did not match.");
  }
  const code = callback.searchParams.get("code");
  if (!code) throw new Error(`OAuth callback contained no code: ${callback}`);

  const tokens = await responseJson<TokenResponse>(
    await fetch(`${supabaseUrl}/auth/v1/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: client.client_id,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }),
    }),
    "OAuth token exchange",
  );
  return tokens.access_token;
}

async function prepareFixture(
  admin: ReturnType<typeof postgres>,
  users: CreatedUser[],
): Promise<void> {
  await admin.unsafe(`drop schema if exists ${schema} cascade`);
  await admin.unsafe(`create schema ${schema}`);
  await admin.unsafe(`
    create table ${schema}.notes (
      id bigint generated always as identity primary key,
      user_id uuid not null,
      body text not null
    )
  `);
  await admin.unsafe(`alter table ${schema}.notes enable row level security`);
  await admin.unsafe(`
    create policy notes_by_owner on ${schema}.notes
    for all to authenticated
    using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id)
  `);
  await admin.unsafe(`grant usage on schema ${schema} to authenticated`);
  await admin.unsafe(
    `grant select, insert, update, delete on ${schema}.notes to authenticated`,
  );
  await admin.unsafe(
    `grant usage, select on sequence ${schema}.notes_id_seq to authenticated`,
  );
  await admin.unsafe(
    `insert into ${schema}.notes (user_id, body) values ($1, 'only-user-a'), ($2, 'only-user-b')`,
    [users[0].id, users[1].id],
  );
}

const admin = postgres(adminUrl, { prepare: false, max: 1 });
const users: CreatedUser[] = [];
try {
  users.push(await createUser("a"), await createUser("b"));
  const client = await registerClient();
  const oauthTokens = [
    await oauthToken(users[0], client),
    await oauthToken(users[1], client),
  ];
  await prepareFixture(admin, users);

  const identities: TestIdentity[] = [
    {
      label: "user-a",
      token: oauthTokens[0],
      subject: users[0].id,
      expectedBody: "only-user-a",
    },
    {
      label: "user-b",
      token: oauthTokens[1],
      subject: users[1].id,
      expectedBody: "only-user-b",
    },
  ];
  const evidence = [];
  for (const identity of identities) {
    evidence.push({
      identity: identity.label,
      ...await validateIdentity(mcpUrl, identity),
    });
  }

  // Auth boundary: a garbage bearer token must be rejected with HTTP 401 before
  // any SQL runs. JWT verification lives in mcp-server/auth.ts; this only asserts
  // the boundary holds end-to-end, it does not reimplement verification. A raw
  // POST is used (not the MCP client) so the transport's session handshake never
  // gets a chance to start.
  const unauthorized = await fetch(mcpUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: "Bearer not-a-real-jwt.garbage.token",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    }),
  });
  await unauthorized.body?.cancel();
  if (unauthorized.status !== 401) {
    throw new Error(
      `Expected garbage bearer token to be rejected with 401, got ${unauthorized.status}.`,
    );
  }

  console.log(
    JSON.stringify(
      { ok: true, authBoundary: { garbageTokenStatus: 401 }, evidence },
      null,
      2,
    ),
  );
} finally {
  await admin.unsafe(`drop schema if exists ${schema} cascade`).catch(
    (error) => {
      console.error("Unable to drop validation schema", error);
    },
  );
  await admin.end({ timeout: 5 });
  await Promise.all(users.map(deleteUser));
}
