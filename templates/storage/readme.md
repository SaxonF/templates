# Storage template

S3-compatible object storage configuration for local development.

> **Powers [`mcp-storage`](../mcp-storage).** This is a backing service — install the tool pack to give an agent user-scoped file access.

## Configuration

This template installs `supabase/config/storage.toml` — a partial config fragment. Merge its sections into `supabase/config.toml` alongside any other fragments under `supabase/config/*.toml`.

## Dependencies

Requires **database**.
