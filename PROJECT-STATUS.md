# Projects Dashboard — Status Reference

**Purpose:** paste this file into a new chat as the first message to give Claude full context on this app — what it is, how it's deployed, its credentials/locations, and the gotchas hit while building it. Self-contained; doesn't require the original Self-Host Migration doc to be attached too, though that doc is the source of the underlying VPS/Coolify/Supabase patterns referenced here.

**Last updated:** 2026-09-26 — fully live and verified end-to-end (domain, TLS, login, health checks, CRUD all working in a real browser).

---

## What this app is

A single-user internal tool: a web dashboard that lists all of the person's self-hosted Supabase project stacks (running on `assistant_vps_3`, IP `77.222.47.140`) as cards, with server-side reachability health checks, and a UI to add/edit/delete project entries. It does **not** store any per-stack Studio/dashboard passwords — only metadata (name, Studio URL, ports, notes).

- **Repo:** `https://github.com/Aris1672/SupaaseDashboard` (public, `main` branch, single commit history so far)
- **Files:** `server.js`, `package.json`, `Dockerfile`, `public/index.html`, `DEPLOY.md`, this file
- **Stack:** plain Express (Node 20) + vanilla HTML/CSS/JS frontend (no framework, no build step) + `pg` for Postgres access
- **Auth:** HTTP Basic Auth on the whole app via `express-basic-auth`, credentials from `DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD` env vars — this is the app's own login, separate from any Supabase stack's Studio login
- **Live URL:** `https://supabase.assistant24info.ru` (also `www.supabase.assistant24info.ru`)

---

## Where it runs

### Coolify app (assistant_vps_4, 168.222.202.222)
- Created from the GitHub repo above, **Build Pack: Dockerfile** (set explicitly)
- Internal port: `3000`
- Domain routing: **Pattern B** (Traefik terminates HTTPS directly via Let's Encrypt, no Kazakhstan proxy box involved) — same pattern as `support.assistant24info.ru` and `logistics.assistant24info.ru`
- "Redirect HTTP to HTTPS": **Enabled**
- Env vars set (both Production and Preview):
  - `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` — the app's own login (values not repeated here; check Coolify's env var panel)
  - `DASHBOARD_DB_URL` = `postgresql://postgres.your-tenant-id:81QzGdnpFPi0IspXV5En9nB1rShLsejE@77.222.47.140:5437/postgres` — see "Supavisor tenant ID" gotcha below for why the username has to be `postgres.your-tenant-id`, not just `postgres`

### Its own dedicated Supabase stack — Stack 6 (assistant_vps_3, 77.222.47.140)
Per the person's established convention (every app/deployment gets its own full Supabase stack, even a small internal tool that only needs plain Postgres — Option B was chosen deliberately here over the lighter Option A "new DB inside Stack 1" approach):

- **Location on disk:** `~/supabase-projects-dashboard/docker`
- **Docker Compose project name:** `projects_dashboard` (container names prefixed `projects-dashboard-supabase-*`, plus `projects-dashboard-realtime-dev.supabase-realtime`)
- **Ports:** Studio/API gateway **8005**, Postgres **5437**, transaction pooler **6548**, Kong HTTPS **8448**
- **Studio login/URL:** `http://77.222.47.140:8005` — username `assistant24_supabase`, password `fvshuedVdn2EYOiMBQ6jQHut`
- **`POSTGRES_PASSWORD`:** `81QzGdnpFPi0IspXV5En9nB1rShLsejE`
- **`POOLER_TENANT_ID`:** `your-tenant-id` (never renamed from the template placeholder — same as every other stack on this VPS)
- **Default database:** `postgres`
- **Used by:** this app only. `ensureSchema()` in `server.js` runs `CREATE TABLE IF NOT EXISTS projects (...)` on every boot — no manual schema/migration step needed.
- **Auth/Storage/Realtime:** provisioned (full stack), but genuinely unused — the app only ever talks to Postgres directly via `pg`. Fine to leave as-is; not worth the effort of stripping down to a lighter compose file.

### Updated port allocation ledger (for the master Self-Host Migration doc)
| Stack # | COMPOSE_PROJECT_NAME | Studio/Envoy port | Postgres port | Transaction pooler port | Kong HTTPS port | Used by | Status |
|---|---|---|---|---|---|---|---|
| 6 | `projects_dashboard` | 8005 | 5437 | 6548 | 8448 | `projects-dashboard` (this app) | ✅ Live |

Next free slot is **7** (8006 / 5438 / 6549 / 8449).

---

## The 6 projects registered in the dashboard itself

| Name | Studio URL | compose_project_name | Studio port | PG port | Pooler port | Kong HTTPS |
|---|---|---|---|---|---|---|
| BMW club 77 | http://77.222.47.140:8000 | *(none — Stack 1)* | 8000 | 5432 | 6543 | 8443 |
| Avtostroy | http://77.222.47.140:8001 | avtostroy | 8001 | 5433 | 6544 | 8444 |
| Audit | http://77.222.47.140:8002 | senior_auditor | 8002 | 5434 | 6545 | 8445 |
| Logistics | http://77.222.47.140:8003 | mozaika | 8003 | 5435 | 6546 | 8446 |
| Support Agent | http://77.222.47.140:8004 | support_agent | 8004 | 5436 | 6547 | 8447 |
| Projects Dashboard | http://77.222.47.140:8005 | projects_dashboard | 8005 | 5437 | 6548 | 8448 |

These are stored as rows in this app's own `projects` table (Stack 6, `postgres` database) — editable from the UI, not hardcoded.

---

## DNS

Managed on the same panel as the other `assistant24info.ru` subdomains (spaceweb.ru registrar/hosting panel). Records added:
```
supabase       A    168.222.202.222
www.supabase   A    168.222.202.222
```
Both point directly at `assistant_vps_4` (Coolify), matching Pattern B. Propagation through Russian ISP resolvers took roughly 10–20 minutes after creation — resolved instantly via `8.8.8.8` the whole time, so if this ever needs debugging again: check with `Resolve-DnsName <domain> -Server 8.8.8.8` first to confirm the record itself is correct before assuming misconfiguration.

---

## Gotchas hit while building/deploying this app (worth remembering for the next one)

1. **A `public/` subfolder can silently flatten when uploading files through some UI flows.** The initial push ended up with `index.html` at the repo root instead of inside `public/`, which `server.js`'s `express.static(path.join(__dirname, "public"))` and its catch-all `res.sendFile(path.join(__dirname, "public", "index.html"))` both required. Symptom: container runs and passes basic auth, but throws `Error: ENOENT: no such file or directory, stat '/app/public/index.html'`. Fixed by renaming the file to `public/index.html` directly on GitHub (which auto-creates the folder). **Always verify the repo's actual file tree on GitHub matches the intended structure before debugging container-level causes.**

2. **Supavisor (the connection pooler) requires a tenant-qualified username.** Connecting to the pooler port (5437 here, or the equivalent on any stack) with a plain `postgres` username fails with:
   ```
   error: (ENOIDENTIFIER) no tenant identifier provided (external_id or sni_hostname required)
   ```
   Fix: use `postgres.<POOLER_TENANT_ID value>` as the username instead — e.g. `postgres.your-tenant-id` here, since `POOLER_TENANT_ID` was left at its template default. Check `grep "^POOLER_TENANT_ID" <stack>/docker/.env` for the actual value on any given stack before building a connection string. **This wasn't documented in the master migration doc before this app — worth adding there too**, since every future Option-B-style app connecting via the pooler port will hit the same error.

3. **Domain/env var changes only take effect after a Coolify redeploy** — confirmed again here (matches the master doc's existing gotcha). Both the initial 404 (before redeploy) and the later Bad Gateway → fixed-by-redeploy sequence were this same root cause playing out twice in one session.

4. **DNS propagation through a Russian ISP resolver can lag 10–20 min behind authoritative nameservers**, even though `8.8.8.8` reflects the correct record instantly. `ipconfig /flushdns` only clears the local machine's cache, not the ISP's upstream resolver cache — that has to expire on its own (governed by the zone's negative-cache TTL for a brand-new record). Not a misconfiguration signal by itself; cross-check with `-Server 8.8.8.8` before troubleshooting further.

---

## Possible follow-ups (not yet done, mention only if asked)
- Adding Kong HTTPS port 8448 and the tenant-ID gotcha into the master Self-Host Migration doc itself (offered, not yet actioned as of this doc's last update)
- No page-numbers/export features needed — this app has no such requirements
- Could add a "last checked" timestamp display per-card in the UI if wanted later
- Could strip Stack 6 down to a Postgres-only compose file to save ~1.3GB RAM (Auth/Storage/Realtime containers are running unused) — low priority, not requested
