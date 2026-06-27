# MCP Knowledge

Adds knowledge ingestion and search tools backed by **ai-rag-pipeline**.

## Tools

| Tool | Purpose |
| --- | --- |
| `ingest_knowledge` | Ingest text into the RAG pipeline. |
| `search_knowledge` | Search embedded RAG chunks for relevant passages. |

Both tools call the existing `rag-ingest` and `rag-query` Edge Functions through
the signed-in user's Supabase client.

## Dependencies

Requires **mcp-server** and **ai-rag-pipeline**.
