# Acceptance Checklist

This checklist tracks the first production-ready read-only release scope.

## Status

- Overall status: mostly complete for a first deployment candidate.
- Known external dependency gap: Docker cannot be verified in the current local
  workspace because Docker is not installed here. Validate `docker compose up`
  on the Debian VPS before production use.

## Required Acceptance Items

| Item | Status | Notes |
| --- | --- | --- |
| Docker service can start | Pending VPS validation | Dockerfile and docker-compose are present. Local environment has no Docker command. |
| Admin backend login works | Done | `/admin/login` uses `ADMIN_USERNAME`, `ADMIN_PASSWORD`, signed cookie session, and production `SESSION_SECRET` checks. |
| Add Shopline store | Done | Admin/API create store supports `shopline`; token is encrypted. |
| Add Shoplazza store | Done | Admin/API create store supports `shoplazza`; token is encrypted. |
| Sync Meta ad accounts | Done | `POST /api/ad-accounts/sync`; MCP account tools are read-only. |
| Manual store-ad account binding | Done | One store can bind multiple accounts; one account maps to one primary store. |
| CSV / Excel mapping import | Done | `.csv`, `.tsv`, `.xlsx` validation with manual confirmation. |
| Sync orders | Done | Manual and optional scheduled sync; filtered fields only. |
| Sync Meta Insights | Done | Account/store sync, 1/3/7/14/30 days, country breakdown, campaign/adset/ad levels. |
| Store real ROAS report | Done | Store overview analysis joins orders and local Meta spend. |
| Country real ROAS report | Done | Country analysis compares order revenue and Meta spend. |
| Product performance report | Done | Product/SKU aggregation from order items. |
| AI ad suggestions | Done | Advisory output only; no automatic execution. |
| No Meta write tools in code | Done | MCP tools use `ads_readonly_*`; `npm run verify:readonly` checks write-like patterns. |
| No secrets in code | Done | `.env.example` is placeholders only; `.dockerignore` excludes `.env`. |
| README deployable by non-programmer | Mostly done | Includes Debian, Docker, Nginx, env, migration, token, backup, and mapping import steps. |

## Security Gates

- `READ_ONLY_MODE=true` is set in deployment examples and cannot be disabled
  outside tests.
- Non-GET Meta client methods are blocked by runtime guard.
- Registered MCP tools only expose read-only Meta data access.
- CORS wildcard is rejected at startup.
- Store tokens are encrypted with `TOKEN_ENCRYPTION_KEY`.
- Store and Meta API error messages avoid response bodies.
- Logs redact token and customer privacy field names.
- Orders do not persist customer name, email, phone, or street address.

## Verification Commands

```bash
npm run db:generate
npm run typecheck
npm test
npm run build
npm run verify:readonly
npx prisma validate
```

## Remaining Production Checks

- Run `docker compose up --build -d` on the Debian VPS.
- Verify real Shopline and Shoplazza private-app tokens against the built-in read-only order/profile adapters.
- Confirm Meta token permissions are read-only.
- Visit `/admin/login`, add stores, sync accounts, import mappings, and run
  one order/insights/creative sync with sandbox or low-risk production data.
