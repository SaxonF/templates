# Database template

Base Supabase project configuration for local development.

## Configuration

This template installs `supabase/config/database.toml` — a partial config fragment, not a full `config.toml`. The shadcn installer cannot merge config across templates, so copy the sections from each installed fragment into `supabase/config.toml` (run `supabase init` first if the file does not exist).

When you add more templates, merge every fragment under `supabase/config/*.toml` into `supabase/config.toml`. Inspect fragments with `npx shadcn@latest view SaxonF/templates/<id>`.

## Declarative schemas and migrations

Templates ship SQL under `supabase/schemas/`. Supabase applies declarative schemas only after they exist in a migration. On a fresh project:

1. Install templates, merge `supabase/config/*.toml` into `supabase/config.toml`, and merge any `seed.sql` files from multiple templates into one file (later installs overwrite `seed.sql` — keep RBAC seed data when adding other templates).
2. Use an empty or comment-only `seed.sql` for the first boot if seed data references tables that do not exist yet.
3. Run `supabase start` (or `supabase db start`).
4. Generate the initial migration: `supabase db diff -f initial_schema`
5. Restore seed data, then run `supabase db reset`.

Skipping step 4 causes `db reset` to run seed SQL before RBAC and other tables exist.

## Table permissions

`db diff` does not always emit `GRANT` statements for the `authenticated` role. Templates that expose tables through PostgREST include grants in their schema files. If you add tables manually, end each schema file with:

```sql
grant select, insert, update, delete on table public.<table> to authenticated;
grant usage, select on all sequences in schema public to authenticated;
```

RLS policies are not evaluated when the role lacks table-level `SELECT`/`INSERT`/`UPDATE`/`DELETE` grants.

## Dependencies

None. Other templates depend on this one.
