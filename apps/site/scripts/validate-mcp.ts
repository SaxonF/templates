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
      ownMutationRows: ownMutation.rowCount,
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
