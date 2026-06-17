# Storage template

S3-compatible object storage configuration for local development.

## Configuration

The shadcn installer cannot merge `supabase/config.toml` across templates, so config is documented here instead of installed as a file. Merge the snippet below into `supabase/config.toml`.

```toml
[storage]
enabled = true
file_size_limit = "50MB"
```

## Dependencies

Requires **database**.
