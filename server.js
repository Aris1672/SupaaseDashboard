const express = require("express");
const basicAuth = require("express-basic-auth");
const { Pool } = require("pg");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Auth ----------
const DASHBOARD_USERNAME = process.env.DASHBOARD_USERNAME || "admin";
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD;

if (!DASHBOARD_PASSWORD) {
  console.error("FATAL: DASHBOARD_PASSWORD env var is not set. Refusing to start with no auth.");
  process.exit(1);
}

app.use(
  basicAuth({
    users: { [DASHBOARD_USERNAME]: DASHBOARD_PASSWORD },
    challenge: true,
    realm: "projects-dashboard",
  })
);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---------- DB ----------
// This app's own metadata lives in a dedicated database inside Stack 1
// (per the "Option A" pattern in the self-host migration doc) — it does
// NOT touch any of the actual project stacks' databases.
const pool = new Pool({
  connectionString: process.env.DASHBOARD_DB_URL,
  ssl: false, // Stack 1 has no SSL configured
});

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      studio_url TEXT NOT NULL,
      compose_project_name TEXT,
      port_studio INTEGER,
      port_postgres INTEGER,
      port_pooler INTEGER,
      port_kong_https INTEGER,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

// ---------- Health check cache ----------
// Server-side checks only: the browser never gets asked to reach these
// hosts directly, and no per-project Studio password is stored or used
// here at all -- a reachable HTTP response is enough to call it "up".
const healthCache = new Map(); // id -> { status, checkedAt, detail }
const HEALTH_TTL_MS = 60_000;
const HEALTH_TIMEOUT_MS = 5_000;

async function checkOne(project) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const res = await fetch(project.studio_url, {
      method: "GET",
      signal: controller.signal,
      redirect: "manual",
    });
    clearTimeout(timer);
    const ms = Date.now() - startedAt;
    // Any response at all (even a redirect or 401) means the host is up.
    const up = res.status < 500;
    return { status: up ? "up" : "degraded", detail: `HTTP ${res.status} (${ms}ms)`, checkedAt: Date.now() };
  } catch (err) {
    clearTimeout(timer);
    return { status: "down", detail: err.name === "AbortError" ? "timed out" : String(err.message || err), checkedAt: Date.now() };
  }
}

async function getHealth(project, force = false) {
  const cached = healthCache.get(project.id);
  if (!force && cached && Date.now() - cached.checkedAt < HEALTH_TTL_MS) {
    return cached;
  }
  const result = await checkOne(project);
  healthCache.set(project.id, result);
  return result;
}

// ---------- API ----------
app.get("/api/projects", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM projects ORDER BY id ASC");
  res.json(rows);
});

app.post("/api/projects", async (req, res) => {
  const { name, studio_url, compose_project_name, port_studio, port_postgres, port_pooler, port_kong_https, notes } = req.body || {};
  if (!name || !studio_url) {
    return res.status(400).json({ error: "name and studio_url are required" });
  }
  const { rows } = await pool.query(
    `INSERT INTO projects (name, studio_url, compose_project_name, port_studio, port_postgres, port_pooler, port_kong_https, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [name, studio_url, compose_project_name || null, port_studio || null, port_postgres || null, port_pooler || null, port_kong_https || null, notes || null]
  );
  res.status(201).json(rows[0]);
});

app.put("/api/projects/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { name, studio_url, compose_project_name, port_studio, port_postgres, port_pooler, port_kong_https, notes } = req.body || {};
  const { rows } = await pool.query(
    `UPDATE projects SET
       name = COALESCE($2, name),
       studio_url = COALESCE($3, studio_url),
       compose_project_name = $4,
       port_studio = $5,
       port_postgres = $6,
       port_pooler = $7,
       port_kong_https = $8,
       notes = $9,
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, name, studio_url, compose_project_name || null, port_studio || null, port_postgres || null, port_pooler || null, port_kong_https || null, notes || null]
  );
  if (!rows.length) return res.status(404).json({ error: "not found" });
  res.json(rows[0]);
});

app.delete("/api/projects/:id", async (req, res) => {
  const id = Number(req.params.id);
  await pool.query("DELETE FROM projects WHERE id = $1", [id]);
  healthCache.delete(id);
  res.status(204).end();
});

app.get("/api/health", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM projects ORDER BY id ASC");
  const force = req.query.force === "1";
  const results = await Promise.all(
    rows.map(async (p) => ({ id: p.id, ...(await getHealth(p, force)) }))
  );
  res.json(results);
});

app.get("/api/health/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await pool.query("SELECT * FROM projects WHERE id = $1", [id]);
  if (!rows.length) return res.status(404).json({ error: "not found" });
  const result = await getHealth(rows[0], true);
  res.json({ id, ...result });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

ensureSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`projects-dashboard listening on ${PORT}`));
  })
  .catch((err) => {
    console.error("Failed to ensure schema:", err);
    process.exit(1);
  });
