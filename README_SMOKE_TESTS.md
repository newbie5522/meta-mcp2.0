# Smoke Tests

These smoke checks are repository-level contract tests. They do not require a live Meta token, do not print secrets, and do not trigger SyncCenter.

## Commands

```bash
npm run smoke:config
npm run smoke:data
```

## What They Guard

- `smoke:config` checks the settings token mask contract, the MetaConfigPage masked-token flow, active-list backend token sourcing, mapping validation, disabled AdAccount deletion, safe Store DTOs, and that settings/stores/mappings saves do not call SyncCenter.
- `smoke:data` checks nullable AdAccount/AccountMapping store links, unmapped account preservation, no runtime AdAccount deletion, no default-store binding in account chains, Order local-time fact fields, Store timezone sync, DataCenter fallback defaults, FactMetaPerformance fact-source usage, unmapped spend isolation, audit warnings, and manual sync guards.

## VPS Usage

After deploying a new commit on the VPS:

```bash
cd /var/www/meta-mcp2
git pull --ff-only origin main
npm ci
npx prisma generate --schema prisma/schema.prisma
npm run build
systemctl restart meta-insights
npm run smoke:config
npm run smoke:data
```

Only share the smoke summaries. Do not paste full tokens, `.env`, database files, or backups.
