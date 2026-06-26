# Orlanda Infrastructure — Server Reference Card

 **Document 2 of 4** · Last updated: 2026-05-29

 

 A dense, lookup-style reference of every concrete detail of the live system. When you need an IP, a port, a path, a service name, or a tunnel ID, it is here. For _why_ things are this way, see **Doc 1 (Architecture)**; for _how to operate_, see **Doc 3 (Runbook)**; to add an app, see **Doc 4 (Playbook)**.

 

> Conventions: commands that act on the database use 
> sudo -u postgres /usr/bin/pg_autoctl ...
> . The PGDATA path is 
> /var/lib/postgresql/ha
>  on all three nodes. 
> Always use the full path 
> /usr/bin/pg_autoctl
>  (see §7).

 

 

## 1. Servers

|  **Role (current)** |  **Provider / Location** |  **Public IP** |  **Hostname** |  **Login** |  **Spec** |
| --- | --- | --- | --- | --- | --- |
|  **Boss / primary** |  Hetzner, Finland (HEL1) |  `46.62.186.134` |  `hetzner-fi` |  `root` (password + IP) |  Xeon Gold 5412U, 256 GB RAM, 2×1.92 TB NVMe |
|  **Understudy / replica** |  OVH, France (Gravelines) |  `193.70.47.219` |  `ovh-fr` |  `arman` user (sudo) |  2×Xeon E5-2680 v3, 64 GB RAM, 2×480 GB SSD |
|  **Referee / monitor** |  DigitalOcean, Frankfurt (fra1) |  `188.166.162.156` |  `witness-de` |  `root` (SSH key) |  1 vCPU, 512 MB RAM, 10 GB + 2 GB swap |

 

 **Role is current, not fixed.** After a failover the Boss/Understudy roles swap between Hetzner and OVH. The witness is always the Referee.

 

 **SSH notes:**

 

-  Hetzner: logs in as `root` via password + IP (deliberately left unchanged; no key-only hardening was applied, to avoid lockout). `sudo` is redundant there but harmless.

-  OVH: logs in as `arman` (a sudo user). `arman` is in the `docker` group, so `docker` commands work without `sudo`.

-  Witness: `root` via SSH key (key provided by collaborator Alex). Example shape: `ssh -i <path-to-key> root@188.166.162.156`.

 

 

## 2. Ports

|  **Port** |  **Service** |  **Exposure** |  **Notes** |
| --- | --- | --- | --- |
|  `22` |  SSH |  Open to anywhere (v4 + v6) |  fail2ban guards it |
|  `5432` |  PostgreSQL |  **Only** from the 3 peer IPs |  The database itself |
|  `6432` |  db-router (HAProxy) |  Localhost (host-mode) |  Apps connect here, **not** 5432 |
|  `23267` |  Health checker (`is-primary-agent`) |  Localhost + peer IPs + Docker bridge `172.16.0.0/12` |  Answers 200=primary / 503=standby |
|  `8000` |  The `roman` app (uvicorn) |  Localhost (host-mode) |  Cloudflare tunnel dials this |

 

> Key gotcha:
>  apps connect to the database at 
> 127.0.0.1:6432
>  (the router), never directly at 
> 5432
> . The router is what follows the primary across failovers.

 

 **Connection map — what talks to what:**

 

![Image: ](https://orlanda-engineering.monday.com/protected_static/15336905/resources/233507958/06-connection-map.png)

 

 

## 3. Software (identical on all three nodes)

|  **Component** |  **Version / Detail** |
| --- | --- |
|  OS |  Ubuntu 24.04 LTS ("noble") |
|  PostgreSQL |  **16.14** (from the official PGDG apt repo, not Ubuntu's built-in) |
|  pg_auto_failover |  **2.2** — packages `postgresql-16-auto-failover`, `pg-auto-failover-cli` |
|  pgvector |  `postgresql-16-pgvector` — installed on Hetzner + OVH (required by the `roman` app) |
|  Docker |  Docker Engine + Compose plugin |
|  Firewall / security |  UFW, fail2ban, unattended-upgrades |
|  cloudflared |  `2026.5.2` (on Hetzner + OVH; **not** on the witness) |
|  HAProxy |  `haproxy:2.9-alpine` (Docker image, the db-router) |

 

 The base setup was applied with the login-preserving bootstrap script [**`01-base-NOLOGINCHANGE.sh`**](https://01-base-NOLOGINCHANGE.sh) (keeps firewall + Docker + fail2ban + auto-updates; skips user creation and SSH hardening).

 

 

## 4. Key file & directory paths

|  **What** |  **Path** |  **On which nodes** |
| --- | --- | --- |
|  PostgreSQL data directory (PGDATA) |  `/var/lib/postgresql/ha` |  All three |
|  PostgreSQL access-control file |  `/var/lib/postgresql/ha/pg_hba.conf` |  All three (**does not replicate**) |
|  pg_auto_failover systemd service |  `/etc/systemd/system/pgautofailover.service` |  All three |
|  Health checker script |  `/usr/local/bin/is-primary-agent.py` |  Hetzner + OVH |
|  Health checker service |  `/etc/systemd/system/is-primary-agent.service` |  Hetzner + OVH |
|  Role agent script |  `/usr/local/bin/orlanda-role-agent.sh` |  Hetzner + OVH |
|  Role agent service |  `/etc/systemd/system/orlanda-role-agent.service` |  Hetzner + OVH |
|  db-router folder (compose + haproxy.cfg) |  `/opt/db-router/` |  Hetzner + OVH |
|  cloudflared config |  `/etc/cloudflared/config.yml` |  Hetzner + OVH |
|  cloudflared credentials (Hetzner) |  `/root/.cloudflared/<tunnel-id>.json` |  Hetzner |
|  cloudflared credentials (OVH) |  `/home/arman/.cloudflared/<tunnel-id>.json` |  OVH |
|  The `roman` app |  `/opt/roman-agent/` |  Hetzner + OVH |

 

 

## 5. systemd services (what runs where, and its job)

|  **Service** |  **Nodes** |  **Job** |
| --- | --- | --- |
|  `pgautofailover` |  All three |  Runs the pg_auto_failover keeper/monitor — the Boss/Understudy/Referee logic. Enabled on boot. |
|  `is-primary-agent` |  Hetzner + OVH |  The health checker on port 23267 (200=primary, 503=standby). |
|  `orlanda-role-agent` |  Hetzner + OVH |  The watchdog that starts apps when local DB is primary, stops them otherwise. |
|  `cloudflared` |  Hetzner + OVH |  The Cloudflare tunnel (outbound) exposing apps to the internet. |
|  `fail2ban` |  All three |  Bans repeated failed SSH attempts. |
|  `docker` |  All three |  Container runtime. |

 

 The db-router and the `roman` app run as **Docker containers** (managed via `docker compose` in `/opt/db-router/` and `/opt/roman-agent/`), not as systemd units.

 

 

## 6. PostgreSQL cluster facts

 **Monitor (Referee) URI** — how nodes reach the witness:

 

```
postgres://autoctl_node@188.166.162.156:5432/pg_auto_failover?sslmode=require

```

 

 **Node identities** (fixed regardless of current role):

 

-  `node_1` = Hetzner (`46.62.186.134`)

-  `node_2` = OVH (`193.70.47.219`)

 

 **Replication mode = TRUE ASYNC.** Confirmed by:

 

```
number_sync_standbys      | 0
synchronous_standby_names | ''        ← empty = true async (the proof)
node_2 replication quorum | false     ← disables sync waiting (this is what makes it async)
node_1 replication quorum | true      ← only matters when node_1 is the standby; leave as-is

```

 

 Async was enabled with (run on the witness):

 

```
sudo -u postgres /usr/bin/pg_autoctl set node replication-quorum false \
  --pgdata /var/lib/postgresql/ha --name node_2

```

 

 **Healthy state looks like** (run `pg_autoctl show state` on the witness):

 

```
  Name |  Node |          Host:Port |       TLI: LSN |   Connection |  Reported State
-------+-------+--------------------+----------------+--------------+----------------
node_1 |     1 | 46.62.186.134:5432 |   2: 0/50000D8 |   read-write |         primary
node_2 |     2 | 193.70.47.219:5432 |   2: 0/50000D8 |    read-only |       secondary

```

 

 Identical LSN values on both rows = zero replication lag. (The `TLI` number increases each time a failover/switchover occurs — it is the replication "timeline.")

 

 

## 7. ⚠ Critical path note: `pg_autoctl` location

 On these servers `pg_autoctl` lives at **`/usr/bin/pg_autoctl`** — **not** at `/usr/lib/postgresql/16/bin/pg_autoctl` (which some older guides assume). Every `pg_autoctl` command, including the systemd and `show` commands, must use `/usr/bin/pg_autoctl`. Using the wrong path produces a `command not found` error.

 

 

## 8. Databases & users

|  **Database** |  **User** |  **App** |  **Notes** |
| --- | --- | --- | --- |
|  `appdb` |  (internal) |  — |  Created by pg_auto_failover for its own management/replication. **NOT for app use.** |
|  `db_roman` |  `roman` |  `roman` agent app ([`roman.n8norlanda.com`](https://roman.n8norlanda.com)) |  Live. Has the `vector` (pgvector) extension installed. |
|  `db_n8n` |  `n8n` |  n8n |  **Not created yet** — future app. |
|  `db_platform` |  `platform` |  platform app |  **Not created yet** — future app. |

 

 App databases are created **once on the primary** and replicate to the Understudy automatically. Each app database is created with `GRANT ALL ON SCHEMA public` to its user (required on PostgreSQL 16 so the app can create its tables).

 

 

## 9. Firewall rules (UFW, all three nodes)

|  **Port** |  **Allowed from** |
| --- | --- |
|  `22/tcp` |  Anywhere (v4 + v6) |
|  `5432/tcp` |  `46.62.186.134`, `193.70.47.219`, `188.166.162.156` (the three peer IPs only) |
|  `23267/tcp` |  `172.16.0.0/12` (Docker bridge), `46.62.186.134`, `193.70.47.219` |

 

 No inbound HTTP/HTTPS is open anywhere — cloudflared tunnels outbound. The DigitalOcean witness was confirmed to have **no** separate cloud-firewall blocking (a `nc -zv` test to 5432 succeeded).

 

 

## 10. `pg_hba.conf` trust lines (the auth that makes replication work)

 `pg_hba.conf` **does not replicate** — these are maintained per-server, and **order matters** (first match wins, so `trust` lines must sit **above** any auto-generated `scram-sha-256` lines for the same user/IP). The cluster uses `trust` scoped to the known peer IPs, which is safe because the firewall already restricts port 5432 to those IPs and TLS is on.

 

 **Crucially, the auth must exist in BOTH directions** — each server must trust the _other_ server's IP for the replicator, because after a failover the replication direction reverses. Missing the reverse direction is what causes a failback to stall (see Doc 3).

 

 **On Hetzner** — trust lines for the replicator from OVH + witness:

 

```
hostssl "appdb"       "pgautofailover_replicator" 193.70.47.219/32   trust
hostssl replication   "pgautofailover_replicator" 193.70.47.219/32   trust
hostssl "appdb"       "pgautofailover_replicator" 188.166.162.156/32 trust
hostssl replication   "pgautofailover_replicator" 188.166.162.156/32 trust

```

 

 **On OVH** — the mirror: trust lines for the replicator from Hetzner (+ witness):

 

```
hostssl "appdb"       "pgautofailover_replicator" 46.62.186.134/32   trust
hostssl replication   "pgautofailover_replicator" 46.62.186.134/32   trust

```

 

 **On the witness** — trust lines for `autoctl_node` from the three peer IPs.

 

 **Per-app connection lines** (example, `roman` — present on both Hetzner and OVH):

 

```
host    db_roman  roman  127.0.0.1/32       scram-sha-256
host    db_roman  roman  172.16.0.0/12      scram-sha-256
hostssl db_roman  roman  46.62.186.134/32   scram-sha-256
hostssl db_roman  roman  193.70.47.219/32   scram-sha-256

```

 

 (The `127.0.0.1` and `172.16.0.0/12` lines are for local/in-machine app traffic; the peer-IP `hostssl` lines let the router forward an app connection across servers after a failover.)

 

> Two quoting rules that bit us: the database keyword 
> replication
>  must be 
> unquoted
>  to match a replication-protocol connection; and 
> trust
>  rules must be ordered 
> above
>  the auto-generated 
> scram-sha-256
>  rules. See Doc 3 §troubleshooting.

 

 After any `pg_hba.conf` edit, reload with `sudo systemctl reload pgautofailover` on that node.

 

 

## 11. Cloudflare

|  **Item** |  **Value** |
| --- | --- |
|  Domain (zone) |  [`n8norlanda.com`](https://n8norlanda.com) (managed in Cloudflare) |
|  Hetzner tunnel name |  `orlanda-hetzner` |
|  Hetzner tunnel ID |  `eef8c8ec-751d-4015-a43e-97f658e44a6d` |
|  OVH tunnel name |  `orlanda-ovh` |
|  OVH tunnel ID |  `a63d51ed-2749-446d-8a73-9f40a4f53f85` |
|  Old (legacy) tunnel |  `n8n-orlanda` (`ca2ee98b-7451-4cdf-955c-c63a48398caf`) — leave alone |
|  Tunnel origin form (for LB) |  `<tunnel-id>.cfargotunnel.com` |
|  Load Balancing |  Paid add-on (~$5/mo), enabled |

 

 **Tunnel ingress** (in `/etc/cloudflared/config.yml` on each server) routes hostnames to local apps. Current `roman` entry:

 

```yaml
ingress:
  - hostname: roman.n8norlanda.com
    service: http://localhost:8000
  - service: http_status:404

```

 

 Each server's config uses its **own** tunnel ID and credentials path (Hetzner: `/root/...`; OVH: `/home/arman/...`).

 

 **Load balancer for **[**`roman.n8norlanda.com`**](https://roman.n8norlanda.com) (active-passive):

 

-  Pool `hetzner-pool` → endpoint `eef8c8ec-...cfargotunnel.com`, **Host header** = [`roman.n8norlanda.com`](https://roman.n8norlanda.com)

-  Pool `ovh-pool` → endpoint `a63d51ed-...cfargotunnel.com`, **Host header** = [`roman.n8norlanda.com`](https://roman.n8norlanda.com)

-  Health monitor: HTTPS, path **`/healthz`** (the DB-free endpoint), expect `200`, ~15 s

-  Steering: **Off / failover** (use first healthy pool: Hetzner, then OVH)

 

> Two LB gotchas:
>  (1) the endpoint must be 
> <tunnel-id>.cfargotunnel.com
>  with the app hostname in the 
> Host header
>  — you cannot use the app hostname directly as the endpoint; (2) health-check the 
> /healthz
>  path (no DB), not 
> /health
>  (which queries the DB and can flap).

 

 

## 12. The `roman` app specifics

|  **Item** |  **Value** |
| --- | --- |
|  Public URL |  [`https://roman.n8norlanda.com`](https://roman.n8norlanda.com) |
|  Repo |  [`github.com/armannurlanbek/linkedin_bot`](https://github.com/armannurlanbek/linkedin_bot) |
|  Folder on servers |  `/opt/roman-agent/` (Hetzner + OVH) |
|  Stack |  FastAPI + SQLAlchemy 2.0 (sync engine via `psycopg2`) |
|  Listens on |  port `8000` (uvicorn), host network mode |
|  DB |  `db_roman` / user `roman`, via router at `127.0.0.1:6432` |
|  Requires |  pgvector extension (cosine similarity on 1536-dim embeddings) |
|  Health endpoints |  `/healthz` (no DB, for the LB) and `/health` (runs `SELECT 1` through the DB) |
|  Compose |  `network_mode: host`; DB URLs assembled from `${DB_PASSWORD}` in the `environment:` block; both `DATABASE_URL_SYNC` and `DATABASE_URL` required even though only the sync one drives the engine |
|  Required env |  `DB_PASSWORD`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `COOKIE_SECRET` (optional: `TAVILY_API_KEY`, `APP_PASSWORD`) |

 

 On Hetzner the app is **running** (it's the primary); on OVH it is **built but stopped** (it's the standby) — the role agent starts it there only on failover.

 

 

## 13. Outstanding / not-yet-done

-  **UptimeRobot keyword monitor** on [`roman.n8norlanda.com`](https://roman.n8norlanda.com) (check for a word only present when the app loads, not a plain ping) — not set up yet.

-  **Uptime monitoring on the witness itself** — important, since the witness must be reachable for automatic failover. Not set up yet.

-  **`db_n8n`**** and ****`db_platform`** and their apps — future deployments (use Doc 4).

 

 

 _End of Document 2. See Doc 3 (Operations Runbook) for commands and troubleshooting, and Doc 4 (Deploy-a-New-App Playbook) for adding the next app._

 