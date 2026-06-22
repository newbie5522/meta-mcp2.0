# Debian VPS Deployment Guide

This guide deploys Meta Insights AI to a Debian VPS for Phase 1 testing.

It uses:

- Debian 11 or 12
- Node.js LTS
- Vite production build
- Bundled Node server at `dist/server.cjs`
- SQLite database at `prisma/dev.db`
- Prisma schema at `prisma/schema.prisma`
- systemd service named `meta-insights`
- Nginx reverse proxy on port `80`
- Runtime user `metaapp`
- Project path `/var/www/meta-mcp2`

Do not put real Meta tokens in Git, `.env.example`, deployment docs, shell history screenshots, or logs.

## Safety Rules

- Do not run seed, reseed, mock, demo, sample, or fake data scripts.
- Do not commit `.env`, SQLite databases, backups, `.npm-cache`, or generated local files.
- Keep `ENABLE_SYNC_SCHEDULER=false` unless a later approved phase explicitly enables it.
- Do not store Meta Token in `.env`; save it later through the app settings UI/API.
- Canonical Prisma schema is `prisma/schema.prisma`.

## A. System Base Environment

Run as `root`, or prefix privileged commands with `sudo`.

```bash
apt update
apt upgrade -y

apt install -y curl git nginx sqlite3 build-essential ca-certificates ufw
```

## B. Install Node.js LTS

Use NodeSource Node.js 20 LTS for Debian.

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

node -v
npm -v
```

Expected: Node.js v20.x or newer LTS-compatible output.

## C. Create Runtime User

```bash
adduser --system --group --home /var/www/meta-mcp2 metaapp
mkdir -p /var/www
chown -R metaapp:metaapp /var/www/meta-mcp2
```

If `/var/www/meta-mcp2` already exists and is not empty, inspect it before continuing:

```bash
ls -la /var/www/meta-mcp2
```

## D. Pull Code From GitHub

Use `main` for the current test deployment.

```bash
cd /var/www
sudo -u metaapp git clone -b main https://github.com/newbie5522/meta-mcp2.0.git meta-mcp2
cd /var/www/meta-mcp2
sudo -u metaapp git log --oneline -5
```

Confirm the log contains the Phase 1 baseline commits:

```text
4b9df7b fix: harden config chain runtime safety
ead7c78 fix: lock prisma schema and config chain baseline
```

## E. Create `.env`

Do not put Meta Token in `.env`.

```bash
cat > .env <<'EOF'
NODE_ENV=production
PORT=3000
ENABLE_SYNC_SCHEDULER=false
EOF

chown metaapp:metaapp .env
chmod 600 .env
```

## F. Install Dependencies And Prisma

```bash
sudo -u metaapp npm ci
sudo -u metaapp npx prisma generate --schema prisma/schema.prisma
sudo -u metaapp npx prisma db push --schema prisma/schema.prisma
```

`db push` initializes the local SQLite dev/test database from the canonical schema. It does not seed data.

## G. Check SQLite Tables

```bash
sudo -u metaapp sqlite3 prisma/dev.db ".tables"
sudo -u metaapp sqlite3 prisma/dev.db "SELECT COUNT(*) FROM Store;"
sudo -u metaapp sqlite3 prisma/dev.db "SELECT COUNT(*) FROM AdAccount;"
sudo -u metaapp sqlite3 prisma/dev.db "SELECT COUNT(*) FROM AccountMapping;"
sudo -u metaapp sqlite3 prisma/dev.db "SELECT COUNT(*) FROM Setting;"
```

For a fresh deployment, counts should normally be `0`.

## H. Build And Audit

```bash
sudo -u metaapp npm run lint
sudo -u metaapp npm run build
sudo -u metaapp npm run audit:data-pipeline
```

`audit:data-pipeline` may return `WARNING` on an empty database because no `FactMetaPerformance` rows exist yet. That is acceptable for initial deployment if there are no violations.

## I. Create systemd Service

Create `/etc/systemd/system/meta-insights.service`:

```bash
cat > /etc/systemd/system/meta-insights.service <<'EOF'
[Unit]
Description=Meta Insights AI Test Server
After=network.target

[Service]
Type=simple
User=metaapp
Group=metaapp
WorkingDirectory=/var/www/meta-mcp2
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=ENABLE_SYNC_SCHEDULER=false
ExecStart=/usr/bin/node /var/www/meta-mcp2/dist/server.cjs
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=/var/www/meta-mcp2

[Install]
WantedBy=multi-user.target
EOF
```

Start the service:

```bash
systemctl daemon-reload
systemctl enable meta-insights
systemctl start meta-insights
systemctl status meta-insights --no-pager
journalctl -u meta-insights -n 100 --no-pager
```

The logs must include:

```text
Sync scheduler disabled by default
```

If the service fails, inspect:

```bash
journalctl -u meta-insights -n 200 --no-pager
```

## J. Local API Verification

Run on the VPS:

```bash
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3000/api/settings
curl http://127.0.0.1:3000/api/stores
curl http://127.0.0.1:3000/api/accounts
curl http://127.0.0.1:3000/api/mappings
curl http://127.0.0.1:3000/api/accounts/active-list
curl http://127.0.0.1:3000/api/data-center/pipeline-audit
```

Without a saved Meta Token, `/api/accounts/active-list` should return `401`. That is expected.

## K. Configure Nginx

Create `/etc/nginx/sites-available/meta-insights`:

```bash
cat > /etc/nginx/sites-available/meta-insights <<'EOF'
server {
    listen 80;
    server_name _;

    root /var/www/meta-mcp2/dist;
    index index.html;

    location = /health {
        proxy_pass http://127.0.0.1:3000/health;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF
```

Enable the site:

```bash
ln -sf /etc/nginx/sites-available/meta-insights /etc/nginx/sites-enabled/meta-insights
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
```

## L. Firewall

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
ufw status
```

You do not need to expose port `3000` publicly when Nginx is proxying port `80`.

## M. Public Access Verification

Replace `YOUR_SERVER_IP` with the VPS public IP or configured domain.

```bash
curl http://YOUR_SERVER_IP/health
curl http://YOUR_SERVER_IP/api/settings
curl http://YOUR_SERVER_IP/api/stores
```

Then open:

```text
http://YOUR_SERVER_IP/
```

If you use a domain, point its DNS A record to the VPS IP and replace `server_name _;` with the domain.

## N. Future Update Deployment

```bash
cd /var/www/meta-mcp2

sudo -u metaapp git fetch origin
sudo -u metaapp git checkout main
sudo -u metaapp git pull --ff-only origin main

sudo -u metaapp npm ci
sudo -u metaapp npx prisma generate --schema prisma/schema.prisma
sudo -u metaapp npx prisma db push --schema prisma/schema.prisma

sudo -u metaapp npm run lint
sudo -u metaapp npm run build
sudo -u metaapp npm run audit:data-pipeline

systemctl restart meta-insights
journalctl -u meta-insights -n 100 --no-pager
```

Confirm after every restart:

```bash
journalctl -u meta-insights -n 100 --no-pager | grep "Sync scheduler disabled by default"
curl http://127.0.0.1:3000/health
```

## O. Keep Secrets And Local Data Out Of Git

Before committing or pushing from the VPS:

```bash
cd /var/www/meta-mcp2
git status --short
```

The following must not appear as staged files:

```text
.env
*.db
*.db-journal
*.db-wal
*.db-shm
backups/
.npm-cache/
```

If they appear, stop and inspect `.gitignore` before committing.

## P. Phase 1C Real Configuration Acceptance

After deployment succeeds, the next phase is Phase 1C:

1. Create a real Store.
2. Save a real Meta Token through the app/API; do not write it into code or docs.
3. Manually call `/api/accounts/active-list`.
4. Verify unmapped `AdAccount.storeId = null`.
5. Bind a real AdAccount to an existing Store.
6. Unbind it and confirm `AdAccount` still exists.
7. Confirm `DELETE /api/stores/:id/accounts/:accountId` returns `410`.
8. Confirm scheduler remains disabled by default.
9. Confirm no seed, fake, demo, mock, or sample data was created.

