# Deploying Orlanda Forms to the Orlanda failover cluster

This adapts **Doc 4 — Deploy-a-New-App Playbook** (`server_info/`) to Orlanda
Forms. The heavy infrastructure (pg_auto_failover cluster, witness, db-router,
role agents, Cloudflare tunnels) never changes — you only add an app-layer slice
on **both** Hetzner and OVH. Read Doc 4 alongside this; section numbers below map
to it.

> Golden rules (Doc 3): paste one command at a time; edit files with `nano`, not
> heredocs; use `/usr/bin/pg_autoctl`; do DB work on the **current primary** first,
> then mirror the app to the standby and leave it **stopped** (the role agent
> starts it there only on failover).

## App parameters

| Item | Value |
|---|---|
| App name | `orlanda-forms` |
| Database / user | `db_orlandaforms` / `orlandaforms` |
| App folder (both servers) | `/opt/orlanda-forms` |
| Local port | `8001` (free; 5432/6432/8000/23267 are taken — Doc 4 §0) |
| Hostname | `forms.n8norlanda.com` |
| Health path (LB) | `/healthz` (DB-free) |
| Postgres extensions | none |
| Repo | this repository |

## 0. Find the current primary (Doc 3 §1, run on the witness)
```
sudo -u postgres /usr/bin/pg_autoctl show state --pgdata /var/lib/postgresql/ha
```
Run the "on the primary" steps on whichever node is `primary`.

## 1. Extensions
None required — skip Doc 4 §1.

## 2. Create the database + user — ONCE, on the PRIMARY (Doc 4 §2)
```
openssl rand -base64 18          # save this as DB_PASSWORD
```
```
sudo -u postgres psql -p 5432
```
then type:
```
CREATE DATABASE db_orlandaforms;
CREATE USER orlandaforms WITH PASSWORD 'PASTE_PASSWORD';
GRANT ALL PRIVILEGES ON DATABASE db_orlandaforms TO orlandaforms;
\q
```
```
sudo -u postgres psql -p 5432 -d db_orlandaforms -c "GRANT ALL ON SCHEMA public TO orlandaforms;"
```
Verify it replicated — on the **standby**:
```
sudo -u postgres psql -p 5432 -c "\l" | grep db_orlandaforms
```

## 3. pg_hba.conf on BOTH servers (Doc 4 §3 / Doc 3 §7)
`sudo nano /var/lib/postgresql/ha/pg_hba.conf`, add at the bottom on **each** server:
```
host    db_orlandaforms  orlandaforms  127.0.0.1/32       scram-sha-256
host    db_orlandaforms  orlandaforms  172.16.0.0/12      scram-sha-256
hostssl db_orlandaforms  orlandaforms  46.62.186.134/32   scram-sha-256
hostssl db_orlandaforms  orlandaforms  193.70.47.219/32   scram-sha-256
```
Then on each: `sudo systemctl reload pgautofailover`.

## 4. Get the code onto BOTH servers (Doc 4 §4)
Repo: `https://github.com/armannurlanbek/orlanda-forms` (**private**; default
branch `main` carries the production-ready code). A private clone needs GitHub
auth — use a fine-grained PAT with read access, or a per-server read-only deploy
key. On **each** server:
```
cd /opt
sudo git clone https://github.com/armannurlanbek/orlanda-forms.git orlanda-forms
# when prompted: Username = armannurlanbek, Password = <your GitHub PAT>
cd orlanda-forms
```
This app ships **no bundled Postgres** — it already targets the cluster, so there
is nothing to strip from compose (unlike Doc 4's note).

## 5. Configure the app (Doc 4 §5)
Use the cluster compose file and a host-mode `.env`. On **each** server:
```
cp deploy/docker-compose.cluster.yml docker-compose.yml
nano .env
```
`.env` must be **identical on both servers** and contain at least:
```
DB_PASSWORD=<the password from step 2>
JWT_SECRET=<openssl rand -base64 48>
ANTHROPIC_API_KEY=<key>
MONDAY_API_TOKEN=<token>
APP_URL=https://forms.n8norlanda.com
PORT=8001
ANTHROPIC_MODEL=claude-sonnet-4-6
SUBMISSION_RETENTION_DAYS=90
# optional: SENTRY_DSN, ADMIN_EMAIL, ADMIN_PASSWORD, the rate-limit overrides
```
The compose file assembles `DATABASE_URL` from `${DB_PASSWORD}` in its
`environment:` block (Doc 4 §5 lesson — put the *password* in `.env`, assemble
the *URL* in compose). `network_mode: host` + `127.0.0.1:6432` avoids the
NAT-loopback problem (Doc 3 §8-G).

> `JWT_SECRET` must match on both servers, or sessions break after a failover —
> same reasoning as n8n's `N8N_ENCRYPTION_KEY` (Doc 4 appendix).

## 6. Start on the PRIMARY; build-but-stop on the STANDBY (Doc 4 §6)
Migrations run automatically in the container entrypoint (`prisma migrate
deploy`) before the app serves traffic.

On the **PRIMARY**:
```
cd /opt/orlanda-forms
docker compose up -d --build
docker compose logs --tail 60 -f      # watch migrations apply + API listen; Ctrl+C when stable
curl -i http://127.0.0.1:8001/healthz # expect 200
curl -i http://127.0.0.1:8001/health  # 200 = app -> router -> primary DB OK
```
Seed the first admin (once, on the primary):
```
docker compose exec app npm run seed   # prints a generated password unless ADMIN_PASSWORD is set
```
On the **STANDBY** — build but do NOT start:
```
cd /opt/orlanda-forms
sudo docker compose build
sudo docker compose ps                 # nothing running — correct for the standby
```

## 7. Role agent on BOTH servers (Doc 4 §7)
Add `/opt/orlanda-forms` to the role agent's `APP_DIRS` list (alongside
`/opt/roman-agent`) so failover starts/stops it automatically:
```
sudo nano /usr/local/bin/orlanda-role-agent.sh
# APP_DIRS=("/opt/roman-agent" "/opt/orlanda-forms")
sudo systemctl restart orlanda-role-agent
sudo journalctl -t orlanda-role -n 10
```
Keep `APP_DIRS` identical on both servers.

## 8. Cloudflare tunnel ingress on BOTH servers (Doc 4 §8)
`sudo nano /etc/cloudflared/config.yml`, add above the final `http_status:404`:
```yaml
  - hostname: forms.n8norlanda.com
    service: http://localhost:8001
```
Then `sudo systemctl restart cloudflared` on each (don't touch the per-server
`tunnel:`/`credentials-file:` lines).

## 9. Cloudflare Load Balancer (Doc 4 §9, dashboard)
Public LB for `forms.n8norlanda.com`, two pools:
- `hetzner-forms` → `eef8c8ec-751d-4015-a43e-97f658e44a6d.cfargotunnel.com`, Host header `forms.n8norlanda.com`
- `ovh-forms` → `a63d51ed-2749-446d-8a73-9f40a4f53f85.cfargotunnel.com`, Host header `forms.n8norlanda.com`

Health monitor: **HTTPS**, path **`/healthz`**, expect `200`, ~15s.
Steering: **Off / failover**, order `hetzner-forms` then `ovh-forms`.

## 10. Verify end-to-end (Doc 4 §10)
1. `https://forms.n8norlanda.com/app/login` loads; sign in with the seeded admin.
2. `https://forms.n8norlanda.com/health` returns 200 (app → router → primary DB).
3. App **running** on the primary, **stopped** on the standby.
4. Build a form, publish, open its public `/{slug}`, submit a test → confirm the
   item appears on the Monday board and the submission shows `mapped`.
5. Add an UptimeRobot **keyword** monitor on the public URL (Doc 3 §9).

## Updating later
On the **primary**: `cd /opt/orlanda-forms && git pull && docker compose up -d --build`
(the entrypoint re-runs `migrate deploy`). Pull/build on the standby too, leave it
stopped. Keep both servers' `.env` identical.

## Backups
Submissions are the system of record. Schedule a `pg_dump` of `db_orlandaforms`
from the primary (see README → Backups).
