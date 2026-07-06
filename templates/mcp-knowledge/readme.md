# MCP Knowledge

Adds knowledge ingestion and search tools backed by an included RAG pipeline.

## Tools

| Tool | Purpose |
| --- | --- |
| `ingest_knowledge` | Ingest text into the RAG pipeline. |
| `search_knowledge` | Search embedded RAG chunks for relevant passages. |

Both tools call the existing `rag-ingest` and `rag-query` Edge Functions through
the signed-in user's Supabase client.

## Includes

- `supabase/schemas/rag.sql` — documents, chunks, embedding queue, and cron worker
- `supabase/functions/rag-ingest`, `rag-embed`, `rag-query` — ingest, embed, and search workers
- `supabase/schemas/storage-rag-ingest.sql` — optional Storage upload path for `.txt`/`.md` files
- `supabase/functions/rag-file-ingest` — downloads Storage files and inserts them into the RAG tables

## Dependencies

Requires **mcp-server**. Configure `OPENAI_API_KEY` for embedding and query functions.
