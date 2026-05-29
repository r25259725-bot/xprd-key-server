// X Predictions — License Key Server
// Deploy on Railway. No database needed — uses a local JSON file.

const http = require("http");
const fs   = require("fs");
const path = require("path");

// ─────────────────────────────────────────────
//  CONFIG  ← change these before deploying
// ─────────────────────────────────────────────
const ADMIN_PASSWORD = process.env.ADMIN_PASS || "changeme123";
const PORT           = process.env.PORT || 3000;
const DB_PATH        = path.join(__dirname, "keys.json");

// ─────────────────────────────────────────────
//  DB helpers (flat JSON file)
// ─────────────────────────────────────────────
function loadDB() {
  if (!fs.existsSync(DB_PATH)) return { keys: {} };
  try { return JSON.parse(fs.readFileSync(DB_PATH, "utf8")); }
  catch { return { keys: {} }; }
}

function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// ─────────────────────────────────────────────
//  Request helpers
// ─────────────────────────────────────────────
function readBody(req) {
  return new Promise((res, rej) => {
    let data = "";
    req.on("data", c => data += c);
    req.on("end", () => {
      try { res(JSON.parse(data)); } catch { res({}); }
    });
    req.on("error", rej);
  });
}

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,X-Admin-Pass"
  });
  res.end(body);
}

function cors(res) {
  res.writeHead(204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,X-Admin-Pass"
  });
  res.end();
}

// ─────────────────────────────────────────────
//  Routes
// ─────────────────────────────────────────────

// POST /validate  { key, hwid }
// Called by the extension on every popup open
async function handleValidate(req, res) {
  const { key, hwid } = await readBody(req);

  if (!key || !hwid) return json(res, 400, { valid: false, reason: "Missing key or hwid" });

  const db   = loadDB();
  const norm = key.trim().toUpperCase();
  const entry = db.keys[norm];

  if (!entry) return json(res, 200, { valid: false, reason: "Unknown key" });
  if (entry.revoked) return json(res, 200, { valid: false, reason: "Key revoked" });

  // First use — bind to this device
  if (!entry.hwid) {
    entry.hwid      = hwid;
    entry.activatedAt = new Date().toISOString();
    entry.lastSeen    = new Date().toISOString();
    saveDB(db);
    return json(res, 200, { valid: true, reason: "Activated" });
  }

  // Already bound — check device matches
  if (entry.hwid !== hwid) {
    return json(res, 200, { valid: false, reason: "Key already in use on another device" });
  }

  // All good — update last seen
  entry.lastSeen = new Date().toISOString();
  saveDB(db);
  return json(res, 200, { valid: true, reason: "OK" });
}

// GET /admin/keys  (header: x-admin-pass)
// Returns all keys and their status
function handleListKeys(req, res) {
  if (req.headers["x-admin-pass"] !== ADMIN_PASSWORD)
    return json(res, 401, { error: "Bad password" });

  const db = loadDB();
  return json(res, 200, db.keys);
}

// POST /admin/add  { key }
// Add a new key
async function handleAddKey(req, res) {
  if (req.headers["x-admin-pass"] !== ADMIN_PASSWORD)
    return json(res, 401, { error: "Bad password" });

  const { key } = await readBody(req);
  if (!key) return json(res, 400, { error: "No key provided" });

  const db   = loadDB();
  const norm = key.trim().toUpperCase();
  if (db.keys[norm]) return json(res, 409, { error: "Key already exists" });

  db.keys[norm] = { revoked: false, hwid: null, createdAt: new Date().toISOString() };
  saveDB(db);
  return json(res, 200, { ok: true, key: norm });
}

// POST /admin/revoke  { key }
// Revoke a key (and optionally reset hwid so it can be rebound)
async function handleRevokeKey(req, res) {
  if (req.headers["x-admin-pass"] !== ADMIN_PASSWORD)
    return json(res, 401, { error: "Bad password" });

  const { key, resetHwid } = await readBody(req);
  if (!key) return json(res, 400, { error: "No key provided" });

  const db   = loadDB();
  const norm = key.trim().toUpperCase();
  if (!db.keys[norm]) return json(res, 404, { error: "Key not found" });

  db.keys[norm].revoked = true;
  if (resetHwid) db.keys[norm].hwid = null;
  saveDB(db);
  return json(res, 200, { ok: true });
}

// POST /admin/unrevoke  { key }
async function handleUnrevokeKey(req, res) {
  if (req.headers["x-admin-pass"] !== ADMIN_PASSWORD)
    return json(res, 401, { error: "Bad password" });

  const { key } = await readBody(req);
  const db   = loadDB();
  const norm = key.trim().toUpperCase();
  if (!db.keys[norm]) return json(res, 404, { error: "Key not found" });
  db.keys[norm].revoked = false;
  saveDB(db);
  return json(res, 200, { ok: true });
}

// POST /admin/reset-hwid  { key }
// Unbind a key from its device (e.g. customer got new PC)
async function handleResetHwid(req, res) {
  if (req.headers["x-admin-pass"] !== ADMIN_PASSWORD)
    return json(res, 401, { error: "Bad password" });

  const { key } = await readBody(req);
  const db   = loadDB();
  const norm = key.trim().toUpperCase();
  if (!db.keys[norm]) return json(res, 404, { error: "Key not found" });
  db.keys[norm].hwid = null;
  db.keys[norm].activatedAt = null;
  saveDB(db);
  return json(res, 200, { ok: true });
}

// GET /admin/dashboard
// Simple HTML dashboard to manage keys from a browser
function handleDashboard(req, res) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>X Predictions — Key Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Courier New',monospace;background:#050508;color:#eef0ff;min-height:100vh;padding:32px 24px}
h1{color:#e8ff00;font-size:20px;letter-spacing:.15em;margin-bottom:4px}
.sub{color:#5a5a8a;font-size:11px;letter-spacing:.1em;margin-bottom:28px}
.card{background:#0c0c18;border:1px solid #1c1c35;border-radius:8px;padding:20px;margin-bottom:16px}
.card h2{font-size:11px;letter-spacing:.15em;color:#5a5a8a;margin-bottom:12px}
input{background:#08080f;border:1px solid #252545;border-radius:4px;padding:9px 12px;color:#eef0ff;font-family:inherit;font-size:12px;width:100%;margin-bottom:8px;outline:none}
input:focus{border-color:rgba(232,255,0,.4)}
button{padding:9px 18px;border-radius:4px;border:none;cursor:pointer;font-family:inherit;font-size:11px;letter-spacing:.1em;font-weight:700;transition:opacity .15s}
button:hover{opacity:.85}
.btn-y{background:#e8ff00;color:#050508}
.btn-r{background:rgba(255,61,110,.15);border:1px solid rgba(255,61,110,.3);color:#ff3d6e}
.btn-g{background:rgba(0,245,160,.1);border:1px solid rgba(0,245,160,.25);color:#00f5a0}
.btn-m{background:rgba(110,68,255,.1);border:1px solid rgba(110,68,255,.3);color:#6e44ff}
.row{display:flex;gap:8px;margin-bottom:8px;align-items:center;flex-wrap:wrap}
#keysTable{width:100%;border-collapse:collapse;font-size:11px;margin-top:8px}
#keysTable th{text-align:left;padding:6px 8px;color:#5a5a8a;border-bottom:1px solid #1c1c35;letter-spacing:.08em}
#keysTable td{padding:7px 8px;border-bottom:1px solid #0c0c18;vertical-align:middle}
.badge{display:inline-block;padding:2px 7px;border-radius:2px;font-size:9px;letter-spacing:.08em}
.ok{background:rgba(0,245,160,.08);color:#00f5a0;border:1px solid rgba(0,245,160,.2)}
.rev{background:rgba(255,61,110,.08);color:#ff3d6e;border:1px solid rgba(255,61,110,.2)}
.unbound{background:rgba(232,255,0,.06);color:#e8ff00;border:1px solid rgba(232,255,0,.15)}
#status{font-size:10px;color:#5a5a8a;margin-top:6px;min-height:16px}
</style>
</head>
<body>
<h1>X PREDICTIONS</h1>
<div class="sub">LICENSE KEY DASHBOARD</div>

<div class="card">
  <h2>ADMIN LOGIN</h2>
  <input type="password" id="passInput" placeholder="Admin password" />
  <button class="btn-y" onclick="loadKeys()">LOGIN &amp; LOAD KEYS</button>
  <div id="status"></div>
</div>

<div class="card">
  <h2>ADD NEW KEY</h2>
  <div class="row">
    <input type="text" id="newKey" placeholder="e.g. XPRD-XXXX-XXXX-XXXX" style="margin:0;flex:1"/>
    <button class="btn-g" onclick="genKey()">AUTO-GENERATE</button>
    <button class="btn-y" onclick="addKey()">ADD KEY</button>
  </div>
</div>

<div class="card">
  <h2>ALL KEYS</h2>
  <button class="btn-g" onclick="loadKeys()" style="margin-bottom:12px">↺ REFRESH</button>
  <table id="keysTable">
    <thead><tr><th>KEY</th><th>STATUS</th><th>DEVICE BOUND</th><th>LAST SEEN</th><th>ACTIONS</th></tr></thead>
    <tbody id="keyBody"><tr><td colspan="5" style="color:#5a5a8a;padding:12px 8px">Login to load keys.</td></tr></tbody>
  </table>
</div>

<script>
function pass() { return document.getElementById("passInput").value; }
function status(msg, color) { document.getElementById("status").style.color = color||"#5a5a8a"; document.getElementById("status").textContent = msg; }

function genKey() {
  const seg = () => Math.random().toString(36).substring(2,6).toUpperCase();
  document.getElementById("newKey").value = "XPRD-"+seg()+"-"+seg()+"-"+seg();
}

async function api(method, path, body) {
  const res = await fetch(path, { method, headers: { "Content-Type":"application/json", "x-admin-pass": pass() }, body: body ? JSON.stringify(body) : undefined });
  return res.json();
}

async function loadKeys() {
  status("Loading...");
  const data = await api("GET", "/admin/keys");
  if (data.error) { status("Error: "+data.error, "#ff3d6e"); return; }
  status("Loaded "+Object.keys(data).length+" keys", "#00f5a0");
  const tbody = document.getElementById("keyBody");
  tbody.innerHTML = "";
  for (const [key, info] of Object.entries(data)) {
    const tr = document.createElement("tr");
    const statusBadge = info.revoked ? '<span class="badge rev">REVOKED</span>' : (info.hwid ? '<span class="badge ok">ACTIVE</span>' : '<span class="badge unbound">UNBOUND</span>');
    tr.innerHTML = \`
      <td style="letter-spacing:.06em;color:#e8ff00">\${key}</td>
      <td>\${statusBadge}</td>
      <td style="color:#5a5a8a;font-size:9px">\${info.hwid ? info.hwid.slice(0,12)+"…" : "—"}</td>
      <td style="color:#5a5a8a;font-size:9px">\${info.lastSeen ? new Date(info.lastSeen).toLocaleDateString() : "—"}</td>
      <td>
        <div style="display:flex;gap:5px;flex-wrap:wrap">
          \${info.revoked
            ? \`<button class="btn-g" style="font-size:9px;padding:4px 8px" onclick="unrevokeKey('\${key}')">UNREVOKE</button>\`
            : \`<button class="btn-r" style="font-size:9px;padding:4px 8px" onclick="revokeKey('\${key}')">REVOKE</button>\`
          }
          <button class="btn-m" style="font-size:9px;padding:4px 8px" onclick="resetHwid('\${key}')">RESET DEVICE</button>
        </div>
      </td>
    \`;
    tbody.appendChild(tr);
  }
}

async function addKey() {
  const key = document.getElementById("newKey").value.trim();
  if (!key) return;
  const res = await api("POST", "/admin/add", { key });
  if (res.error) { alert(res.error); return; }
  document.getElementById("newKey").value = "";
  loadKeys();
}

async function revokeKey(key) {
  if (!confirm("Revoke " + key + "?")) return;
  await api("POST", "/admin/revoke", { key });
  loadKeys();
}

async function unrevokeKey(key) {
  await api("POST", "/admin/unrevoke", { key });
  loadKeys();
}

async function resetHwid(key) {
  if (!confirm("Unbind device for " + key + "? The key can then be activated on a new device.")) return;
  await api("POST", "/admin/reset-hwid", { key });
  loadKeys();
}
</script>
</body>
</html>`;
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(html);
}

// ─────────────────────────────────────────────
//  Main router
// ─────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = req.url.split("?")[0];

  if (req.method === "OPTIONS") return cors(res);

  if (req.method === "POST" && url === "/validate")           return handleValidate(req, res);
  if (req.method === "GET"  && url === "/admin/keys")         return handleListKeys(req, res);
  if (req.method === "GET"  && url === "/admin/dashboard")    return handleDashboard(req, res);
  if (req.method === "POST" && url === "/admin/add")          return handleAddKey(req, res);
  if (req.method === "POST" && url === "/admin/revoke")       return handleRevokeKey(req, res);
  if (req.method === "POST" && url === "/admin/unrevoke")     return handleUnrevokeKey(req, res);
  if (req.method === "POST" && url === "/admin/reset-hwid")   return handleResetHwid(req, res);

  return json(res, 404, { error: "Not found" });
});

server.listen(PORT, () => console.log("X Predictions key server running on port", PORT));
