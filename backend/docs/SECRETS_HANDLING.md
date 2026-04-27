# Secrets Handling

This project should keep real secrets only in local or deployment environment variables, never in tracked source files.

## Where real secrets go

- Local development: `backend/.env`
- Production hosting: the platform secret manager or environment variable UI
- CI/CD: repository or organization secrets, not committed files

## What stays in Git

- `backend/.env.example` with empty or placeholder values only
- Documentation that names required variables without real values

## Required actions if a real secret was exposed

Treat the following values as compromised if they were ever committed, shared, uploaded, or copied outside your machine:

- `APP_KEY`
- `DB_PASSWORD`
- `MAIL_USERNAME`
- `MAIL_PASSWORD`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- any OAuth client secret

Rotate them at the provider, then update `backend/.env` locally and the deployment environment in production.

## Local setup flow

1. Copy `backend/.env.example` to `backend/.env`
2. Fill in the real values only in `backend/.env`
3. Run `php artisan key:generate` if `APP_KEY` is empty
4. Never paste the filled `.env` into chat, tickets, commits, or screenshots

## Production setup flow

1. Keep `APP_ENV=production`
2. Keep `APP_DEBUG=false`
3. Set secrets through the hosting provider environment settings
4. Restart or redeploy after secret changes

## Rotation checklist

1. Rotate the provider secret first
2. Update local `backend/.env`
3. Update production environment variables
4. Restart services or redeploy
5. Invalidate old credentials where supported

