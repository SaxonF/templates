# Auth template

Supabase Auth configuration for local development.

## Includes

- `supabase/config.toml` — auth settings including email confirmation and redirect URLs

## Local email (Mailpit)

`enable_confirmations` is `true` so sign-up sends a confirmation email locally. Emails are captured by Mailpit — they do not go to a real inbox.

After `supabase start`, run `supabase status` for your project's Mailpit URL (port varies per project). Link to Mailpit from your sign-up success UI when `NEXT_PUBLIC_SUPABASE_URL` points at localhost.

If you disable confirmations in `config.toml`, update your sign-up UI to skip the "check your email" step.

## Redirect URLs

`site_url` defaults to `http://localhost:3000`. `additional_redirect_urls` includes localhost and `127.0.0.1` wildcards so Next.js on either host can complete auth redirects.

## Dependencies

Requires **database**.
