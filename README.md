# Orlanda Forms

A self-hosted, mobile-first **AI-mapping form builder for Monday.com**. Internal
staff build forms in an authenticated builder; external clients/surveyors fill a
public link (no login) on their phones; answers are written into a Monday board
either by **direct column mapping** or by an **Anthropic AI agent** that reads the
board schema and decides where answers go.

Typed end-to-end (TypeScript everywhere), Dockerized, with a resumable submission
pipeline that never loses a submission.

---

## Stack

- **Client:** React 18 + Vite + TypeScript, React Router, TailwindCSS, React
  Query, Zustand, dnd-kit. Mobile-first public form (WCAG 2.1 AA).
- **Server:** Node 20 + Express + TypeScript, Prisma, an in-process Postgres-backed
  worker for the submission state machine.
- **DB:** PostgreSQL (Prisma).
- **AI:** Anthropic `@anthropic-ai/sdk`, model `claude-sonnet-4-6`, backend-only
  (key never reaches the client), forced tool-use + prompt caching.
- **Monday:** direct GraphQL to `https://api.monday.com/v2` (`API-Version: 2024-10`),
  token server-side only.

## Repository layout

```
shared/    zod schemas + TS types shared by client & server (the single source
           of truth for validation + API contracts)
server/    Express API, Monday + AI modules, mapping orchestrator, worker
client/    React app (public form + builder)
prisma/    schema.prisma + migrations
server/fixtures/   §19 test fixtures (synthetic — replace with a real board capture)
deploy/    cluster compose, nginx example, cluster deploy doc, entrypoint
docs/      design spec
```

## Architecture notes

- `/shared` is imported by both client and server so the **public form's client
  validation and the server's authoritative validation can never diverge**.
- **Submissions are a resumable state machine** (`received → item_created →
  files_pending → mapped/partial/failed`). The public submit endpoint only
  persists the submission + file bytes and returns a generic success; a worker
  performs mapping → `create_item` → file uploads off the request path. State
  lives in Postgres, so a crash/restart/retry resumes at the exact failed step.
- **Attachment bytes are stored in Postgres** (not on disk) so they survive the
  failover cluster (disk files don't replicate). 10 MB/file cap keeps this safe.
- **AI mapping** writes only to the columns the builder allow-listed for that
  form; the model returns human values which the backend deterministically
  converts to Monday wire shapes and validates (dropping anything invalid).

See `docs/superpowers/specs/2026-06-25-orlanda-forms-design.md` for the full
design and the decisions taken on top of the build spec.

---

## Local development

Prerequisites: Node 20+, a local PostgreSQL (or use Docker for just the DB).

```bash
cp .env.example .env          # then edit secrets (see below)
npm install
npm run build:shared          # build the shared package once (server/client resolve it)
npm run prisma:generate
npm run prisma:migrate        # creates the schema in your dev DB (prisma migrate dev)
npm run seed:dev              # creates the admin user (prints a generated password)

# two terminals:
npm run dev:server            # API on http://localhost:8001
npm run dev:client            # client on http://localhost:5173 (proxies /api -> 8001)
```

Open `http://localhost:5173/app/login`.

### Environment variables

Copy `.env.example` → `.env`. The server **refuses to boot** if required secrets
are missing, placeholder, or too weak (`JWT_SECRET` ≥ 32 chars):

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection. Cluster: the db-router `127.0.0.1:6432`. |
| `JWT_SECRET` | ≥32 chars. `openssl rand -base64 48`. |
| `ANTHROPIC_API_KEY` | AI mapping. |
| `MONDAY_API_TOKEN` | Monday writes/reads. |
| `APP_URL` | Public origin (cookies, CORS, CSRF origin allowlist). |
| `PORT` | API port (default 8001). |
| `AI_DAILY_CALL_LIMIT`, `SUBMIT_RATE_*`, `FORM_DAILY_CAP_DEFAULT`, `LOGIN_RATE_PER_MIN` | Abuse / spend guards (sensible defaults). |
| `SUBMISSION_RETENTION_DAYS` | Auto-purge window for submissions (default 90). |
| `SENTRY_DSN` | Optional error monitoring (no-op if unset). |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Used by the seed script. |

## Build & test

```bash
npm run build        # builds shared, server, client
npm run typecheck    # all workspaces
npm test             # unit tests (no network) — formatter, AI parser/validator,
                     # answer validation, slug/publish, file safety, status machine
```

All tests read committed fixtures and require **no network or live credentials**.

---

## Docker (local / standalone)

Self-contained app + Postgres (the spec's §10 stack):

```bash
cp .env.example .env     # fill JWT_SECRET, ANTHROPIC_API_KEY, MONDAY_API_TOKEN
docker compose up -d --build
docker compose exec app npm run seed     # create the admin (once)
# open http://localhost:8001/app/login
```

Migrations run automatically in the container entrypoint (`prisma migrate
deploy`) before the app accepts traffic. Postgres data persists in the `pgdata`
volume.

## Deploy to the Orlanda failover cluster

The live cluster uses a shared HA Postgres (via the db-router) + Cloudflare
Tunnel/Load Balancer — **no bundled Postgres, no nginx, no certbot**. Follow the
step-by-step, infra-specific guide:

➡️ **`deploy/CLUSTER_DEPLOY.md`** (cluster compose: `deploy/docker-compose.cluster.yml`).

For a generic single-VPS deploy instead, `deploy/nginx.conf` is a reverse-proxy +
certbot TLS example.

## Backups

Submissions are the system of record — schedule a dump of the app database:

```bash
# local compose:
docker compose exec postgres pg_dump -U orlanda orlanda_forms | gzip > backup-$(date +%F).sql.gz
# cluster (run on the current primary):
sudo -u postgres pg_dump -p 5432 db_orlandaforms | gzip > /var/backups/orlandaforms-$(date +%F).sql.gz
```

Add it to cron. Verify restores periodically.

---

## Security highlights (see spec §16)

- argon2id password hashing; login rate-limit + lockout; JWT in an
  `HttpOnly; Secure; SameSite` cookie with **server-side revocation** on logout.
- CSRF protection (Origin/Referer allowlist) on state-changing builder routes.
- Public submit is rate-limited (per-IP, global, per-form/day) with Anthropic
  spend/size guards — no unauthenticated request can run up cost unbounded.
- File uploads: extension allowlist + **magic-byte validation**, size/count
  caps, filename sanitization; SVG rejected; uploads never served back inline.
- Restrictive CSP + `X-Content-Type-Options`/`X-Frame-Options`; all
  client-supplied text rendered as text (no `dangerouslySetInnerHTML`).
- Public form returns a render-safe DTO only — board id, mapping mode, AI prompt,
  reasoning, and internal status are never exposed.
- Prompt-injection defense: client answers are untrusted data; the AI may write
  only to allow-listed columns and every value is validated before any Monday write.

## ⚠️ Test fixtures are synthetic (GATED phases)

`server/fixtures/` contains **synthetic** Monday data so the formatter, AI
parser, and validators can be unit-tested offline. Before trusting live mapping,
replace `board-schema.json` with a real `boards(...)` capture from your board and
re-derive `expected-column-values.json` (see `server/fixtures/README.md`). The
live `create_item` / file-upload / Anthropic calls require your real
`MONDAY_API_TOKEN` + board and `ANTHROPIC_API_KEY`, verified on deploy.
