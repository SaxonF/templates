import { Client } from "npm:@modelcontextprotocol/sdk@1.29.0/client/index.js";
import { StreamableHTTPClientTransport } from "npm:@modelcontextprotocol/sdk@1.29.0/client/streamableHttp.js";

type TextContent = { type: "text"; text: string };
type ToolResult = {
  isError?: boolean;
  content: TextContent[];
};

export type TestIdentity = {
  label: string;
  token: string;
  subject: string;
  expectedBody: string;
};

function required(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function textResult(result: unknown): string {
  const typed = result as ToolResult;
  return typed.content
    .filter((item): item is TextContent => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

function parsedResult(result: unknown): Record<string, unknown> {
  const typed = result as ToolResult;
  if (typed.isError) throw new Error(textResult(result));
  return JSON.parse(textResult(result));
}

async function connect(
  url: string,
  identity: TestIdentity,
): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: {
      headers: { Authorization: `Bearer ${identity.token}` },
    },
  });
  const client = new Client({
    name: `agent-sql-validation-${identity.label}`,
    version: "1.0.0",
  });
  await client.connect(transport);
  return client;
}

export async function validateIdentity(
  url: string,
  identity: TestIdentity,
): Promise<Record<string, unknown>> {
  const client = await connect(url, identity);
  try {
    const tools = await client.listTools();
    const names = tools.tools.map((tool: { name: string }) => tool.name).sort();
    for (
      const requiredTool of [
        "describe_function",
        "describe_table",
        "execute_sql",
        "list_database_objects",
        "query_sql",
      ]
    ) {
      if (!names.includes(requiredTool)) {
        throw new Error(`${identity.label}: missing tool ${requiredTool}`);
      }
    }

    const query = parsedResult(
      await client.callTool({
        name: "query_sql",
        arguments: {
          query:
            "select auth.uid()::text as uid, user_id::text as user_id, body " +
            "from agent_sql_validation.notes order by body",
        },
      }),
    );
    const rows = query.rows as Array<Record<string, unknown>>;
    if (
      query.rowCount !== 1 || rows.length !== 1 ||
      rows[0].uid !== identity.subject ||
      rows[0].user_id !== identity.subject ||
      rows[0].body !== identity.expectedBody
    ) {
      throw new Error(
        `${identity.label}: RLS result mismatch: ${JSON.stringify(query)}`,
      );
    }

    const forbiddenMutation = parsedResult(
      await client.callTool({
        name: "execute_sql",
        arguments: {
          query:
            "update agent_sql_validation.notes set body = 'cross-user-write' " +
            "where user_id <> auth.uid() returning user_id::text as user_id",
        },
      }),
    );
    if (
      forbiddenMutation.rowCount !== 0 ||
      (forbiddenMutation.rows as unknown[]).length !== 0
    ) {
      throw new Error(
        `${identity.label}: RLS allowed a cross-user mutation: ${
          JSON.stringify(forbiddenMutation)
        }`,
      );
    }

    const ownMutation = parsedResult(
      await client.callTool({
        name: "execute_sql",
        arguments: {
          query: "update agent_sql_validation.notes set body = body " +
            "where user_id = auth.uid() returning user_id::text as user_id, body",
        },
      }),
    );
    const ownRows = ownMutation.rows as Array<Record<string, unknown>>;
    if (
      ownMutation.rowCount !== 1 || ownRows.length !== 1 ||
      ownRows[0].user_id !== identity.subject ||
      ownRows[0].body !== identity.expectedBody
    ) {
      throw new Error(
        `${identity.label}: own-row mutation mismatch: ${
          JSON.stringify(ownMutation)
        }`,
      );
    }

    // Cross-user MERGE blocked by RLS (F-level: RLS is the final boundary).
    // MERGE is used WITHOUT a RETURNING clause: the PG16 libpg_query parser the
    // validator runs cannot parse `MERGE ... RETURNING` (a PG17 addition), so a
    // MERGE that mutates is the only MERGE shape that reaches the runtime. This
    // MERGE targets a row owned by the *other* user; RLS hides it, so the WHEN
    // MATCHED branch matches nothing and zero rows are affected.
    const crossUserMerge = parsedResult(
      await client.callTool({
        name: "execute_sql",
        arguments: {
          query: "merge into agent_sql_validation.notes as target " +
            "using (select user_id, body from agent_sql_validation.notes) as source " +
            "on target.id = source.id and target.user_id <> auth.uid() " +
            "when matched then update set body = 'cross-user-merge'",
        },
      }),
    );
    if (crossUserMerge.rowCount !== 0) {
      throw new Error(
        `${identity.label}: RLS allowed a cross-user MERGE: ${
          JSON.stringify(crossUserMerge)
        }`,
      );
    }

    // F1 — the mutation RETURNING cap is enforced at the database and visible to
    // the client. An own-row UPDATE ... RETURNING * returns a bounded result
    // whose rowCount reflects the true affected-row count and whose `truncated`
    // shape holds. The fixture seeds exactly one row per user, so the result is
    // well under the cap; assert the contract (bounded rows, sensible rowCount,
    // boolean truncated, no leaked `__agent_total` column) without over-fitting.
    const returningCap = parsedResult(
      await client.callTool({
        name: "execute_sql",
        arguments: {
          query: "update agent_sql_validation.notes set body = body " +
            "where user_id = auth.uid() returning *",
        },
      }),
    );
    const returningRows = returningCap.rows as Array<Record<string, unknown>>;
    if (
      typeof returningCap.rowCount !== "number" ||
      returningCap.rowCount < 0 ||
      !Array.isArray(returningRows) ||
      returningRows.length > returningCap.rowCount ||
      typeof returningCap.truncated !== "boolean" ||
      returningRows.some((row) => "__agent_total" in row)
    ) {
      throw new Error(
        `${identity.label}: mutation RETURNING cap contract violated: ${
          JSON.stringify(returningCap)
        }`,
      );
    }

    // F3 — catalog exclusion parity over the wire. `auth.users` exists, but the
    // runtime excludes the `auth` schema from describe_table exactly as it does
    // from list_database_objects, so the tool reports it as not accessible
    // rather than disclosing its shape.
    const excludedDescribe = await client.callTool({
      name: "describe_table",
      arguments: { schema: "auth", table: "users" },
    }) as ToolResult;
    if (
      !excludedDescribe.isError ||
      !textResult(excludedDescribe).includes("No accessible table")
    ) {
      throw new Error(
        `${identity.label}: excluded schema describe_table was not blocked: ${
          textResult(excludedDescribe)
        }`,
      );
    }

    const rejected = await client.callTool({
      name: "query_sql",
      arguments: {
        query:
          "select set_config('request.jwt.claims', '{\"sub\":\"00000000-0000-4000-8000-000000000000\"}', true)",
      },
    }) as ToolResult;
    if (
      !rejected.isError ||
      !textResult(rejected).includes("SQL_FORBIDDEN_FUNCTION")
    ) {
      throw new Error(
        `${identity.label}: set_config was not rejected: ${
          textResult(rejected)
        }`,
      );
    }

    return {
      subject: identity.subject,
      visibleRows: rows,
      rejectedContextMutation: true,
      crossUserMutationRows: forbiddenMutation.rowCount,
      crossUserMergeRows: crossUserMerge.rowCount,
      ownMutationRows: ownMutation.rowCount,
      returningCapRowCount: returningCap.rowCount,
      returningCapTruncated: returningCap.truncated,
      excludedSchemaDescribeBlocked: true,
      tools: names,
    };
  } finally {
    await client.close();
  }
}

if (import.meta.main) {
  const url = required("MCP_TEST_URL");
  const identities: TestIdentity[] = [
    {
      label: "user-a",
      token: required("MCP_TEST_TOKEN_A"),
      subject: required("MCP_TEST_SUBJECT_A"),
      expectedBody: required("MCP_TEST_BODY_A"),
    },
    {
      label: "user-b",
      token: required("MCP_TEST_TOKEN_B"),
      subject: required("MCP_TEST_SUBJECT_B"),
      expectedBody: required("MCP_TEST_BODY_B"),
    },
  ];

  const evidence = [];
  for (const identity of identities) {
    evidence.push({
      identity: identity.label,
      ...await validateIdentity(url, identity),
    });
  }

  console.log(JSON.stringify({ ok: true, evidence }, null, 2));
}
