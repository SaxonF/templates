# Edge Functions template

Edge Functions runtime configuration for local development.

## Configuration

The shadcn installer cannot merge `supabase/config.toml` across templates, so config is documented here instead of installed as a file. Merge the snippet below into `supabase/config.toml`.

```toml
[edge_runtime]
enabled = true
policy = "oneshot"
inspector_port = 8083
```

## Dependencies

None.
