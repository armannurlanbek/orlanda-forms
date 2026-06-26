# Orlanda Infrastructure — Operations Runbook

 **Document 3 of 4** · Last updated: 2026-05-29

 

 The action-oriented manual for running the system day-to-day, handling failover and recovery, and fixing the problems you are most likely to hit. For _why_ things work this way see **Doc 1 (Architecture)**; for exact IPs/ports/paths see **Doc 2 (Server Reference)**; to add a new app see **Doc 4 (Playbook)**.

 

 

 **Golden rules, learned the hard way:**

 

1.  **Paste ONE command at a time.** Multi-line paste blocks scramble in the terminal (lines merge/break). Every snag-free session pasted single commands.

2.  **Always use ****`/usr/bin/pg_autoctl`** (not the `/usr/lib/...` path).

3.  **Never run recovery steps during a panic.** Failover is automatic; _returning_ a server is deliberate and done only when both nodes are healthy.

4.  When unsure which server is the Boss, ask the system (§1) — don't assume.

 

 

 

## 1. Everyday status checks

 **Which server is currently the Boss? / Cluster state** — run on the **witness**:

 

```
sudo -u postgres /usr/bin/pg_autoctl show state --pgdata /var/lib/postgresql/ha

```

 

 Healthy output shows one `primary` (read-write) and one `secondary` (read-only), with **identical LSN values** (= zero replication lag). Example:

 

```
  Name |  Node |          Host:Port |       TLI: LSN |   Connection |  Reported State
-------+-------+--------------------+----------------+--------------+----------------
node_1 |     1 | 46.62.186.134:5432 |   2: 0/50000D8 |   read-write |         primary
node_2 |     2 | 193.70.47.219:5432 |   2: 0/50000D8 |    read-only |       secondary

```

 

 **Replication settings (confirm async)** — on the **witness**:

 

```
sudo -u postgres /usr/bin/pg_autoctl get formation settings --pgdata /var/lib/postgresql/ha

```

 

 True async = `synchronous_standby_names` is empty (`''`) and `node_2 replication quorum | false`.

 

 **Is **_**this**_** server the primary?** — on **any node** (the health checker's answer):

 

```
curl -s http://127.0.0.1:23267/      # prints "primary" or "standby"

```

 

 **Service health** — on **any node**:

 

```
sudo systemctl status pgautofailover --no-pager      # the DB failover engine
sudo systemctl status is-primary-agent --no-pager    # the health checker (Hetzner/OVH)
sudo systemctl status orlanda-role-agent --no-pager  # the app watchdog (Hetzner/OVH)
sudo systemctl status cloudflared --no-pager         # the tunnel (Hetzner/OVH)

```

 

 (Press `q` to exit a status view.)

 

 **Is the app running here?** — on **Hetzner or OVH**:

 

```
cd /opt/roman-agent && docker compose ps

```

 

 Expect it **running on the current primary**, **stopped on the standby**.

 

 **Is the router healthy?** — on **Hetzner or OVH**:

 

```
cd /opt/db-router && docker compose logs --tail 20 | grep -E "hetzner|ovh"

```

 

 The most recent line for the current primary should read `is UP, ... code: 200`; the standby shows `DOWN, ... code: 503` (correct — the router won't send writes to a read-only standby).

 

 

## 2. Viewing logs

```
# DB failover engine (any node):
sudo journalctl -u pgautofailover -f

# Role agent decisions (Hetzner/OVH) — note: use sudo or you'll see "No entries":
sudo journalctl -t orlanda-role -f

# Cloudflare tunnel (Hetzner/OVH):
sudo journalctl -u cloudflared -f

# The app (Hetzner/OVH):
cd /opt/roman-agent && docker compose logs --tail 40 -f

# The router (Hetzner/OVH):
cd /opt/db-router && docker compose logs --tail 40 -f

```

 

 (`Ctrl+C` stops following.)

 

 

## 3. Planned switchover (move the Boss to a chosen server)

 Use this to deliberately move the primary role — e.g. back to Hetzner (the more powerful machine) after a failover left OVH as Boss. It is a clean, **zero-data-loss** operation.

 

 **Only do this when both nodes are healthy and at a calm moment. Never during a crisis.**

 

 On the **witness**:

 

```
sudo -u postgres /usr/bin/pg_autoctl perform switchover --pgdata /var/lib/postgresql/ha

```

 

 What happens automatically after this one command:

 

1.  The roles swap cleanly (old standby ↔ old primary), no data lost.

2.  Each server's **role agent** reacts — the new primary starts the app, the new standby stops it.

3.  Cloudflare's **load balancer** health-checks shift public traffic to the new primary.

 

 **Verify afterward** (witness):

 

```
sudo -u postgres /usr/bin/pg_autoctl show state --pgdata /var/lib/postgresql/ha

```

 

 Then confirm the app moved correctly: it should be **up** on the new primary and **stopped** on the new standby (`docker compose ps` in `/opt/roman-agent` on each), and [`roman.n8norlanda.com`](https://roman.n8norlanda.com) should still load.

 

 

## 4. What a real failover looks like (and how to confirm it)

 You normally do **nothing** during a failover — it is automatic. This section is for _watching_ it and confirming it completed. (To deliberately test it, see §5.)

 

 When the Boss dies, over ~30–90 seconds:

 

1.  **Witness ****`show state`** shows the dead node go to `demote_timeout` → `demoted`, and the survivor go `secondary` → `wait_primary` → `primary` (its connection flips to `read-write`, and its `TLI` timeline number increases).

2.  **The survivor's role-agent log** (`sudo journalctl -t orlanda-role`) shows `Local DB is PRIMARY -> starting agent`, and the app container starts there.

3.  [**`roman.n8norlanda.com`**](https://roman.n8norlanda.com) has a brief blip, then loads again — now served by the survivor.

 

![Image: ](https://orlanda-engineering.monday.com/protected_static/15336905/resources/233508082/07-failover-flow.png)

 

 Confirm the app is truly serving on the new primary:

 

```
cd /opt/roman-agent && sudo docker compose ps        # running
curl -i http://127.0.0.1:8000/health                 # 200 = app→router→primary DB all OK

```

 

 

## 5. Failover drill (test it on purpose)

 Do this in a calm window — it proves the whole chain. Have three views open: **witness** (state), **the survivor** (role-agent log), and a **browser** on [`roman.n8norlanda.com`](https://roman.n8norlanda.com).

 

 **Step 1 — baseline.** On the witness, confirm primary/secondary healthy:

 

```
sudo -u postgres /usr/bin/pg_autoctl show state --pgdata /var/lib/postgresql/ha

```

 

 **Step 2 — watch live.** On the witness:

 

```
watch -n2 'sudo -u postgres /usr/bin/pg_autoctl show state --pgdata /var/lib/postgresql/ha'

```

 

 On the standby-that-will-become-primary:

 

```
sudo journalctl -t orlanda-role -f

```

 

 **Step 3 — kill the current Boss.** On the **current primary**, stop the DB engine (simulates the outage cleanly and is easy to recover from):

 

```
sudo systemctl stop pgautofailover

```

 

 **Step 4 — observe.** Within ~30–90 s the witness shows the survivor become `primary`, the role-agent log shows the app starting, and the browser comes back. Confirm with the §4 checks.

 

 **Step 5 — recover the downed server.** Follow §6.

 

> You have already run this drill successfully in both directions. Re-running it occasionally (e.g. after major changes) is good hygiene.

 

 

## 6. Recovering a downed / stopped server (it rejoins as the Understudy)

 **Principle: recovery is a swap, not a handback.** The returned server does **not** reclaim the Boss role — it rejoins as the standby and catches up from the current primary. Nothing written during the outage is lost.

 

 **Step 1 — bring its DB engine back.** On the **returned server**:

 

```
sudo systemctl start pgautofailover

```

 

 **Step 2 — watch it rejoin.** On the witness `watch`, the returned node should move `demoted` → `catchingup` → `secondary`, and LSNs should converge (it catches up to the primary).

 

 **Step 3 — confirm apps settled.** App **running** on the primary, **stopped** on the returned standby (`docker compose ps` in `/opt/roman-agent` on each).

 

 **If it gets stuck at ****`catchingup`**** with connection ****`none !`** — this is the most likely snag. See §8 "Failover/failback stalls" — it is almost always the bidirectional `pg_hba.conf` auth or a `max_wal_senders` pile-up, both with fixes below.

![Image: ](https://orlanda-engineering.monday.com/protected_static/15336905/resources/233508106/08-recovery-decision-tree.png)

 

 

 **Optionally**, once it is a healthy standby again, move the Boss back to it with a planned switchover (§3) — only if you want that machine as primary, and only at a calm moment.

 

 

## 7. Editing `pg_hba.conf` safely (you will do this for every new app)

 `pg_hba.conf` (`/var/lib/postgresql/ha/pg_hba.conf`) controls who may connect. Three rules that matter every single time:

 

1.  **It does not replicate.** Edit it on **each** server separately.

2.  **Order matters — first match wins.** Put your `trust` lines **above** any auto-generated `scram-sha-256` lines for the same user/IP, or the scram line matches first and demands a password.

3.  **`replication`**** must be unquoted** to match a replication-protocol connection. Quoted `"replication"` is read as a literal database name and won't match.

 

 **Always edit with ****`nano`****, not a multi-line paste/heredoc** (heredocs scramble on paste):

 

```
sudo nano /var/lib/postgresql/ha/pg_hba.conf

```

 

 After saving, reload (no restart needed) on that node:

 

```
sudo systemctl reload pgautofailover

```

 

 Verify what PostgreSQL actually parsed (replace the user as needed):

 

```
sudo -u postgres psql -p 5432 -c "SELECT line_number, database, address, auth_method FROM pg_hba_file_rules WHERE user_name='{pgautofailover_replicator}' ORDER BY line_number;"

```

 

 Confirm `trust` rows have **lower** line numbers than any `scram-sha-256` rows for the same IP.

 

 

## 8. Troubleshooting catalog (every snag we hit, and its fix)

### A. Multi-line paste scrambles the terminal

 **Symptom:** pasted command blocks produce `command not found` / `syntax error`, or the prompt sits at a lone `>` waiting for input. **Fix:** press `Ctrl+C` to clear, then **paste one line at a time**. For file contents, use `nano` rather than a `cat <<EOF` heredoc — heredocs are the worst offenders.

 

### B. `pg_autoctl: command not found`

 **Cause:** wrong path. **Fix:** use `/usr/bin/pg_autoctl` (not `/usr/lib/postgresql/16/bin/...`).

 

### C. `pg_autoctl show uri --monitor` errors

 **Cause:** `--monitor` isn't valid in v2.2. **Fix:** drop the flag, or just use the known monitor URI from Doc 2 §6.

 

### D. `fe_sendauth: no password supplied` (the big one)

 **What it means:** a node tried to connect for replication, and the target's `pg_hba.conf` matched a `scram-sha-256` rule (which wants a password) instead of a `trust` rule. **Two sub-causes, both must be right:**

 

-  **Rule order:** the `trust` line is below the auto-generated `scram` line, so scram matches first. Fix: move `trust` above (or delete the auto-generated scram line for that user/IP).

-  **Quoting:** the rule used `"replication"` (quoted) so it didn't match the replication-protocol connection. Fix: unquoted `replication`. **And the direction trap (this caused a failback stall):** the auth must exist in **both** directions. Each server must `trust` the _other_ server's IP for `pgautofailover_replicator`, because after a failover the replication flows the opposite way. If you only set it up Hetzner→OVH originally, the first time OVH becomes primary, Hetzner can't catch up. Fix: add the mirror trust lines on the _other_ server too (see Doc 2 §10), then reload.

 

### E. Failover/failback stalls at `wait_primary` / `catchingup`, connection `none !`

 **Cause 1 — auth (most common):** see D above. Check the returning node's `journalctl -u pgautofailover` for `fe_sendauth: no password supplied` or `no pg_hba.conf entry`; fix the trust lines on the **primary** (the side being connected _to_), reload, and the standby catches up within ~30 s. **Cause 2 — ****`max_wal_senders`**** exhausted:** the log shows `number of requested standby connections exceeds max_wal_senders (currently 12)`. During a stuck failover, repeated retries pile up replication slots until none are free. **First check what's actually using them**, on the **primary**:

 

```
sudo -u postgres psql -p 5432 -c "SELECT pid, state, client_addr, application_name FROM pg_stat_replication;"
sudo -u postgres psql -p 5432 -c "SELECT count(*) FROM pg_stat_replication;"

```

 

-  If the count is high with stale/duplicate entries → free them by restarting the primary's engine: `sudo systemctl restart pgautofailover` (safe; the primary stays primary). Then restart the stuck node's engine too so it retries immediately.

-  If the count is **0** but the node still won't connect → it's not a sender shortage; it's auth (Cause 1). Re-check the trust lines.

-  If it genuinely recurs under normal conditions → the durable fix is raising `max_wal_senders` (done the pg_auto_failover-managed way, not by hand-editing `postgresql.conf`, so it isn't overwritten). Ask before changing this; 12 is usually plenty once the stale pile-up is cleared.

 

### F. Router shows `Layer4 timeout` (can't reach a health checker)

 **Cause:** firewall not allowing port 23267 on the needed path. **Fix:** ensure UFW allows 23267 from `172.16.0.0/12` (Docker bridge) and both peer IPs, on the relevant server (see Doc 2 §9). Then `cd /opt/db-router && docker compose restart`.

 

### G. App can't reach DB: "server closed the connection unexpectedly" / `nc` to own public IP hangs

 **Cause:** NAT-loopback — a Docker-bridge container couldn't connect back to its own host's public IP, and `host.docker.internal` resolved to the wrong gateway. **Fix (already applied, this is why it's the design):** the router and the app run in **`network_mode: host`**, and the app connects to `127.0.0.1:6432`. If you ever see this on a new app, put that app in host mode and point it at `127.0.0.1:6432`.

 

### H. Role agent's logs show "No entries"

 **Cause:** you queried `journalctl` as a non-root user. **Fix:** use `sudo journalctl -t orlanda-role`.

 

### I. Docker "permission denied" on OVH

 **Cause:** the user isn't in the `docker` group for that session. **Fix:** either prefix `sudo`, or `sudo usermod -aG docker arman` then re-login (`arman` is already in the group, so this is rarely needed now).

 

### J. Both servers running the app at once

 **Cause:** a role agent isn't running on one server, or a health checker is wrong. **Fix:** check `sudo systemctl status orlanda-role-agent` and `curl `[`http://127.0.0.1:23267/`](http://127.0.0.1:23267/) on both. Exactly one should report `primary`.

 

### K. cloudflared won't start / config error

 **Cause:** usually a YAML indentation problem in `/etc/cloudflared/config.yml`, or a wrong credentials path. **Fix:** `sudo cat /etc/cloudflared/config.yml` and check indentation (ingress items nested under `ingress:`); confirm the `credentials-file:` path exists (Hetzner `/root/...`, OVH `/home/arman/...`).

 

### L. `cloudflared tunnel route dns` says "record already exists"

 **Cause:** a DNS record for that hostname already exists (e.g. from the old server). **Fix:** delete/repoint the existing record in the Cloudflare dashboard to the tunnel's `<tunnel-id>.cfargotunnel.com` CNAME (proxied), or re-run the route command after removing it. For an app behind the load balancer, the LB owns the record instead.

 

 

## 9. Monitoring (set these up — they protect the whole system)

 Two external monitors are still outstanding and worth doing soon:

 

 **1. App uptime — UptimeRobot keyword monitor on **[**`roman.n8norlanda.com`**](https://roman.n8norlanda.com)**.** Use a **Keyword** monitor (not a plain HTTP ping). A plain ping checks Cloudflare, not your app, and gives false "all good" readings when the app is actually down behind a Cloudflare error page. Configure it to check for a word that only appears when the app genuinely loads, and alert when that keyword is **absent**.

 

 **2. Witness uptime — monitor the witness itself.** This is easy to forget and genuinely important: the witness is the referee that authorizes failover. If it is down when the Boss dies, automatic failover **stalls**. A simple uptime/ping monitor on the witness (`188.166.162.156`) is enough — it just needs to alert you if the witness becomes unreachable so you can restore it before it's needed.

 

 (Optional, later: alerting on the pg_auto_failover state itself, so you're told when a failover _has_ happened — useful since the system is designed to ride through one silently.)

 

 

## 10. Routine maintenance notes

-  **Reboots are safe.** All critical services (`pgautofailover`, `is-primary-agent`, `orlanda-role-agent`, `cloudflared`, `docker`) are enabled on boot and come back automatically. A reboot of the Boss will trigger a normal failover to the Understudy (and the rebooted machine returns as the standby — recover per §6 if needed).

-  **After any node rebuild or re-registration**, re-check the `pg_hba.conf` trust lines in both directions (§7, Doc 2 §10) — pg_auto_failover can rewrite that file and re-introduce the scram-above-trust ordering problem.

-  **Updating an app:** `cd /opt/<app> && git pull && docker compose build && docker compose up -d` on the **primary**; pull/build on the standby too but leave it stopped (the role agent manages it). Keep the two servers' app folders identical.

-  **Keep ****`.env`**** identical across both servers** for each app, especially any encryption keys (e.g. a future n8n's `N8N_ENCRYPTION_KEY` must match, or credentials break after failover).

 

 

 _End of Document 3. See Doc 4 (Deploy-a-New-App Playbook) for the full procedure to add the next application from start to finish._

 