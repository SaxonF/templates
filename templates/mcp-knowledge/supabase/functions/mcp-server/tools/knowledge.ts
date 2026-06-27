import type { McpServer } from "npm:@modelcontextprotocol/sdk@1.29.0/server/mcp.js";
import { z } from "npm:zod@4.4.3";

import type { ToolContext } from "./types.ts";
import { invokeEdgeFunction } from "./edge-function.ts";

export function registerKnowledgeTools(
  server: McpServer,
  { supabase }: ToolContext,
): void {
  server.registerTool(
    "ingest_knowledge",
    {
      description:
        "Ingest text into the project's RAG knowledge base through the rag-ingest Edge Function.",
      inputSchema: {
        source: z.string().min(1).describe("Source label or URI for this content."),
        content: z.string().min(1).describe("Plain text or markdown content to chunk and embed."),
        metadata: z.record(z.string(), z.unknown()).default({}),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    ({ source, content, metadata }: {
      source: string;
      content: string;
      metadata: Record<string, unknown>;
    }) => invokeEdgeFunction(supabase, "rag-ingest", { source, content, metadata }),
  );

  server.registerTool(
    "search_knowledge",
    {
      description:
        "Search the project's RAG knowledge base through the rag-query Edge Function.",
      inputSchema: {
        query: z.string().min(1),
        matchCount: z.number().int().min(1).max(50).default(8),
        source: z.string().min(1).optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    ({ query, matchCount, source }: {
      query: string;
      matchCount: number;
      source?: string;
    }) => invokeEdgeFunction(supabase, "rag-query", { query, matchCount, source }),
  );
}
