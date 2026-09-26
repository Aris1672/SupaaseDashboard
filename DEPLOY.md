# Deploying projects-dashboard

This app is an internal single-user tool: it lists your Supabase stacks,
does server-side health checks, and lets you add/edit/delete entries.
It stores only *metadata* (name, Studio URL, ports, notes) — never any of
the per-stack Studio/DASHBOARD passwords.

## 1. Create its database (Option A pattern — new DB inside Stack 1)

SSH into the Supabase VPS and create a dedicated database for this app,
same as any other Option A app:

```bash
ssh root@77.222.47.140
docker exec supabase-db psql -U postgres -c "CREATE DATABASE projects_dashboard;"
```

The app will create its own `projects` table on first boot (`ensureSchema()`
in `server.js` runs `CREATE TABLE IF NOT EXISTS`), so no manual schema step
needed beyond creating the database itself.

## 2. Push this code to a GitHub repo

Create a new repo (e.g. `projects-dashboard`) and push these files:
`server.js`, `package.json`, `Dockerfile`, `public/index.html`.

```bash
cd projects-dashboard
git init
git add server.js package.json Dockerfile public/index.html
git commit -m "Initial projects dashboard"
git branch -M main
git remote add origin git@github.com:<you>/projects-dashboard.git
git push -u origin main
```

(No shim needed — this is already a plain Express app with its own
`server.js` calling `app.listen()`, so per the migration doc's pattern it
just needs a Dockerfile, which is already included.)

## 3. Create the Coolify app

On `assistant_vps_4` Coolify dashboard (`http://168.222.202.222:8000`):

1. New Resource → pick the `My-Git-Hub` source → select the
   `projects-dashboard` repo.
2. **Build pack: Dockerfile** (set explicitly, don't trust auto-detect).
3. Set environment variables (both Production **and** Preview — Coolify
   keeps them separate):
   - `DASHBOARD_USERNAME` = whatever you want your login to be
   - `DASHBOARD_PASSWORD` = a strong, unique password (don't reuse any
     existing Supabase dashboard password)
   - `DASHBOARD_DB_URL` = `postgresql://postgres:h7QXHfD40buenTZ9kdptHr45WJWcTAX@77.222.47.140:5432/projects_dashboard`
     (Stack 1's Postgres password, session-pooling port 5432, new database
     from step 1)
   - `PORT` = `3000` (already the Dockerfile default, only needed if you
     want to override)
4. Internal port: `3000`.
5. Deploy. No domain needed yet — you said no public domain for now, so
   just use Coolify's internal preview URL or a port-forward/SSH tunnel to
   reach it while testing. When you're ready to expose it, follow the
   migration doc's Pattern A/B domain routing steps (remember: adding a
   domain alone doesn't take effect until a redeploy).

## 4. First login and seeding

Once it's up, open it and log in with the `DASHBOARD_USERNAME` /
`DASHBOARD_PASSWORD` you set. Click **+ Add project** and add your five
existing stacks using the port ledger from the migration doc:

| Name | Studio URL | compose_project_name | Studio port | PG port | Pooler port | Kong HTTPS |
|---|---|---|---|---|---|---|
| BMW club 77 | http://77.222.47.140:8000 | *(none — Stack 1)* | 8000 | 5432 | 6543 | 8443 |
| Avtostroy | http://77.222.47.140:8001 | avtostroy | 8001 | 5433 | 6544 | 8444 |
| Audit | http://77.222.47.140:8002 | senior_auditor | 8002 | 5434 | 6545 | 8445 |
| Logistics | http://77.222.47.140:8003 | mozaika | 8003 | 5435 | 6546 | 8446 |
| Support Agent | http://77.222.47.140:8004 | support_agent | 8004 | 5436 | 6547 | 8447 |

Don't put the per-project Studio/DASHBOARD passwords into the notes field
or anywhere in this app — it's not designed to store secrets, only to
launch you into each Studio's own login.

## How health checks work

`GET /api/health` does a server-side `fetch()` against each project's
Studio URL with a 5s timeout, cached for 60s (force-refreshable via the
"Refresh status" button, which calls `?force=1`). A response status under
500 (even a login page or redirect) counts as "up" — this only tells you
the host/port is reachable, not that Postgres/Auth/Storage inside it are
healthy. Green = reachable, yellow = reachable but returned 5xx, red =
timed out or connection refused.
