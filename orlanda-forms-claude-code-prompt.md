# Build: Orlanda Forms — AI-Mapping Form Builder for Monday.com

Build a self-hosted web application called **Orlanda Forms**. It lets internal staff build forms, share a public link with external clients/surveyors (no login for them), collect answers, and write the answers into a Monday.com board — either by direct column mapping or by an AI agent that reads the board schema and decides where answers go.

Deliver a production-ready, Dockerized app with its own domain. Mobile-first throughout — the public form must be flawless on phones.

---

## 1. Tech Stack (use exactly this)

- **Frontend:** React 18 + Vite + TypeScript, React Router, TailwindCSS. Mobile-first.
- **Backend:** Node.js + Express + TypeScript.
- **DB:** PostgreSQL. Use a query builder/ORM (Prisma).
- **Auth:** Email/password for builders only. JWT (httpOnly cookie). Public forms need no auth.
- **AI:** Anthropic API called directly from the backend (model `claude-sonnet-4-6`). Never expose the key to the client.
- **Monday:** Direct GraphQL to `https://api.monday.com/v2`. Token in server env only.
- **Deploy:** Docker + docker-compose (app + postgres). Nginx reverse proxy config included. Ready for a custom domain with TLS.

---

## 2. Roles & Access

- **Builders** (internal): log in with email/password. Build/manage forms, view submissions.
- **Clients** (external): open a public form via `/{slug}`. No login, no account.
- The AI mapping reasoning, board internals, and submission diagnostics are **internal only** — never shown on the public form.

---

## 3. Data Model (Postgres / Prisma)

- **User**: id, email (unique), passwordHash, name, role (`admin`|`builder`), createdAt.
- **Form**: id, slug (unique, URL key), title, description, status (`draft`|`published`),
  boardId (Monday board), mappingMode (`direct`|`ai`), aiPrompt (text, nullable),
  welcomeText, welcomeButtonLabel (default "Start"), thankYouText, theme (jsonb: colors/logo),
  createdById, createdAt, updatedAt.
- **Question**: id, formId, order (int), type (`text`|`long_text`|`number`|`single_select`|`multi_select`|`attachment`),
  label, helpText, required (bool), options (jsonb — for selects), directMapping (jsonb `{columnId, columnType}` — used only in direct mode).
- **Submission**: id, formId, answers (jsonb), status (`received`|`mapped`|`partial`|`failed`),
  mondayItemId (nullable), aiReasoning (text, internal), errorMessage (text), clientIp, createdAt.
- **BoardSchemaCache**: boardId (pk), schema (jsonb), fetchedAt. Refresh if older than ~10 min or on manual refresh.

---

## 4. Screens

### Builder side (auth required)
1. **Login** — email/password → JWT httpOnly cookie.
2. **Dashboard** — list of forms with status, submission count, public link (copy button), New Form button.
3. **Form Builder** (core, 3-panel on desktop, stacked/tabbed on mobile):
   - **Left:** question palette — add Text, Long Text, Number, Single Select, Multi Select, Attachment.
   - **Center:** form canvas — drag to reorder, inline-edit label/help/required, edit select options.
   - **Right:** Settings + Mapping panel:
     - Target board dropdown (fetched from Monday).
     - Mode toggle: **Direct** or **AI**.
       - *Direct:* per question, pick a board column from live schema; show type-compatibility hint.
       - *AI:* a prompt textarea describing mapping rules; render the live board schema (columns, types, status/dropdown labels) below it as reference.
     - Welcome text + start button label, Thank-you text, logo upload, theme color.
4. **Submissions Viewer** (per form) — table: timestamp, status, linked Monday item (deep link), AI reasoning (internal), error. "Retry failed" action.

### Public side (no auth) — exactly THREE screens
Route `/{slug}`. Mobile-first, Orlanda-branded, smooth transitions between screens.
1. **Welcome** — Orlanda Engineering logo + `welcomeText` + a Start button (`welcomeButtonLabel`).
2. **Questions** — all questions rendered per their types, required-field validation, file upload UI for attachments, a Submit button. Show inline validation and a submitting state.
3. **Thank You** — `thankYouText` confirmation. No mapping details, no board info, nothing internal.

---

## 5. Submission Flow (backend)

On `POST /api/public/forms/:slug/submit`:
1. Validate answers against question definitions (required, type, select options).
2. Insert Submission as `received`.
3. Branch by `mappingMode`:
   - **Direct:** map each answer → its `columnId`, format per column type, build `column_values`.
   - **AI:** fetch board schema (cache), call Anthropic with: the form's `aiPrompt` + full board schema + the answers. Instruct it to return STRICT JSON only:
     `{ "itemName": string, "columnValues": { "<columnId>": <value>, ... }, "reasoning": string }`.
     Parse, strip code fences, validate every columnId exists in the schema; drop unknown ones.
4. Create the item in Monday via `create_item` with the built `column_values`.
5. For each **attachment** answer: after the item exists, upload the file to its files column via `add_file_to_column` (multipart, two-step).
6. Update Submission:
   - all good → `mapped` (+ mondayItemId, reasoning).
   - AI failed/partial → still create the item with whatever is confidently mappable (at minimum the item name), set status `partial`, store reasoning + what was dropped.
   - hard failure → `failed` (+ errorMessage). Never lose the submission.
7. Return only a generic success to the client → advance to Thank-You screen.

---

## 6. Monday.com Integration — MUST follow these rules

- Always send header `API-Version: 2024-10`.
- Monday returns **HTTP 200 even on GraphQL errors** — always inspect the `data` and `errors` fields in the response body, never rely on HTTP status.
- **Text** column values must be `JSON.stringify()`-wrapped inside `column_values`.
- **Status / dropdown** columns: map by **label**, not index (use the schema's labels).
- **Files:** create the item first, THEN run `add_file_to_column` with a multipart upload (per Monday's file upload API).
- Read board schema with: `boards(ids:[ID]){ id name columns{ id title type settings_str } groups{ id title } }`.
- Monday API token lives in a server env var / credential — NEVER in client code or responses.
- `column_values` must be passed as a JSON-string variable to the mutation.

---

## 7. AI Mapping Engine

- Backend-only Anthropic call (`claude-sonnet-4-6`).
- System/user content: explain it is mapping form answers to a Monday board; give the board schema (column ids, titles, types, and for status/dropdown the allowed labels); give the form questions + the client's answers; give the builder's `aiPrompt` as the governing rules.
- Demand JSON-only output, no prose, no fences. Parse defensively (strip fences, try/catch).
- Validate returned columnIds against schema before writing; discard invalid ones and record them in reasoning.
- Store `reasoning` on the submission (internal only).

---

## 8. Mobile / UX Requirements

- Public form: mobile-first, large tap targets, single-column, smooth Welcome→Questions→ThankYou transitions, works perfectly on small screens.
- Builder: usable on desktop primarily; the 3-panel builder collapses to tabs on mobile.
- Clean, professional Orlanda Engineering branding; logo on the welcome screen.

---

## 9. API Routes (sketch)

- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET/POST /api/forms`, `GET/PUT/DELETE /api/forms/:id`, `POST /api/forms/:id/publish`
- `GET /api/monday/boards`, `GET /api/monday/boards/:id/schema` (uses cache + refresh)
- `GET /api/forms/:id/submissions`, `POST /api/submissions/:id/retry`
- Public: `GET /api/public/forms/:slug` (returns only render-safe form config), `POST /api/public/forms/:slug/submit`

---

## 10. Deliverables

- Full repo: `/client`, `/server`, `prisma/schema.prisma`.
- `Dockerfile` (multi-stage) + `docker-compose.yml` (app + postgres).
- `nginx.conf` reverse-proxy example + notes for adding the domain and TLS (certbot).
- `.env.example` with: `DATABASE_URL`, `JWT_SECRET`, `ANTHROPIC_API_KEY`, `MONDAY_API_TOKEN`, `APP_URL`.
- DB migrations + a seed script creating one admin user.
- `README.md`: local dev, env setup, build, docker deploy, how to add the domain.

Build it cleanly, typed end-to-end, with sensible error handling and the Monday/AI rules above strictly applied.

---

# PART B — Detailed Specifications (Addendum)

> Sections 11–22 below were produced by a structured design review of sections 1–10. They are **MANDATORY** and **supersede** the §1–§10 sketch wherever they add detail or conflict (see §22 for precedence). In particular: §14 rewrites the §5 submission flow, and §18 replaces the §7 AI guidance. Build against Part B — the §1–§10 sketch is the overview, Part B is the contract.

---

## 11. Data Model — Additions & Corrections

### 11.1 New `Attachment` model
Add a dedicated model for every uploaded file. Files are NEVER stored as bytes inside `Submission.answers`.

```prisma
enum AttachmentStatus {
  stored        // bytes persisted to durable storage, not yet sent to Monday
  uploading     // add_file_to_column in progress
  uploaded      // present on the Monday item
  failed        // upload errored (retryable)
}

model Attachment {
  id                String           @id @default(uuid())
  submissionId      String
  submission        Submission       @relation(fields: [submissionId], references: [id], onDelete: Cascade)
  questionId        String           // the Question this file answers
  originalFilename  String
  sanitizedFilename String           // basename only, path separators & control chars stripped
  mimeType          String
  sizeBytes         Int
  storageKey        String           // path/key in durable storage (see §13.2)
  status            AttachmentStatus @default(stored)
  mondayAssetId     String?          // returned by Monday after successful upload
  uploadedToMonday  Boolean          @default(false)
  createdAt         DateTime         @default(now())

  @@index([submissionId])
  @@index([submissionId, questionId])
}
```

### 11.2 Representation of an attachment answer inside `Submission.answers`
For a question of type `attachment`, the value in `answers` is a reference array, never file content:

```json
{
  "<questionId>": {
    "type": "attachment",
    "attachmentIds": ["<Attachment.id>", "..."]
  }
}
```
The bytes live only in durable storage (§13.2) and are joined back via the `Attachment` rows. The serializer for direct mapping and for the AI prompt MUST omit raw bytes and pass only filenames if anything is passed at all.

### 11.3 Expanded `Submission` model
Replace the coarse status enum with a progress-bearing enum so retry can resume at the exact failed step. Add an idempotency key.

```prisma
enum SubmissionStatus {
  received       // row + all Attachment bytes persisted; nothing sent to Monday yet
  item_created   // create_item succeeded; mondayItemId persisted
  files_pending  // item exists, column_values written, one or more files not yet uploaded
  mapped         // fully complete: item + all columns + all files
  partial        // item exists but some answers/files were intentionally dropped (e.g. AI dropped unknown columns) — terminal unless retried
  failed         // hard failure before/at create_item; never lost
}

model Submission {
  id             String           @id @default(uuid())
  formId         String
  form           Form             @relation(fields: [formId], references: [id])
  idempotencyKey String           @unique           // client-supplied per attempt; dedupes double-submit & safe retry
  answers        Json
  status         SubmissionStatus @default(received)
  mondayItemId   String?                            // set ONCE, immediately after create_item; presence == "item exists, never re-create"
  aiReasoning    String?          @db.Text          // internal only
  errorMessage   String?          @db.Text
  droppedColumns Json?                              // columnIds the AI returned but were dropped (internal)
  clientIp       String?
  attachments    Attachment[]
  createdAt      DateTime         @default(now())
  updatedAt      DateTime         @updatedAt

  @@index([formId, createdAt])
  @@index([status])
}
```

`mondayItemId` semantics: it is the single source of truth for "the Monday item already exists." It is written exactly once, in its own dedicated write immediately after `create_item` returns (§14.2). Any flow step that would call `create_item` MUST first assert `mondayItemId IS NULL`.

### 11.4 Indexes & unique constraints
1. `Form.slug` — unique (already specified).
2. `Submission.idempotencyKey` — unique (enforces dedupe; a retried/double POST with the same key MUST resolve to the existing row, not a new insert).
3. FK indexes: `Submission.formId` (+ composite `(formId, createdAt)` for the submissions table view), `Attachment.submissionId`, `Attachment(submissionId, questionId)`.
4. `Submission.status` index for the "Retry failed" filter.

---

## 12. Monday `column_values` Formatting (MANDATORY)

`column_values` is built as a plain object keyed by `columnId`, then serialized with `JSON.stringify()` and passed as a single JSON-string GraphQL variable (see §6). Each value MUST match the exact shape below for its column type. Sending the wrong shape causes a GraphQL error in the `200`-OK `errors` field.

| Column type | Value to put under `columnId` | Notes |
|---|---|---|
| `text` | `"some text"` | Plain string. |
| `long_text` | `"multi\nline text"` | Plain string; newlines allowed. |
| `numbers` | `"42"` or `"42.5"` | Send as a **string**, not a JS number. Empty = `""`. |
| `status` | `{ "label": "Done" }` | Map by **label**, must match a label in `settings_str`. Single value only. |
| `dropdown` | `{ "labels": ["A", "B"] }` | Map by **labels array** — distinct from `status`. Single selection is still an array: `{ "labels": ["A"] }`. |
| `date` | `{ "date": "2026-06-25" }` | `YYYY-MM-DD`. To include time: `{ "date": "2026-06-25", "time": "13:30:00" }`. |
| `email` | `{ "email": "a@b.com", "text": "a@b.com" }` | `text` is the display label; default it to the email. |
| `phone` | `{ "phone": "15551234567", "countryShortName": "US" }` | Digits only in `phone`; ISO-2 country code. |
| `link` | `{ "url": "https://x.com", "text": "X" }` | `text` is display label. |
| `checkbox` | `{ "checked": "true" }` | String `"true"`. To uncheck, send `{}` (omit `checked`). |
| `people` | `{ "personsAndTeams": [ { "id": 12345, "kind": "person" } ] }` | `kind` is `"person"` or `"team"`; `id` is the Monday user/team id (numeric). |
| `timeline` | `{ "from": "2026-06-01", "to": "2026-06-30" }` | Both `YYYY-MM-DD`. |
| `connect_boards` | `{ "item_ids": [111, 222] }` | Numeric item ids on the linked board. |
| `file` | **N/A — see 12.2** | |

### 12.1 Type coverage requirement
The question types in §3 are `text | long_text | number | single_select | multi_select | attachment`. The direct mapper and the AI engine MUST be able to emit any of the above column shapes. Implement one formatter per target column type, dispatched on `columnType`. If a target column type has no defined formatter, treat the mapping as terminal-invalid: drop it, record the columnId in `Submission.droppedColumns`, and do NOT send a malformed value.

### 12.2 File columns cannot be set via `column_values`
File/`file` columns MUST NOT appear in `column_values`. A file column accepts no value field in its settings. Files are attached exclusively through the assets upload flow (§13.3) AFTER the item exists. In Direct mode, a question of type `attachment` MUST map only to a Monday `file` column and MUST be excluded from the `column_values` object.

### 12.3 `directMapping` must carry enough to format
`Question.directMapping` (jsonb) MUST store `{ columnId, columnType }` at minimum, plus any per-type extra required to format the value (e.g. for `phone`, a default `countryShortName`; for `people`, how a free-text answer resolves to a user id, or a flag that this mapping is unsupported in Direct mode). The mapper dispatches purely on stored `columnType`; it must never re-derive type from a live schema fetch at submit time.

### 12.4 Wrapping (reference)
Text values and the whole `column_values` object follow the JSON-string-variable rule already mandated in §6. Do not double-stringify nested objects (e.g. `status`); only the top-level `column_values` is the JSON-string variable.

---

## 13. File Upload — Server Storage & Monday Assets Flow

### 13.1 Transport
The public submit endpoint accepts `multipart/form-data`:
1. One text part named `answers` containing the JSON answers object (§15.1 canonical shape).
2. Zero or more file parts. Each file part name encodes its question: `file__<questionId>` (repeat the same field name for multiple files on one multi-file question). The server groups uploaded parts by `questionId`, creates one `Attachment` row per file, and writes the resulting `attachmentIds` into the corresponding `answers[questionId]` entry (§11.2).
3. One text part named `idempotencyKey` (§14.1).

Use a streaming multipart parser (e.g. `multer`/`busboy`) writing directly to durable storage — do not buffer whole files in memory.

### 13.2 Durable storage
1. Files MUST persist to storage that survives container restarts and redeploys: a mounted volume (e.g. `/data/uploads`, declared as a Docker volume) or object storage. NEVER the ephemeral container filesystem, because "Retry failed" (§14) re-reads the bytes.
2. `Attachment.storageKey` is the durable path/key. Storage layout: `<submissionId>/<attachmentId>__<sanitizedFilename>`.
3. Cleanup policy: once a submission reaches `mapped`, its stored files MAY be deleted by a scheduled sweep (e.g. delete `stored`/`uploaded` files older than 24h whose submission is `mapped`). Files for submissions in `failed`/`partial`/`files_pending` MUST be retained so retry can resume. Never delete bytes for a non-terminal submission.
4. Upload size/type/MIME constraints are enforced upstream — see §16 for upload constraints.

### 13.3 Monday assets flow (two-step, after item exists)
For each `Attachment` whose `uploadedToMonday = false`, in order:
1. Precondition: `Submission.mondayItemId` is set (item already created — §14.2). Never upload before the item exists.
2. Stream the file from `storageKey` to the Monday file-to-column upload (`add_file_to_column`), a multipart request distinct from the JSON GraphQL endpoint, targeting the mapped `file` columnId on `mondayItemId`.
3. On success: set `Attachment.mondayAssetId`, `uploadedToMonday = true`, `status = uploaded`.
4. When all attachments for the submission are `uploaded`, advance the submission `files_pending → mapped`. If any remain, keep `files_pending` (retryable).
5. Each file is uploaded independently and idempotently keyed off `uploadedToMonday`; a retry re-uploads only files still `false`.

---

## 14. Submission Flow — Idempotency, Resumability & Error Handling

Rewrite the §5 flow as a resumable state machine. No step re-does completed work.

### 14.1 Idempotency & dedupe
1. The client generates one `idempotencyKey` (UUID) per submission attempt and sends it with the POST. A user double-tap reuses the same key.
2. On submit, attempt to insert the `Submission` with that key. If the unique constraint (§11.4) rejects it, load the existing row and resume its state machine instead of inserting — return the same generic success to the client. A duplicate POST NEVER creates a second submission or a second Monday item.

### 14.2 Resumable steps
Drive off persisted state, not in-memory progress:
1. **Persist first.** Within one local transaction: insert `Submission (received)`, insert all `Attachment` rows, and ensure all file bytes are durably written (§13.2). Commit. The submission is now never lost.
2. **Validate** answers (§15.1). Validation failure here → `failed` with `errorMessage`; nothing external called.
3. **Build `column_values`** per mode (Direct §12 / AI §18). AI: validate returned columnIds against schema, drop unknowns into `droppedColumns`.
4. **Create item — guarded.** Assert `mondayItemId IS NULL`. Call `create_item`. Immediately, in its own dedicated write, persist `mondayItemId` and set status `item_created` (then `files_pending` if attachments exist, else proceed). If `create_item` succeeds but the id-persist write fails, the next retry MUST detect the orphan risk — because `mondayItemId IS NULL` it would re-create; to prevent duplicates, persist `mondayItemId` and status in a single write that is the very next statement after the Monday response is parsed, before any other work.
5. **Write columns** (folded into create_item here; no separate update needed unless create_item omitted columns).
6. **Upload files** (§13.3): only `Attachment`s with `uploadedToMonday = false`.
7. **Finalize:** all columns written + all files uploaded → `mapped`. Some answers/columns intentionally dropped but item exists → `partial`.
8. **Retry (`POST /api/submissions/:id/retry`)** re-enters the same machine: if `mondayItemId` set, SKIP create_item and resume at column/file steps; if columns already written, resume at file upload; upload only pending files. Retry on a `mapped` submission is a no-op.
9. The client always receives only a generic success → Thank-You (§5.7). External progress/failure is invisible to the public client.

### 14.3 Transactional boundaries
1. NO Postgres transaction wraps a Monday HTTP call. Local DB work is committed before any external call.
2. Atomic local unit = step 14.2.1 (submission + attachments + bytes). Everything after is a sequence of individually-recorded external effects, each followed by its own small status/flag write.
3. Each external effect is recorded durably the instant it succeeds (`mondayItemId`, each `Attachment.uploadedToMonday`) so a crash/retry resumes precisely.

### 14.4 Monday error classification
Monday returns HTTP 200 with an `errors` field. Classify it:
1. **Retryable** — rate-limit / complexity-budget exceeded / transient (`ComplexityException`, rate-limit messages, 5xx-shaped or network errors). Do NOT mark `failed`. Leave the submission at its current pre-failure state (`received`/`item_created`/`files_pending`) so "Retry failed" (and any retry sweep) can re-run it. Record the message in `errorMessage`. Respect Monday's complexity reset where provided (back off before retry).
2. **Terminal** — validation errors (bad column value shape, unknown column, invalid label, malformed input). These will not succeed on retry as-is. If pre-`create_item`: status `failed` + `errorMessage`. If post-`create_item` (item exists, one column rejected): drop the offending column into `droppedColumns`, continue, end as `partial`.
3. Never infer success from HTTP 200 alone; a response is successful only when `errors` is absent/empty AND `data` contains the expected entity id.

---

## 15. Backend Validation & Other Endpoints

### 15.1 Canonical answer shape & server-side validation
Define one canonical shape per question type in `answers` jsonb; the validator, direct mapper, and AI serializer all read this shape:

```json
{
  "<questionId>": { "type": "text",          "value": "string" },
  "<questionId>": { "type": "long_text",     "value": "string" },
  "<questionId>": { "type": "number",        "value": 42.5 },
  "<questionId>": { "type": "single_select", "value": "Exact Option Label" },
  "<questionId>": { "type": "multi_select",  "value": ["Label A", "Label B"] },
  "<questionId>": { "type": "attachment",    "attachmentIds": ["<id>", "..."] }
}
```

Validation rules (server-side, authoritative — the client is untrusted):
1. **Unknown keys:** reject any key in `answers` that is not a current `Question.id` for this form. Do not pass unknown keys onward (prevents injection into the AI prompt / column_values).
2. **Required:** missing key, `null`, empty string, empty array, or empty `attachmentIds` for a `required` question → validation error.
3. **`number`:** must be numeric. Allow decimals by default; reject non-finite. Enforce optional `min`/`max` if defined on the question. Normalize locale separators (accept `","` decimal, store as canonical number).
4. **`single_select`:** `value` must exactly match (case-sensitive) one entry in the question's `options`. Reject otherwise.
5. **`multi_select`:** `value` is an array; every entry must match an `options` entry (case-sensitive); reject duplicates; empty array is valid only if the question is not `required`.
6. **`attachment`:** every id in `attachmentIds` must reference an `Attachment` row belonging to this submission and this `questionId`.
7. **Stale options:** validate against the question's current `options`. If an answer references an option no longer present, treat as a validation error (do not silently accept).
8. The `type` in each answer entry must equal the question's declared type; mismatch → validation error.

### 15.2 BoardSchemaCache concurrency & invalidation
1. **Single-flight refresh:** concurrent requests for the same `boardId` past TTL trigger exactly one Monday fetch; others await the in-flight result. No thundering herd.
2. **Explicit invalidation:** on form publish and on manual "refresh," purge (or force-refetch) the cache row for that `boardId` before use; do not serve a stale row in those paths.
3. **Submit-time staleness:** AI/Direct mapping uses the cache; if a write later fails because a column no longer exists (terminal Monday error per §14.4), invalidate that board's cache so the next attempt fetches fresh, and surface the message in `errorMessage`.

### 15.3 Slug, publish, delete, public DTO
1. **Slug generation:** auto-derive kebab-case from `title` (lowercase, ASCII-fold, non-alphanumerics → `-`, collapse repeats, trim). On unique-constraint violation, append `-2`, `-3`, … and retry the insert (loop on conflict, do not pre-check-then-insert — that races).
2. **Reserved words:** block slugs that collide with reserved paths (`api`, `assets`, `static`, `login`, `admin`, `app`, `public`, `health`, plus any top-level route). Reject/append-suffix if generated value hits the reserved set.
3. **Immutability:** slug is fixed once `status = published` (public links must not break). Editing title after publish does not change slug.
4. **Publish preconditions** (`POST /api/forms/:id/publish`) — reject with a clear error if any fail: `boardId` is set; if `mappingMode = direct`, every `required` question has a valid `directMapping`; if `mappingMode = ai`, `aiPrompt` is non-null/non-empty; at least one question exists.
5. **DELETE `/api/forms/:id`:** if the form has any submissions, block hard delete (return 409) OR soft-delete (add `Form.deletedAt`, exclude from lists, keep public slug returning 404). Pick soft-delete; never cascade-destroy submission history or sever `mondayItemId` links.
6. **Public GET `/api/public/forms/:slug`** returns a render-safe DTO only — never the raw Form/Question rows. Exclude `boardId`, `directMapping`, `aiPrompt`, `aiReasoning`, internal status, and any Monday internals. Exact DTO whitelist is owned by §16.6.

---

## 16. Security & Access Control (MANDATORY)

These are hard requirements. The app has a public, unauthenticated endpoint that accepts arbitrary input (including files), feeds it to an LLM, and writes into the company Monday workspace. Treat every public input as hostile. All defaults below are minimums — implement them unless a stricter value is justified.

### 16.1 Public submit abuse controls
The endpoint `POST /api/public/forms/:slug/submit` costs money (Anthropic call) and mutates internal data (Monday writes) on every request. It must be rate-limited and bot-protected.
- **Per-IP rate limit:** max 5 submissions/minute and 30/hour per IP on the submit route. Return `429` with a generic message on breach.
- **Global rate limit:** app-wide ceiling on the submit route (suggest 60/minute) acting as a circuit breaker; on breach, reject new submissions with `429` and do not call Anthropic/Monday.
- **Per-form daily cap:** configurable per form (default 200/day). Beyond the cap, accept-and-store nothing further or queue without processing; never call Anthropic/Monday past the cap.
- **Bot challenge:** integrate a CAPTCHA/Turnstile (Cloudflare Turnstile or hCaptcha) on the public Questions screen; verify the token server-side at the start of the submit handler before any DB write, Anthropic call, or Monday call. Reject on missing/invalid token. The challenge site-key is public config; the secret is server env only.
- **Anthropic spend/size budget guard:** before calling Anthropic, enforce caps — max total request body size (suggest 256 KB excluding file bytes), max answer length per field (suggest 5,000 chars), max number of answers, and max board schema size injected into the prompt (suggest cap columns/labels passed; if a board exceeds the cap, fail to `failed` rather than sending an oversized prompt). Set an explicit timeout on the Anthropic call (suggest 30s) and a max output-token limit. Maintain a daily Anthropic-call counter with a configurable hard ceiling that, when reached, disables AI mapping for new submissions.

### 16.2 File upload constraints (security side of attachments)
For every `attachment` answer from the public form:
- **Extension + type allowlist:** accept only an explicit allowlist (suggest `pdf, png, jpg, jpeg, gif, webp, doc, docx, xls, xlsx, csv, txt`). Reject everything else.
- **Size + count limits:** max 10 MB per file, max 5 files per submission, max 25 MB total per submission. Enforce limits server-side; do not trust client-reported size.
- **MIME / magic-byte validation:** validate actual file content (magic bytes) server-side and confirm it matches the claimed extension/allowlist. Reject on mismatch. Never trust the client-supplied `Content-Type`.
- **Filename sanitization + path-traversal prevention:** never use the client-supplied filename for any filesystem path. Generate a server-side random name (e.g. UUID) for transient storage. Strip directory separators, `..`, NUL, and CR/LF from any filename echoed into the Monday multipart request; cap filename length.
- **Transient storage:** store uploaded bytes in a directory that is NOT served by any static/web route. Delete the transient file after the Monday upload completes — on both success and failure (use a `finally`-style guarantee). No orphaned untrusted files may persist.
- **Never serve back inline:** the app must never render or serve uploaded files inline. If any download path exists, respond with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`. Builders access files via the Monday deep link, not via this app.

### 16.3 Authentication hardening
- **Password hashing:** argon2id (preferred) or bcrypt with cost ≥ 12. No fast/unsalted hashes.
- **Password policy:** minimum 12 characters; reject empty/whitespace-only.
- **Brute-force protection:** rate-limit `POST /api/auth/login` (suggest 5 attempts/minute per IP and per email) plus account lockout or exponential backoff after repeated failures (suggest lockout after 10 consecutive failures). Return a generic "invalid credentials" message — never reveal whether the email exists.
- **JWT lifecycle:** issue access tokens with a short `exp` (suggest 15–60 min) plus a refresh mechanism, OR a single short-lived token with silent re-auth. Implement logout/revocation via either short TTL + refresh-token rotation, or a server-side token/session denylist that logout writes to. Logout must invalidate the session, not merely clear the client cookie.
- **Secret validation at startup:** the server must refuse to boot if `JWT_SECRET` is missing, empty, a known default/placeholder, or below a minimum entropy/length (suggest ≥ 32 chars). Apply the same fail-fast check to `ANTHROPIC_API_KEY` and `MONDAY_API_TOKEN` presence.

### 16.4 Cookie & CSRF protection
- **Cookie flags:** the JWT cookie must be set `HttpOnly; Secure; SameSite=Strict` (use `Lax` only if a documented flow requires it, in which case CSRF tokens are mandatory regardless). Set an explicit `Path` and a `Max-Age` aligned with token `exp`.
- **CSRF defense:** all state-changing builder routes (`POST/PUT/DELETE /api/forms`, `/api/forms/:id/publish`, `/api/submissions/:id/retry`, logout) must be protected by either a CSRF token (double-submit or synchronizer pattern) or a strict `Origin`/`Referer` allowlist check against `APP_URL`. Reject mismatches with `403`. The public submit route is exempt (no cookie auth) but is covered by §16.1.

### 16.5 Authorization & object-level access
- **Access matrix:** define and enforce explicitly:
  - `admin`: full access to all forms, submissions, retries, board schema, and user/seed management.
  - `builder`: access only to forms where `createdById` equals their user id, and to those forms' submissions/retries/schema. (If the deliberate product decision is that all builders are org-wide-trusted and may access all forms, state that explicitly and document it — but it must be a chosen, written decision, not an implicit default.)
- **Object-level checks on every `:id` route:** `GET/PUT/DELETE /api/forms/:id`, `POST /api/forms/:id/publish`, `GET /api/forms/:id/submissions`, `POST /api/submissions/:id/retry`, and `GET /api/monday/boards/:id/schema` must verify the authenticated user is authorized for that specific resource before acting. A failed check returns `404` (not `403`) to avoid resource-existence enumeration. ID-based enumeration must not grant access to forms or submissions the caller does not own (submissions contain external client PII).
- **Manual schema refresh** is a privileged builder action subject to the same checks.

### 16.6 Public-config DTO allowlist
`GET /api/public/forms/:slug` must return only an explicit render-safe DTO. Never serialize raw Prisma `Form`/`Question` objects into the public response.
- **Form-level fields returned:** `slug`, `title`, `description`, `welcomeText`, `welcomeButtonLabel`, `thankYouText`, `theme` (sanitized per §16.8). Only return if `status = published`; otherwise `404`.
- **Per-question fields returned:** `id`, `order`, `type`, `label`, `helpText`, `required`, `options`.
- **Never returned to the public:** `boardId`, `mappingMode`, `aiPrompt`, `directMapping`/`columnId`, `createdById`, `aiReasoning`, internal status/diagnostic fields, or any other model field not listed above.

### 16.7 XSS & security headers
- Treat all external client answers and all builder-authored text (`welcomeText`, `thankYouText`, question `label`/`helpText`, `errorMessage`, `aiReasoning`) as untrusted when rendered.
- Never use `dangerouslySetInnerHTML` (or equivalent raw-HTML injection) for any user- or client-supplied content. Rely on React's default escaping; render answers/reasoning/errors as text only in the submissions viewer.
- Ship a restrictive `Content-Security-Policy` (no inline scripts; `default-src 'self'`; tighten `script-src`/`style-src`; set `frame-ancestors 'none'`). Add `X-Content-Type-Options: nosniff` and `X-Frame-Options: DENY` (or the CSP `frame-ancestors` equivalent) on all app responses.

### 16.8 Logo & theme safety
- **Logo:** upload only. The server must never fetch a logo from a client-supplied URL (SSRF prevention). Apply the §16.2 file constraints to logo uploads; restrict logo types to raster images (`png, jpg, jpeg, webp`).
- **SVG:** reject SVG uploads, or sanitize them server-side to strip scripts/event handlers/external references before any use. Default to rejection.
- **Theme:** validate every `theme` color value server-side against a strict pattern (e.g. `#RRGGBB`, `#RGB`, or `rgb()/rgba()` only) before persisting. Never inject raw `theme` strings into markup or inline `style`/CSS; reject any value that fails validation.

### 16.9 PII & privacy
External `answers` plus `clientIp` are personal data.
- **Privacy notice:** display a privacy/consent notice on the public form (at minimum on the Welcome or Questions screen) before submission.
- **Retention + purge:** implement a configurable retention window (suggest 90 days, env-configurable) with an automatic scheduled purge of `Submission` rows (and any associated transient artifacts) past the window.
- **clientIp:** store `clientIp` only if needed for abuse mitigation; document its purpose, and include it in the retention/purge policy. Prefer truncating/anonymizing where the full IP is not required.
- **Data-subject deletion:** provide an authorized capability (admin) to delete a specific submission or all submissions for a given form/identifier on request.

### 16.10 Prompt-injection requirement
Client answers are untrusted input, not instructions. In AI mapping mode, the engine must write only to columns the builder explicitly mapped for that form (never the full board schema), and every written value must be validated — including that `single_select`/`status`/`dropdown` values match the column's allowed labels — before any Monday write. See §18 for the mechanism.

---

## 17. Frontend — Builder Save Model, State, Validation, UX & Accessibility

### 17.1 Question persistence (UI contract)
- Questions are **not** persisted individually. The builder sends the full form on save via `PUT /api/forms/:id` (per §14/§15), with `questions` as a **complete ordered array**. Server semantics: upsert by `id`, create entries lacking an `id`, and **delete any question whose `id` is absent** from the array.
- `order` is **derived from array position** on save — do not send a separate `order` field from the client; the client owns array order, the server assigns `order` from index.
- Use an **explicit Save** button. Track a **dirty state** (any edit, add, delete, reorder, or settings change sets dirty). On dirty, **warn-on-navigate-away** (router block + `beforeunload`). Save clears dirty; show a saving spinner and a success/error toast. No autosave.
- Publishing (`POST /api/forms/:id/publish`, per §14) requires a saved, non-dirty form; if dirty, prompt to save first.

### 17.2 State / data libraries
- **Server state:** use **React Query** (TanStack Query). Cache forms, submissions, Monday boards, and live board schema. The board schema query (`GET /api/monday/boards/:id/schema`, per §14) is cached with a manual **Refresh** action that invalidates and refetches.
- **Builder edit state:** use a light client store (**Zustand**) holding the in-progress form + questions, dirty flag, and selection. Server data hydrates the store on load; saving sends the store snapshot.
- **Drag-reorder:** use **dnd-kit** (`@dnd-kit/sortable`) for the center canvas. Reorder updates the store immediately (optimistic, local-only until Save).

### 17.3 Type-compatibility hint matrix (Direct mode)
In Direct mode, after a Monday column is chosen for a question, render a hint badge using the matrix below. **OK** = green/no warning, **warn** = amber "values may not map cleanly", **block** = red, disallow selection. This matrix MUST agree with the §12 formatting table; §12 is authoritative on payload formatting.

| Question type | OK columns | warn columns | block (all others) |
|---|---|---|---|
| text | `text`, `long_text` | `numbers`, `status`, `dropdown`, `email`, `phone` | `file`, `people`, `date` |
| long_text | `long_text`, `text` | `status`, `dropdown` | `numbers`, `file`, `people`, `date` |
| number | `numbers` | `text`, `long_text` | `status`, `dropdown`, `file`, `people`, `date` |
| single_select | `status`, `dropdown` | `text`, `long_text` | `numbers`, `file`, `people`, `date` |
| multi_select | `dropdown` | `long_text`, `text` | `status`, `numbers`, `file`, `people`, `date` |
| attachment | `file` | — | all others |

The hint reads the live schema's column type. If a mapped column's type changes on refresh and is now `warn`/`block`, surface the badge change and (for `block`) flag the mapping as invalid before publish.

### 17.4 Per-type input widgets + client validation (public form)
Render one control per question type:

| Type | Control | Validation |
|---|---|---|
| text | single-line `<input type="text">` | required; trim; max length if set |
| long_text | `<textarea>` (auto-grow) | required; trim |
| number | `<input inputMode="numeric">` (decimal where allowed) | required; numeric; `min`/`max`/`step` if set |
| single_select | radio group (native `<select>` if options > 7) | required = one selection |
| multi_select | checkbox group | required = ≥1; honor optional `minSelections`/`maxSelections` |
| attachment | file control (see §17.5) | required = ≥1 file uploaded |

- Client validation **MUST mirror the server rules in §15** via a shared validation schema (single source, e.g. shared zod schema imported by client and server). Do not hand-write divergent client rules.
- Validate on blur and on submit. Show **inline errors** beneath each field; on submit-with-errors, focus the first invalid field. Disable Submit and show a **submitting state** (spinner, disabled) during the request; on server error, re-enable and show a form-level error.

### 17.5 File upload UX (mobile-first, attachment questions)
Surveyors complete forms on phones — this flow must be first-class. Upload limits/endpoint come from §16.
- Trigger uses a native file input with `accept` (image types primarily) and `capture="environment"` to allow direct camera capture / "take photo," plus choose-from-library.
- Support **multiple files** per attachment question when allowed; render each as a thumbnail/row.
- Show **per-file upload progress** and a clear "uploaded" state.
- Perform **client-side size/type checks before upload** (per §16 limits) and show an immediate, specific error ("Max 10 MB", "Images only") — do not wait for the server to reject.
- Provide a **remove-file** affordance per file, and a **retry** action on failed uploads (important on flaky mobile connections).
- The form stores the uploaded asset reference returned by the upload endpoint (per §16) in the answer payload; never base64 inline large files into the submit body.

### 17.6 Routing & reserved slugs
- Mount **all builder/auth routes under a prefix** so public `/{slug}` cannot collide:
  - `/app/login`
  - `/app` → Dashboard (form list)
  - `/app/forms/new`
  - `/app/forms/:id` → Form Builder
  - `/app/forms/:id/submissions` → Submissions Viewer
- Public routes live at the root: `/{slug}` (public form), and `/{slug}` only. The root `/` redirects to `/app` for authenticated builders, else to `/app/login`.
- Enforce a **reserved-slug list** at form creation (reject these as slugs): `app`, `api`, `login`, `logout`, `admin`, `assets`, `static`, `public`, `health`. Slug format: lowercase, alphanumeric + hyphens, unique (per §15).

### 17.7 Accessibility (public form — external, unsupported users)
Target **WCAG 2.1 AA** on all three public screens:
- Every input has an associated `<label for>` (or `aria-labelledby`); help text linked via `aria-describedby`; required fields marked `aria-required` and visibly.
- **Focus management** across Welcome→Questions→ThankYou: on each screen change, move focus to the new screen's heading (`tabindex="-1"` + `.focus()`) so screen-reader and keyboard users land correctly.
- **Error announcement:** inline validation errors use `role="alert"` / `aria-live="polite"`, and invalid inputs set `aria-invalid` and reference their error via `aria-describedby`.
- Honor **`prefers-reduced-motion`**: disable/shorten screen transitions when set.
- All interactive targets keyboard-operable with a visible focus ring; tap targets ≥ 44×44px.

### 17.8 Theme tokens, transitions, i18n
- Theme (`Form.theme` jsonb) exposes **exactly these tokens** as CSS variables on the public form root:
  - `--color-primary` (buttons / accents)
  - `--color-on-primary` (text on primary)
  - `--color-bg` (page background)
  - `--color-text` (body text)
  - `--color-focus` (focus ring)
  - `logoUrl` (welcome screen logo; uploaded per §16)
- **Contrast guardrail:** validate AA contrast (≥ 4.5:1 body, ≥ 3:1 large text/UI) for `primary`/`on-primary` and `text`/`bg`; warn in the builder theme picker when a pair fails. Ship sensible Orlanda defaults for any unset token.
- **Transitions:** the Welcome→Questions→ThankYou transition library is open (CSS transitions or framer-motion), but it **must respect `prefers-reduced-motion`** (per §17.7).
- **i18n:** public form and builder are **English-only**; do not scaffold localization unless a language requirement is added to the spec.

---

## 18. AI Mapping Engine — Detailed Spec

This section REPLACES the vague AI guidance in §7. Sections 1–10 remain in force. The model id `claude-sonnet-4-6` (§1) is confirmed valid and current; keep it. For the per-column-type value formats, reference the §12 column-value table. For idempotency and resumable submission state, reference §14.

### 18.1 Output contract
The LLM returns **human-readable values**, never Monday wire JSON. The backend deterministically converts each value to Monday `column_values` JSON per the §12 column-value-format table.

The model output MUST conform to exactly this object shape:

```json
{
  "itemName": "string",
  "columnValues": {
    "<columnId>": "<human value>",
    "...": "..."
  },
  "reasoning": "string"
}
```

Human-value conventions the model MUST follow (backend converts these to §12 wire shapes):
- status / dropdown → the label string (e.g. `"Done"`); dropdown-multi → array of label strings (e.g. `["A","B"]`)
- date → ISO date string `"YYYY-MM-DD"`
- numbers → a JSON number (e.g. `42`) — the backend stringifies for Monday
- checkbox → boolean `true` / `false`
- text / long-text → string
- email / link / phone → string (the raw address / url / phone); the backend builds the `{email,text}` / `{url,text}` / `{phone,countryShortName}` object
- people → must NOT be inferred from free text; omit unless the form explicitly maps an answer to a known person id (see §18.3)

The model MUST NOT emit Monday wire JSON (e.g. `{"label":"Done"}`, `{"date":"..."}`). Producing wire JSON is a contract violation; the backend treats a wire-shaped value as invalid and drops it per §18.7.

### 18.2 Structured outputs (no free-text JSON, no fence-stripping)
Do NOT prompt for "JSON only" and strip fences / `try-catch`-parse. On `claude-sonnet-4-6`, constrain the response using one of:
- **Structured outputs** — `output_config: { format: { type: "json_schema", schema: <mapping schema> } }`, or
- **Forced tool-use** — a single tool (e.g. `emit_mapping`) whose `input_schema` is the 18.1 shape, with `strict: true`, `additionalProperties: false`, and `tool_choice: { type: "tool", name: "emit_mapping" }`.

Either makes prose/fences impossible and removes the parse-failure branch. The schema MUST set `additionalProperties: false` on the mapping object and constrain `columnValues` keys to the allowlist of §18.3 where the SDK permits.

**Retry/repair loop:** if the response still fails schema validation (or, with tool-use, the SDK reports invalid tool input), retry **once** with the validation error appended to the user turn. If the second attempt also fails, terminate the mapping as a hard failure: set submission status `failed` with `errorMessage`, do not call `create_item`, and preserve the submission per §14. Never loop more than one retry.

### 18.3 Writable-column allowlist and prompt structure
- The AI MAY target only the columnIds the builder explicitly associated with this form. It MUST NOT be given, or be able to write to, the whole board. Build the allowlist from the form's configured column associations; pass only those columns' `{id, title, type, allowedLabels}` into the prompt.
- **System turn:** the governing `aiPrompt`, the allowlisted board-column schema, and the Monday-mapping rules.
- **User turn:** the form questions and the client's answers, framed explicitly as untrusted data to be mapped — never as instructions. Instruct the model that answer content must never change which columns are written or override the system rules.
- **Post-generation validation (mandatory):** for every returned `columnValues` entry, reject and drop it unless (a) its columnId is in the allowlist AND (b) the value passes the column's type/allowed-label check (status/dropdown value ∈ allowedLabels; date parses as `YYYY-MM-DD`; number is numeric; etc.) per §18.7. Validate before any Monday write.

### 18.4 Integration parameters
- Use the official `@anthropic-ai/sdk` (TS) — do not hand-roll HTTP.
- Set an explicit `max_tokens` sized for the mapping object plus reasoning (default **2048**; raise for boards with many allowlisted columns). Do not rely on a low default that can truncate the JSON.
- Pin the API version: `anthropic-version: 2023-06-01` (the SDK sets this; if overriding transport, set it explicitly).
- System vs user split exactly as in §18.3.
- Deterministic posture: `temperature: 0`. NOTE: this does not guarantee identical output across calls — see §18.7 inclusion rules / §14.
- Do NOT pass parameters deprecated on 4.6: omit `budget_tokens`, `top_k`, and any `thinking.budget_tokens`. If thinking is used at all, use `thinking: { type: "adaptive" }`; otherwise omit it.

### 18.5 Prompt caching
Place the stable block — system rules + allowlisted board schema + `aiPrompt` — at the front and mark the end of that block with `cache_control: { type: "ephemeral" }`. Only the per-submission user turn (questions + answers) varies after the breakpoint. This caches the bulk of the input tokens across every submission for a form, cutting input cost (~90% on cached tokens) and time-to-first-token. Keep the cached prefix byte-stable: do not interpolate timestamps, submission ids, or per-request values into the system block.

### 18.6 Run off the request path
AI mapping and the Monday write run asynchronously on a worker/queue, NOT synchronously inside the public submit handler. The submit endpoint persists the raw submission and returns immediately (HTTP 2xx); a worker then performs mapping → validation → `create_item` → `add_file_to_column`, updating submission status (`mapped` / `partial` / `failed`) as it progresses. This ties into the §14 resumable flow and keeps anonymous public requests off the LLM latency/cost critical path. Apply a max-board-size guard (§18.8) before enqueuing.

### 18.7 Partial-success rule (mechanical — no confidence signal)
Do not ask the LLM to self-report confidence; there is no confidence field. Decide inclusion mechanically per value:
- **Include** a value iff (a) its columnId is in the form's allowlist/schema AND (b) it passes the §12 per-type shape/allowed-label validation (after backend conversion to wire JSON).
- **Drop** any value failing either check; record the dropped columnId and the reason (unknown/disallowed column, label not in allowedLabels, unparseable date, non-numeric number, model emitted wire JSON, etc.) in `reasoning` and `droppedColumns`.
- The item name always maps (fall back to a default name if empty).
- Submission status is `partial` iff at least one value was dropped (and the item was still created); `mapped` iff all returned values were written; `failed` per §18.2 / §14 if no item could be created.

### 18.8 Max board size guard
Before building the prompt, cap the allowlisted schema by token budget. If the serialized allowlisted schema (column titles + `settings_str` label lists) exceeds the budget, summarize/trim label lists (e.g. truncate very long allowed-label sets) or, if still over budget, fail the mapping cleanly with `failed` + `errorMessage` rather than sending an oversized prompt. Never silently truncate the schema mid-structure.

### 18.9 Auditability
- Store the rendered prompt (system + user) and the raw model response alongside `reasoning` for every mapping attempt, with PII in answers redacted per §12/§14 storage rules.
- Provide a **dry-run / preview**: given sample answers, run the full mapping + validation pipeline and return the would-be `column_values` and dropped-column report WITHOUT calling Monday. Surface this to the builder before a form is published (endpoint per §20).
- Require **eval fixtures** for tests: `(sample board schema + allowlist + sample answers) → expected column_values + expected dropped set`, covering each column type in the §12 table and the partial-success path.

---

## 19. Required Test Fixtures (capture before building integration)

Before starting the Monday-integration phase (§21 Phase 4), the developer/user MUST capture and commit ONE real fixture set under `/server/fixtures`. This is the single highest-leverage artifact in the whole build: it lets the Direct value formatter (§12), the AI mapper/parser (§18), and the Direct type-compatibility hint (§17) be unit-tested in isolation WITHOUT a live Monday board or live Anthropic call. Do not begin Phase 4/5 logic without these in place.

Required fixtures:
- **`board-schema.json`** — the actual, unedited response of `boards(ids:[<REAL_BOARD_ID>]){ columns{ id title type settings_str } groups{ id title } }` run against a real Monday board that contains at least one column of each type the app must support per §12 (text, long_text/text, number, status, dropdown, date, email/link, files). Preserve `settings_str` verbatim — the status/dropdown labels and the file-column settings live there.
- **`expected-column-values.json`** — a hand-written, correct `column_values` payload for one sample submission mapped against `board-schema.json`, with one entry per supported column type. This is the golden output the Direct formatter (§12) is asserted against.
- **`ai-mapping-response.json`** — a representative Anthropic response for the AI path: the raw model text plus the expected parsed `{ itemName, columnValues, reasoning }`. The parser/validator (§18) is asserted against this, including at least one invalid/unknown columnId that must be dropped.
- **`sample-submission.multipart`** (or a documented equivalent) — a sample `POST /api/public/forms/:slug/submit` request body: the `answers` JSON plus one small (<100 KB) test file for the attachment path (§13).

Commit fixtures with the repo. Tests in §22 read these; they must not require network access.

---

## 20. API Routes — Additions

Add the following to the §9 sketch. These consolidate routes implied by §13–§18. Methods + paths are normative; bodies/contracts are defined in the referenced sections.

- `POST /api/uploads/logo` — builder-auth, multipart; uploads a form logo, returns a stored asset reference for `Form.theme` (storage per §13).
- `POST /api/public/forms/:slug/submit` — already in §9; clarified as `multipart/form-data` carrying the `answers` JSON part plus zero or more file parts for attachment questions (transport + storage per §13).
- **Question persistence** — no separate Question CRUD. Questions are persisted nested in `PUT /api/forms/:id` as a full ordered array; the backend upserts by id, deletes omitted rows, and derives `order` from array position (contract per §14/§17). State this in the route doc so the builder save loop is unambiguous.
- `POST /api/forms/:id/preview-mapping` — builder-auth; dry-run that runs the Direct or AI mapping against a sample/last submission and returns the would-be `column_values` + (for AI) reasoning, WITHOUT writing to Monday (per §18).
- `POST /api/monday/boards/:id/schema/refresh` — builder-auth; forces a `BoardSchemaCache` refresh, bypassing the ~10-min TTL (per §11/§15).
- `POST /api/public/captcha/verify` — only if server-side CAPTCHA is used on the public submit (per §16); verifies the client token before accepting a submission. Omit if §16 chooses a client-only or token-in-submit approach.

---

## 21. Build Order & Phasing

Build in this order. Each phase must be independently verifiable before the next begins. Phases marked GATED cannot be completed or tested without the named live credentials — do not mark them done against mocks alone.

- **Phase 1 — Skeleton + Auth.** Repo scaffold (`/client`, `/server`, `prisma/schema.prisma`), Prisma schema + migrations, seed admin, Docker/compose, nginx config. Auth per §16 (login/logout/me, JWT cookie, protected middleware). *Verifiable with no external services.*
- **Phase 2 — Builder CRUD (Monday mocked).** Forms + nested-question persistence (§14/§17/§20), Dashboard, slug rules (§15). Mapping panel built; board dropdown and schema fed from `board-schema.json` (§19) rather than the live API. *Verifiable with §19 fixtures only — no live token needed.*
- **Phase 3 — Public form + Upload/Storage.** The three public screens, per-type rendering, required/type validation, attachment upload UI, and the file storage layer (§13). End-to-end verifiable EXCEPT the Monday write. *Mockable with `sample-submission.multipart` (§19); no live services.*
- **Phase 4 — Monday read + Direct write. [GATED: real Monday token + real board]** `GET /api/monday/boards`, `/schema` + `BoardSchemaCache` + manual refresh (§11/§15), the Direct formatter (§12), `create_item`, and `add_file_to_column` (§13). Unit-test the formatter against `expected-column-values.json` (§19) FIRST; only the live create-item/file-upload steps require the real token + board.
- **Phase 5 — AI mapping + Retry + Hardening. [GATED: Anthropic key]** AI engine (§18), partial/failed semantics + retry (§14), then the §22 hardening items. Unit-test the parser/validator against `ai-mapping-response.json` (§19) without the key; only the live model call requires `ANTHROPIC_API_KEY`.

Rule: the formatter, AI parser/validator, type-compat hint, and answer validation are all built and unit-tested against §19 fixtures BEFORE any live call. Live services validate integration, not core logic.

---

## 22. Production Hardening & Deliverables — Additions

Revise the "production-ready" claim in the header and §10: this prompt delivers a **hardened MVP**. It may NOT be called production-ready until all of the following ship:

- **Tests** — unit tests, all reading §19 fixtures (no network): the Monday value formatter (§12) against `expected-column-values.json`; the AI output parser/validator (§18) against `ai-mapping-response.json`, including dropped-invalid-columnId cases; and the answer validation (§15) for required/type/option rules.
- **Structured logging** — request and error logging on the server with correlation per submission id; log the inspected Monday `data`/`errors` body (§6) and the AI raw/parsed output on `partial`/`failed` so any failed submission is diagnosable.
- **Error monitoring hook** — wire an error-reporting hook (e.g., Sentry DSN via env, no-op if unset) on unhandled server errors.
- **Migrations on startup** — state and implement the policy: run `prisma migrate deploy` on container start before the app accepts traffic.
- **Rate limiting** — live on `POST /api/public/forms/:slug/submit` and `POST /api/auth/login` per §16 (the public submit spends Anthropic + Monday quota with no auth).
- **Backups** — README note documenting Postgres backup (e.g., `pg_dump` schedule against the compose volume); submissions are the system of record.

Add to `.env.example`: any keys introduced by §16/§22 (e.g., `SENTRY_DSN`, CAPTCHA secret) as documented placeholders.

**Precedence:** sections §11–§21 are MANDATORY and authoritative. Where they add detail to or conflict with the §1–§10 sketch, §11–§21 supersede §1–§10.
