# Supabase templates

A [shadcn GitHub registry](https://ui.shadcn.com/docs/registry/github) of Supabase project templates. Install SQL schemas and Edge Functions into your project with the shadcn CLI. `config.toml` settings are documented in each template's readme for manual merge.

**Registry address:** `SaxonF/templates`

## Install a template

```bash
npx shadcn@latest add SaxonF/templates/database
```

Install a specific version by pinning a tag or commit:

```bash
npx shadcn@latest add SaxonF/templates/auth#v1.0.0
npx shadcn@latest add SaxonF/templates/auth#<full-commit-sha>
```

Files are written into your project (typically under `supabase/`). You own and manage the code after install.

## Browse and inspect

```bash
# List all items
npx shadcn@latest list SaxonF/templates

# Search
npx shadcn@latest search SaxonF/templates -q auth

# Inspect an item before installing
npx shadcn@latest view SaxonF/templates/agent

# Preview changes without writing files
npx shadcn@latest add SaxonF/templates/auth --dry-run
```

## How the registry works

This repository follows the [GitHub registry model](https://ui.shadcn.com/docs/registry/github):

- A single root [`registry.json`](./registry.json) declares every template in its `items` array.
- Template source files live under `templates/<id>/supabase/`.
- The shadcn CLI reads the manifest from GitHub and installs the referenced files into the user's project.

No registry server or per-template manifest files are required — the GitHub repository is the source of truth.

The `include` pattern in the docs is optional. It is useful for very large repos that want to split manifests across folders. This catalog uses one root `registry.json` instead.

### Dependencies

Templates can depend on other templates in this registry via `registryDependencies`. For example, `auth` depends on `database`:

```bash
npx shadcn@latest add SaxonF/templates/auth
```

shadcn resolves and installs required dependencies from the same registry when needed.

### What gets installed

Each item references files from `templates/<id>/supabase/` in the repository. Those files are installed into matching paths in your project (e.g. `~/supabase/schemas/*.sql`, `~/supabase/functions/*/index.ts`). Templates that need `config.toml` changes document snippets in their readme — merge those into `supabase/config.toml` by hand (the shadcn installer does not merge config across templates).

## Repository layout

```txt
.
├── registry.json                 # Root catalog (all items)
├── templates/
│   └── <id>/
│       ├── readme.md             # Optional docs (included in registry item)
│       ├── template.json         # Optional metadata source (preferred for edits)
│       └── supabase/             # Template source files
│           ├── schemas/
│           ├── functions/
│           └── seed.sql
└── scripts/
    └── sync-registry.ts          # Regenerates root registry.json
```

## Contributing

### Prerequisites

- Node.js 20+
- pnpm

### Sync the registry

After changing template files or metadata, regenerate the root manifest:

```bash
pnpm install
pnpm sync-registry
```

`sync-registry` scans each `templates/<id>/supabase/` directory and rewrites the `items` array in root `registry.json`.

### Template metadata

Metadata can live in either:

1. **`template.json`** (preferred when adding or editing a template) — used as the source of truth on sync.
2. **The existing item in root `registry.json`** — read on sync if `template.json` is absent.

`template.json` shape:

```json
{
  "id": "auth",
  "name": "Auth",
  "description": "User authentication and authorization service",
  "category": "Auth",
  "version": "1.0.0",
  "dependencies": {
    "required": ["database"]
  }
}
```

Required dependencies are written to `registryDependencies` as `SaxonF/templates/<id>` refs.

### Validate before publishing

Once the repository is public on GitHub:

```bash
npx shadcn@latest registry validate SaxonF/templates
```

## Available templates

| ID | Category |
|----|----------|
| `database` | Core |
| `auth` | Auth |
| `api` | API |
| `functions` | Core |
| `storage` | Storage |
| `security-rls` | Security |
| `multi-tenant-rbac` | Security |
| `agent` | AI |
| `ai-rag-pipeline` | AI |
| … | See `npx shadcn@latest list SaxonF/templates` |

## License

MIT
