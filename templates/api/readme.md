# Data API template

PostgREST API configuration for local development.

## Configuration

The shadcn installer cannot merge `supabase/config.toml` across templates, so config is documented here instead of installed as a file. Merge the snippet below into `supabase/config.toml`.

```toml
[api]
enabled = true
port = 54321
schemas = ["public"]
max_rows = 1000
extra_search_path = ["public", "extensions"]
```

## Dependencies

Requires **database**.
