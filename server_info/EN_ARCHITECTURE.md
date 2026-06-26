# Orlanda Infrastructure — Architecture & How It Works

 **Document 1 of 4** · Last updated: 2026-05-29

 

 This document explains _what the system is and why it works the way it does_. It is the conceptual reference — read this first to understand the design before touching anything. For exact IPs/paths see **Doc 2 (Server Reference)**, for day-to-day commands see **Doc 3 (Operations Runbook)**, and to add a new app see **Doc 4 (Deploy-a-New-App Playbook)**.

 

> Status:
>  The system is fully built and tested. Failover has been proven live in both directions (Hetzner→OVH and back), including recovering a downed server and a planned switchover. The first application (
> roman
> ) runs on it in production.

 

 

## 1. The goal, in one paragraph

 Orlanda runs applications that previously lived on a single unreliable server, which went down. The objective is a **two-server automatic-failover system spanning two providers and two countries**, so that if one server dies, the other takes over **with no human intervention**. That last requirement is the whole reason for the design's complexity: nobody is reliably awake or reachable to respond to a 3 a.m. outage, so the system must heal itself. A third tiny "witness" server acts as a neutral tie-breaker that makes safe automatic failover possible.

 

 

## 2. The mental model: Boss, Understudy, Referee

 Hold this picture in your head; every part of the system maps onto it.

 

-  **Boss** — the active server and PostgreSQL **primary**. It accepts writes and runs the apps. (Currently Hetzner, in Finland.)

-  **Understudy** — the standby server and PostgreSQL **replica**. It holds a live, read-only copy of the database and keeps the apps installed but stopped, ready to take over. (Currently OVH, in France.)

-  **Referee** — the **witness**. A tiny server that holds no application data. Its only job is to watch the Boss and the Understudy and decide when a failover should happen. It is the neutral third vote that prevents "split-brain." (DigitalOcean, in Frankfurt.)

 

 The roles are not permanently bound to specific machines — they swap. After a failover, the Understudy becomes the Boss, and the recovered server rejoins as the new Understudy. "Boss" and "Understudy" describe _current role_, not _identity_.

 

![Image: ](https://orlanda-engineering.monday.com/protected_static/15336905/resources/233507844/01-topology.png)

 

 _Roles are current, not fixed: after a failover the Boss/Understudy roles swap between Hetzner and OVH; the witness is always the Referee._

 

 

## 3. Why a third "witness" node is mandatory

 This is the single most important design point, so it gets its own section.

 

 With exactly **two** database servers, when they lose contact with each other, neither can tell which of two very different situations is happening:

 

1.  **The other server actually died** → the survivor _should_ take over as primary.

2.  **The network link between the two countries broke, but both servers are alive** → the survivor should _not_ take over, because the other one is still serving.

 

 From either server's point of view these look **identical** — the other one simply goes silent. If a server decided on its own, it would sometimes guess wrong. The dangerous wrong guess: the Understudy promotes itself while the Boss is still alive. Now **both** think they are the primary, both accept writes, and the database splits into two diverging copies with no clean way to merge them. This is **split-brain**, and it is _worse_ than downtime because it is silent data corruption.

 

 The witness solves this by being a neutral third vote in a third location. The rule becomes: **a server may only be primary if it can reach a majority of the three nodes.** Walk the cases:

 

-  **Boss truly dies:** Understudy + Witness can still see each other (2 of 3 = majority). They agree the Boss is gone, and the Witness authorizes promotion. Failover happens. ✓

-  **Network link breaks, both servers alive:** the Boss still reaches the Witness (2 of 3), so it keeps serving. The Understudy also reaches the Witness, which tells it "the Boss still holds the primary role — do not promote." No split-brain. ✓

-  **Understudy dies:** Boss + Witness see each other, the Boss keeps serving, nothing to promote. ✓

 

 **Consequence to remember:** the witness must stay alive for _automatic_ failover to work. If it is down at the moment the Boss dies, the Understudy cannot get majority approval and will not promote — failover stalls. The witness does almost nothing day-to-day, but it must be **reachable**, which is why it needs its own uptime monitoring (see Doc 3).

 

 

## 4. The core design decisions, and why

 Each of these was deliberately chosen. Do not re-litigate them without re-reading the "why."

 

|  **Decision** |  **Choice** |  **Why** |
| --- | --- | --- |
|  **Failover automation level** |  Full auto — the database promotion is automatic, not just traffic rerouting |  Nobody is reliably reachable to run a manual promotion at night. This is what makes the witness node mandatory rather than optional. |
|  **Database failover tool** |  **pg_auto_failover 2.2** |  Simplest automatic tool for a 2-node-plus-monitor topology. Patroni+etcd was rejected as too heavy (needs a 3-node etcd cluster, hard to debug under stress). |
|  **Replication mode** |  **Asynchronous** |  Full write speed (no waiting on the other country, ~20–30 ms saved per write), at the cost of a sub-second data-loss window if the primary dies mid-write. Acceptable because this is automation data, not finance. See §6 for the important subtlety about what "async" means here. |
|  **PostgreSQL location** |  **Directly on the host OS, not in Docker** |  Makes pg_auto_failover simpler and more reliable. The apps stay in Docker and reach the database through a local router. |
|  **Database instances** |  **One shared PostgreSQL per server holding all app databases** |  Failover moves the whole database as one clean unit. Per-app database containers were rejected: they would fail over independently and could split data across two countries. |
|  **App→database routing** |  **A local "db-router" (HAProxy) on each server** |  Apps connect to a fixed local address and never need to know which server is primary. The router always forwards to the current primary. On failover the router redirects itself; the apps notice nothing. |
|  **App start/stop on failover** |  **A "role agent" watchdog on each server** |  pg_auto_failover fails over the _database_ but does nothing about app containers. Apps must run **only** where the database is primary (running an app on both servers at once = duplicate cron/webhooks/work). The role agent starts apps when its local database is primary and stops them otherwise. |
|  **Public traffic routing** |  **Cloudflare Tunnel + Cloudflare Load Balancer** |  cloudflared dials _outbound_, so no inbound web ports are ever opened (a big security win — the firewall exposes zero HTTP/HTTPS). The load balancer health-checks both servers and routes to the healthy one. |
|  **nginx** |  **Dropped** |  cloudflared handles subdomain routing directly; nginx earned no place. |
|  **Base server hardening** |  **Login-preserving variant** ([`01-base-NOLOGINCHANGE.sh`](https://01-base-NOLOGINCHANGE.sh)) |  Working SSH access already existed and we deliberately avoided creating new users or changing SSH, to prevent lockout/confusion. The script keeps firewall + Docker + fail2ban + auto-updates but skips user creation and SSH hardening. |

 

 

## 5. What replicates between servers, and what does NOT

 This distinction caused real confusion during the build, so it is load-bearing. Internalize it.

 

 **Copies automatically (the database streaming replication):**

 

-  Everything _inside_ PostgreSQL — every row, every table, and any _new database_ you create on the primary. Create `db_newapp` on the Boss and it appears on the Understudy within a second, with zero extra configuration.

 

 **Does NOT copy (you must place these on both servers yourself):**

 

-  The application containers and their code.

-  `docker-compose.yml`, `.env`, and any config files.

-  `pg_hba.conf` — the PostgreSQL access-control file. **It is a file, not data, so it does not replicate.** This is the single most common source of failover snags (see §8 and Doc 3).

-  cloudflared tunnel configs.

-  Any files an app writes to disk outside the database.

 

 The one-line version: **the database copies **_**data**_**, not **_**software**_**.** A new app is software, so it must be installed on both servers (done via git + Docker). What the database does for free is carry that app's data to the Understudy the moment the app writes it — but the app itself has to already be present and ready on the Understudy to use that data after a failover.

![Image: ](https://orlanda-engineering.monday.com/protected_static/15336905/resources/233507857/02-replicates-vs-not.png)

 

 

 _One-line version: the database copies __**data**__, not __**software**__. A new app is software — it must be placed on both servers; its data then rides the replication for free._

 

 

## 6. What "asynchronous" really means here (and the safety subtlety)

 pg_auto_failover's default setting (`number_sync_standbys = 0`) is **not** plain asynchronous — it is "synchronous _with a safety valve_": while both servers are healthy, the primary waits for the standby to confirm each write (no data loss), but if the standby disappears, the primary automatically stops waiting and keeps serving (no freeze).

 

 This system was **deliberately switched to true asynchronous**, because the priority here is full write speed and this is not finance data. The switch was done by disabling the replication quorum on the standby. The proof that true async is active: `synchronous_standby_names` is **empty** (`''`). If it showed `ANY 1 (...)`, the system would be back in synchronous-with-valve mode.

 

 **The tradeoff, stated honestly:** with async there is a narrow window (a fraction of a second) where a write is saved on the Boss but has not yet reached the Understudy. If the Boss dies in exactly that instant, that one write does not survive the failover. For automation workflows where the worst case is "re-run one workflow," this is an accepted risk. For finance-grade data it would not be — in which case you would switch back to synchronous (a one-command change).

 

 

## 7. The full picture: how a request flows, and what each layer does

 A live request travels through several layers. Here is the path and the job of each piece.

 

```
Internet
   │
   ▼
Cloudflare (DNS + Load Balancer, health-checks both servers)
   │
   ▼
Cloudflare Tunnel (cloudflared, outbound — one tunnel per server)
   │
   ▼
The application container (e.g. roman on :8000)
   │
   ▼
db-router (HAProxy on the host, :6432)  ── always forwards to the current primary
   │
   ▼
PostgreSQL primary (:5432, on whichever server is currently the Boss)

```

 

![Image: ](https://orlanda-engineering.monday.com/protected_static/15336905/resources/233507903/03-request-flow.png)

 

 The layers, bottom to top:

 

 **1. The PostgreSQL cluster (the heart).** One PostgreSQL instance per server, running directly on the host (not in Docker), holding all application databases. pg_auto_failover (`pg_autoctl`) runs the Boss/Understudy/Referee logic. The Boss accepts writes; the Understudy streams a live read-only copy; the Referee (witness) decides failover. Replication is asynchronous.

 

 **2. The health checker (****`is-primary-agent`****, port 23267).** A tiny program on each server that answers one question over plain HTTP: _"Is the database on this machine currently the primary?"_ It returns HTTP **200** ("primary") only when its local PostgreSQL is the Boss, and **503** ("standby") otherwise. It exists because HAProxy and the role agent both need a dead-simple yes/no signal, and they cannot speak pg_auto_failover's internal protocol. The checker is the translator: it asks PostgreSQL "are you the primary?" and replies in the simple 200/503 language the other tools understand.

 

 **3. The db-router (HAProxy, port 6432).** The "switchboard." Every app connects to one fixed local address — `127.0.0.1:6432` — and the router forwards the connection to whichever server is currently the primary. It decides where to forward by polling the health checkers (port 23267) on both servers and routing only to the one answering 200. When a failover happens, the router quietly redirects itself; the apps never change their connection settings. **The router runs in host network mode** (it shares the server's network directly) — this was necessary to avoid a Docker bridge/NAT-loopback problem where a container could not reliably reach its own host's PostgreSQL. Because it is host-mode and PostgreSQL already owns port 5432, the router listens on **6432**.

 

 **4. The role agent (****`orlanda-role-agent`****).** The watchdog that makes app failover hands-free. On each server it checks the local health checker every few seconds. If the local database has been the primary for a few consecutive checks, it ensures the app containers are **running**; if the local database is the standby, it ensures they are **stopped**. Because the Referee guarantees exactly one primary exists, exactly one server ever runs the apps. The "few consecutive checks" (hysteresis) prevents flapping during a momentary blip. This is the piece that automatically starts the app on the Understudy when it gets promoted, with no human action.

 

 **5. Cloudflare Tunnel (cloudflared).** Exposes the apps to the internet without opening any inbound ports — cloudflared makes an _outbound_ connection to Cloudflare's edge, and inbound traffic rides back down that connection. Each server runs its **own** named tunnel (`orlanda-hetzner` and `orlanda-ovh`), and each tunnel routes the app hostnames to that server's own local apps. The firewall therefore opens **zero** HTTP/HTTPS ports.

 

 **6. Cloudflare Load Balancer.** Sits in front of both tunnels for each public hostname, health-checks them, and sends visitors to whichever server is actually serving. Because the role agent ensures the app only runs where the database is primary, the "healthy" server is automatically the correct one. Steering is **failover-style** (active-passive): always use the Boss while healthy, fall back to the Understudy only when the Boss's pool goes unhealthy.

 

 

## 8. How a failover actually plays out (the sequence)

 When the Boss dies, three things move — automatically, in this order:

 

1.  **The database promotes.** The Referee (witness) detects the primary is gone and instructs the Understudy to promote itself to primary (read-write). This takes roughly 30–60 seconds. The promoted node advances to a new replication "timeline."

2.  **The app starts on the new primary.** The newly-promoted server's health checker flips to 200, its role agent sees "I am now the primary," and starts the app containers there (within a few seconds of the promotion).

3.  **Public traffic follows.** The old Boss stops serving, so its tunnel/health-check fails; Cloudflare's load balancer marks its pool unhealthy and routes traffic to the new Boss's pool, which is now healthy because the app is running there.

 

![Image: ](https://orlanda-engineering.monday.com/protected_static/15336905/resources/233507931/04-failover-sequence.png)

 

 _Three things move automatically and in this order: (1) the __**database**__ promotes, (2) the __**app**__ starts on the new primary, (3) __**public traffic**__ follows._

 

 **Recovery is a swap, not a handback.** When the failed server comes back, it does **not** reclaim the Boss role. The current Boss stays primary (it has the freshest data, including anything written during the outage), and the returned server rejoins as the new **Understudy**, catching itself up from the current Boss. Nothing written during the outage is lost, and there is no dangerous "switch back" moment.

 

![Image: ](https://orlanda-engineering.monday.com/protected_static/15336905/resources/233507947/05-recovery-swap.png)

 

 **Returning to the original server is a separate, deliberate choice.** If you want the Boss role back on a specific machine (e.g. the more powerful one), that is a _planned switchover_ — a clean, zero-data-loss, one-command operation you run **only at a calm moment when both nodes are healthy**, never automatically during a crisis. See Doc 3 for the command.

 

 

## 9. Security posture (why this is safe on the public internet)

-  **No inbound web ports.** cloudflared tunnels are outbound-only, so the firewall opens no HTTP/HTTPS. The only inbound ports are SSH (22) and PostgreSQL (5432) — and 5432 is restricted to the three peer IPs only.

-  **Inter-node database traffic is encrypted.** pg_auto_failover uses self-signed TLS for all node-to-node connections, which matters because they cross the public internet between countries.

-  **`trust`**** auth is safe **_**here**_** specifically.** The cluster uses `trust` entries in `pg_hba.conf` for inter-node connections — but scoped to the three known peer IPs, behind a firewall that already restricts port 5432 to exactly those IPs, with TLS on top. The firewall is the real security boundary; `pg_hba.conf` trust is a second, redundant lock that we deliberately keep simple. This is a known, accepted pattern for pg_auto_failover monitors.

-  **Cloudflare provides DDoS protection and WAF** for the public hostnames for free, as a side effect of the tunnel.

 

 

## 10. Known constraints and things to stay aware of

-  **The witness is a single point of failure for the **_**failover mechanism**_ (not for serving traffic). If it is down when the Boss dies, no automatic promotion occurs. Monitor it.

-  **`pg_hba.conf`**** does not replicate** and its rules are order-sensitive (first match wins). Auth rules must be set up on each server, in both directions, or failover/failback can stall. This is the #1 source of snags — see Doc 3's troubleshooting section.

-  **Apps must never run on both servers at once.** The role agent enforces this; if it is not running on one server, you risk duplicate work. Verify role agents are active after any maintenance.

-  **Async means a sub-second data-loss window** on a hard primary crash. Accepted for this workload; revisit if a future app needs stronger durability.

 

 

 _End of Document 1. Continue to Doc 2 (Server Reference Card) for exact IPs, ports, paths, and service names; Doc 3 (Operations Runbook) for day-to-day commands and troubleshooting; Doc 4 (Deploy-a-New-App Playbook) for adding the next application._

 