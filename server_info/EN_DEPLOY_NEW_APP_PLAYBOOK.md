# Orlanda Infrastructure — Deploy-a-New-App Playbook

 **Document 4 of 4** · Last updated: 2026-05-29

 

 The complete, start-to-finish recipe for adding a new application (n8n, platform, or anything else) to the failover cluster. Every step has a **"what this does"** and a **verification**. Follow it in order. It is derived directly from the live `roman` deployment, including the lessons learned.

 

 For _why_ the architecture works this way see **Doc 1**; for exact IPs/paths see **Doc 2**; for troubleshooting any step see **Doc 3 §8**.

 

> The mental model for this whole playbook:
>  the heavy infrastructure (cluster, witness, routers, role agents, tunnels) is already built and 
> never changes
>  when you add an app. You only ever touch the 
> app layer
>  on top: a database, a container, a tunnel ingress line, a load balancer. The same recipe works for app #2 and app #20.

 

> Golden rules while doing this
>  (from Doc 3): paste 
> one command at a time
> ; edit files with 
> nano
> , never multi-line heredocs; use 
> /usr/bin/pg_autoctl
> ; do app work on the 
> current primary
>  first, then mirror to the standby and leave it 
> stopped
> .

 

 **The whole recipe at a glance:**

 

![Image: ](https://orlanda-engineering.monday.com/protected_static/15336905/resources/233508179/09-deploy-sequence.png)

 

 _Steps shaded green touch the database, blue the app layer, light-blue the public/network layer. The failover infrastructure underneath never changes._

 

 

## 0. Before you start — gather these

 Decide/collect up front so you're not blocked mid-way:

 

-  **App name** — used for the database, user, folder, and hostname. This playbook uses `<APP>` as the placeholder (e.g. `n8n`). Pick a name you won't be confused by later.

-  **Hostname** — e.g. `<APP>.n8norlanda.com`.

-  **The app's code** — ideally a git repo you can clone on both servers.

-  **A free local port** for the app to listen on — must not collide with anything already on the host. In use already: `5432` (Postgres), `6432` (db-router), `8000` (roman), `23267` (health checker). Pick e.g. `8001`, `8002`, etc. This playbook uses `<PORT>`.

-  **Which Postgres extensions the app needs** (if any) — e.g. `roman` needed `pgvector`. Check the app's code/migrations.

-  **The app's required env vars / secrets** — API keys, encryption keys, etc.

-  **The app's health endpoint** — ideally a **DB-free** path (like `/healthz`) for the load balancer. If the app doesn't have one, note its real health path; avoid pointing the LB at a DB-touching endpoint.

 

 

 **Find out which server is currently the primary** before you begin (Doc 3 §1), and run all "on the primary" steps there:

 

```
sudo -u postgres /usr/bin/pg_autoctl show state --pgdata /var/lib/postgresql/ha

```

 

 

 

## 1. (If needed) Install required Postgres extensions — on BOTH servers

 **What this does:** an extension's binary files must exist on whichever server is primary — and since the primary can move, on **both**. The extension _data_ replicates; the binaries do not.

 

 Skip this step if the app needs no special extension. If it does (example: pgvector):

 

 On **Hetzner**, then **OVH**:

 

```
sudo apt-get install -y postgresql-16-<EXTENSION>

```

 

 (e.g. `postgresql-16-pgvector`). No restart needed.

 

 **Verify** on each server:

 

```
apt -qq list --installed 2>/dev/null | grep <EXTENSION>

```

 

 

## 2. Create the app's database + user — ONCE, on the PRIMARY

 **What this does:** creates the database and login. You do this **once on the primary** and it replicates to the standby automatically.

 

 **Step 2a — generate a password and save it** (you'll need it for the app's `.env`):

 

```
openssl rand -base64 18

```

 

 **Step 2b — create the database, user, and grant** (on the **primary**, via the local socket so there's no auth fuss). Paste the password in place of `PASTE_PASSWORD`:

 

```
sudo -u postgres psql -p 5432 <<'SQL'
CREATE DATABASE db_<APP>;
CREATE USER <APP> WITH PASSWORD 'PASTE_PASSWORD';
GRANT ALL PRIVILEGES ON DATABASE db_<APP> TO <APP>;
SQL

```

 

> If the heredoc scrambles on paste, instead run 
> sudo -u postgres psql -p 5432
>  to open an interactive prompt and type the four SQL lines one at a time, then 
> \q
> .

 

 **Step 2c — grant schema rights** (PostgreSQL 16 requires this or the app can't create tables):

 

```
sudo -u postgres psql -p 5432 -d db_<APP> -c "GRANT ALL ON SCHEMA public TO <APP>;"

```

 

 **Step 2d — (if needed) create the extension as superuser** so the app's boot-time `CREATE EXTENSION` sails past it (the app's user isn't a superuser and couldn't create it alone):

 

```
sudo -u postgres psql -p 5432 -d db_<APP> -c "CREATE EXTENSION IF NOT EXISTS <EXTENSION>;"

```

 

 **Step 2e — verify it replicated to the standby.** On the **standby**:

 

```
sudo -u postgres psql -p 5432 -c "\l" | grep db_<APP>

```

 

 Seeing `db_<APP>` on the standby is proof the cluster is carrying the new data across. If you created an extension, also confirm it came across:

 

```
sudo -u postgres psql -p 5432 -d db_<APP> -c "\dx" | grep <EXTENSION>

```

 

 

## 3. Allow the app to connect — `pg_hba.conf` on BOTH servers

 **What this does:** authorizes the app's database login. `pg_hba.conf` **does not replicate** and its order matters — so edit it on **both** servers, with `nano` (not a heredoc).

 

 On **each** of Hetzner and OVH:

 

```
sudo nano /var/lib/postgresql/ha/pg_hba.conf

```

 

 Add these lines at the **bottom** (they're `scram-sha-256` app rules; they don't conflict with the replicator `trust` rules above, so bottom placement is fine here):

 

```
host    db_<APP>  <APP>  127.0.0.1/32       scram-sha-256
host    db_<APP>  <APP>  172.16.0.0/12      scram-sha-256
hostssl db_<APP>  <APP>  46.62.186.134/32   scram-sha-256
hostssl db_<APP>  <APP>  193.70.47.219/32   scram-sha-256

```

 

-  The `127.0.0.1` + `172.16.0.0/12` lines cover the app reaching the router/DB locally.

-  The two peer-IP `hostssl` lines let the router forward the app's connection across servers after a failover.

 

 Save and exit (`Ctrl+O`, `Enter`, `Ctrl+X`), then reload on **each** server:

 

```
sudo systemctl reload pgautofailover

```

 

 **Verify** the rules parsed (on each server):

 

```
sudo -u postgres psql -p 5432 -c "SELECT line_number, database, address, auth_method FROM pg_hba_file_rules WHERE user_name='{<APP>}' ORDER BY line_number;"

```

 

 

## 4. Get the app's code onto BOTH servers

 **What this does:** places the app (software) on each server. The database copies _data_, not _software_, so each server needs its own copy.

 

 On **each** of Hetzner and OVH:

 

```
cd /opt
sudo git clone <YOUR_REPO_URL> <APP>
cd <APP>

```

 

 (If the working code only exists on one server and isn't in git, copy the folder server-to-server with `scp -r` instead. Whatever you do, the two servers' folders should end up identical.)

 

> Important compose adaptation
>  the app almost certainly needs (this is what we did for 
> roman
> ): if the app ships with its 
> own
>  Postgres container, 
> remove
>  it — the 
> postgres
>  service, its 
> depends_on
> , and its volume. The app must use the cluster, not a bundled DB.

 

 

## 5. Configure the app to use the cluster (the connection pattern that works)

 **What this does:** points the app at the **db-router** so it always reaches the current primary, and runs it in **host network mode** to avoid the Docker NAT-loopback problem (see Doc 3 §8-G for why).

 

 The fixed pattern, identical for every app:

 

-  **DB host/port:** `127.0.0.1:6432` (the router) — **never** a server IP, never `host.docker.internal`, never `5432` directly.

-  **Database / user:** `db_<APP>` / `<APP>`.

-  **`network_mode: host`** on the app's service.

-  **App listens on** `<PORT>` (no `ports:` mapping needed in host mode — it binds the host port directly).

 

 **Edit the compose file** with `nano` (on **each** server — keep them identical):

 

```
sudo nano /opt/<APP>/docker-compose.yml

```

 

 A minimal host-mode service looks like this (adapt the env var names to the app's actual config; shown is the `roman`-style pattern where DB URLs are assembled from a password in `.env`):

 

```yaml
services:
  app:
    build: .
    env_file: .env
    network_mode: host
    environment:
      DATABASE_URL: postgresql://<APP>:${DB_PASSWORD}@127.0.0.1:6432/db_<APP>
      # add a second URL form here if the app requires one (e.g. async driver)
    restart: unless-stopped

```

 

 

 **Two lessons baked in here:**

 

-  If the app requires **multiple DB URL forms** (e.g. a sync and an async one), set **all** of them — `roman` wouldn't boot without both present, even though only one drove the engine.

-  Assembling the URL from `${DB_PASSWORD}` works only in the `environment:` block (Compose interpolates it there). If you instead put the full `${...}` URL in `.env` and load it via `env_file:`, Compose passes it **literally** un-expanded. So: put the _password_ in `.env`, assemble the _URL_ in `environment:`.

 

 

 **Create the ****`.env`** on **each** server (`nano`, not a heredoc; keep secrets out of git):

 

```
sudo nano /opt/<APP>/.env

```

 

 Add `DB_PASSWORD=` (the one from Step 2a) plus all the app's required keys. **The ****`.env`**** must be identical on both servers** — especially any encryption key (e.g. n8n's `N8N_ENCRYPTION_KEY`), or credentials break after a failover.

 

> Tip for copying 
> .env
>  between servers without retyping secrets:
>  from the primary, 
> scp /opt/<APP>/.env arman@193.70.47.219:/tmp/<APP>.env
> , then on the standby 
> sudo mv /tmp/<APP>.env /opt/<APP>/.env
> . (Adjust direction/user for your case.)

 

 

## 6. Start the app on the PRIMARY; build-but-leave-stopped on the STANDBY

 **What this does:** brings the app live on the primary, and prepares it on the standby without running it (the role agent will start it there only on failover — running it on both at once causes duplicate work).

 

 **On the PRIMARY:**

 

```
cd /opt/<APP>
docker compose up -d
docker compose logs --tail 40 -f      # watch it boot; Ctrl+C when stable

```

 

 You want a clean startup with no DB connection errors. Then test locally:

 

```
curl -i http://127.0.0.1:<PORT>/healthz     # or the app's real health path → expect 200

```

 

 If the app has a DB-aware health endpoint, hit it too — a 200 there proves app → router → primary DB works end to end.

 

 **On the STANDBY** — build but **do not** start:

 

```
cd /opt/<APP>
sudo docker compose build
sudo docker compose ps        # confirm NOTHING is running — correct for the standby

```

 

 

## 7. Add the app to the role agent — on BOTH servers

 **What this does:** makes failover hands-free for this app, by adding it to the watchdog that starts/stops apps based on primary status.

 

 The role agent script is `/usr/local/bin/orlanda-role-agent.sh`. As written for `roman`, it manages a single folder (`COMPOSE_DIR="/opt/roman-agent"`). To have it manage **multiple** apps, generalize it to loop over a list of app folders.

 

 On **each** server, edit:

 

```
sudo nano /usr/local/bin/orlanda-role-agent.sh

```

 

 Change the single `COMPOSE_DIR` approach to a list, and make the up/down helpers loop. The key edits:

 

```bash
# replace the single COMPOSE_DIR line with a list of app folders:
APP_DIRS=("/opt/roman-agent" "/opt/<APP>")

# make the helpers act on every app in the list:
apps_up()   { for d in "${APP_DIRS[@]}"; do (cd "$d" && docker compose up -d); done; }
apps_down() { for d in "${APP_DIRS[@]}"; do (cd "$d" && docker compose stop); done; }

```

 

 Everything else in the script (the 23267 probe, the streak/hysteresis logic) stays the same. Save and exit, then restart the role agent on **each** server:

 

```
sudo systemctl restart orlanda-role-agent

```

 

 **Verify** on the **primary** it logs that it's starting the apps, and on the **standby** that it keeps them stopped:

 

```
sudo journalctl -t orlanda-role -n 10

```

 

 (Primary: the new app should now be running. Standby: still stopped.)

 

> Keep the 
> APP_DIRS
>  list 
> identical on both servers
> .

 

 

## 8. Add a tunnel ingress route — on BOTH servers

 **What this does:** tells each server's existing Cloudflare tunnel how to reach this app locally. You do **not** create a new tunnel — both tunnels already exist; you just add an ingress line.

 

 On **each** server, edit the tunnel config:

 

```
sudo nano /etc/cloudflared/config.yml

```

 

 Add a `hostname` block for the new app **above** the final `http_status:404` line. The file should look like (note: keep the existing `roman` entry; add the new one):

 

```yaml
ingress:
  - hostname: roman.n8norlanda.com
    service: http://localhost:8000
  - hostname: <APP>.n8norlanda.com
    service: http://localhost:<PORT>
  - service: http_status:404

```

 

> Don't touch the 
> tunnel:
>  and 
> credentials-file:
>  lines — those differ per server (Hetzner 
> /root/...
> , OVH 
> /home/arman/...
> ) and must stay as they are. Watch YAML indentation: the 
> - hostname
>  items are nested under 
> ingress:
> , and 
> service:
>  is nested under its hostname.

 

 Save and exit, then restart cloudflared on **each** server:

 

```
sudo systemctl restart cloudflared

```

 

 **Verify** it registered connections (no errors):

 

```
sudo journalctl -u cloudflared -n 15

```

 

 

## 9. Create the Cloudflare Load Balancer for the hostname (dashboard)

 **What this does:** points `<APP>.n8norlanda.com` at **both** tunnels with a health check, so public traffic follows the active server. Done in the Cloudflare dashboard (browser), in the [`n8norlanda.com`](https://n8norlanda.com) zone → **Traffic → Load Balancing**.

 

 Create a **public load balancer** for hostname `<APP>.n8norlanda.com`, with:

 

 **Two origin pools** (one per server):

 

-  Pool `hetzner-<APP>` → endpoint address [`eef8c8ec-751d-4015-a43e-97f658e44a6d.cfargotunnel.com`](https://eef8c8ec-751d-4015-a43e-97f658e44a6d.cfargotunnel.com) → **Host header** = `<APP>.n8norlanda.com`

-  Pool `ovh-<APP>` → endpoint address [`a63d51ed-2749-446d-8a73-9f40a4f53f85.cfargotunnel.com`](https://a63d51ed-2749-446d-8a73-9f40a4f53f85.cfargotunnel.com) → **Host header** = `<APP>.n8norlanda.com`

 

 **A health monitor:**

 

-  Type **HTTPS**, path **`/healthz`** (or the app's DB-free health path), expected code `200`, interval ~15 s. (If the monitor has its own Host-header field, set it to `<APP>.n8norlanda.com` too.)

 

 **Steering / fallback** (active-passive):

 

-  Pool order: `hetzner-<APP>` first, then `ovh-<APP>`.

-  Steering method: **Off / failover** (use the first healthy pool).

 

 Save/deploy.

 

 

 **The two LB gotchas (don't skip):**

 

-  The endpoint **must** be `<tunnel-id>.cfargotunnel.com` **with the app hostname in the Host header** — you cannot use the app hostname directly as the endpoint, and without the Host header the tunnel's ingress won't match and the health check fails even though the app is fine.

-  Health-check the **`/healthz`** (DB-free) path, **not** a DB-touching endpoint, or the pool can flap.

 

 

 **Expected:** `hetzner-<APP>` pool shows **healthy**, `ovh-<APP>` shows **unhealthy** (correct — OVH is the standby and isn't running the app). On a failover, OVH's role agent starts the app, its pool goes healthy, and the LB shifts traffic.

 

 

## 10. End-to-end verification

1.  **Browser:** open `https://<APP>.n8norlanda.com` — the app should load (served by the primary).

2.  **DB path:** the app's DB-aware health endpoint returns 200 (app → router → primary DB works).

3.  **Single-writer:** app **running** on the primary, **stopped** on the standby (`docker compose ps` in `/opt/<APP>` on each).

4.  **(Optional) failover test:** at a calm moment, run the drill (Doc 3 §5) and confirm the new app also moves to the survivor and stays reachable. Recover per Doc 3 §6.

5.  **Monitoring:** add an UptimeRobot **keyword** monitor for `<APP>.n8norlanda.com` (Doc 3 §9).

 

 

## 11. Quick checklist (the whole recipe at a glance)

- [ ]  Confirm which server is the **primary** (Doc 3 §1)


- [ ]  (If needed) install required extension on **both** servers (§1)


- [ ]  Create `db_<APP>` + user + grants on the **primary**; verify it replicated (§2)


- [ ]  (If needed) create the extension in the DB on the **primary** (§2d)


- [ ]  Add `pg_hba.conf` app lines on **both** servers; reload each (§3)


- [ ]  Clone the app code on **both** servers; remove any bundled Postgres container (§4)


- [ ]  Set compose to host-mode, DB at `127.0.0.1:6432`; create identical `.env` on both (§5)


- [ ]  `up -d` on the **primary**; `build` only (stopped) on the **standby** (§6)


- [ ]  Add the app folder to the role agent's list on **both** servers; restart it (§7)


- [ ]  Add a tunnel ingress line on **both** servers; restart cloudflared (§8)


- [ ]  Create the Cloudflare load balancer (2 pools + Host header + `/healthz` monitor) (§9)


- [ ]  Verify end to end; add monitoring (§10)


 

> The failover machinery (witness, routers, role agent framework, tunnels) does 
> not
>  change. You only added an app-layer slice. That's the whole point of the design.

 

 

## Appendix — n8n-specific notes (when you deploy it)

 n8n is the most likely next app, and it has two quirks worth pre-empting:

 

-  **`N8N_ENCRYPTION_KEY`**** must be identical on both servers.** n8n encrypts stored credentials with it; if the standby has a different key, after a failover n8n can't decrypt any credential and all workflows break. Generate it once (`openssl rand -base64 24`) and put the same value in both servers' `.env`.

-  **n8n configures Postgres via discrete env vars, not a single DSN.** It uses `DB_TYPE=postgresdb`, `DB_POSTGRESDB_HOST`, `DB_POSTGRESDB_PORT`, `DB_POSTGRESDB_DATABASE`, `DB_POSTGRESDB_USER`, `DB_POSTGRESDB_PASSWORD`. Point `DB_POSTGRESDB_HOST=127.0.0.1` and `DB_POSTGRESDB_PORT=6432` (the router). If n8n complains about SSL on the DB connection, add `DB_POSTGRESDB_SSL_ENABLED=true` and `DB_POSTGRESDB_SSL_REJECT_UNAUTHORIZED=false`.

-  Recommended reliability env: `EXECUTIONS_DATA_SAVE_ON_SUCCESS=all` and `EXECUTIONS_DATA_MAX_AGE=720` (retain execution history ~30 days for post-outage diagnosis).

-  n8n's web UI port is `5678` — use that as `<PORT>` for its tunnel ingress and pick a health path that doesn't require the DB for the load balancer.

 

 _End of Document 4. This completes the four-document set: Architecture (1), Server Reference (2), Operations Runbook (3), and this Deploy-a-New-App Playbook (4)._

 