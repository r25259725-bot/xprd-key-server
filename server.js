// X Predictions — License Key Server with Stripe Payments
// Deploy on Railway. Uses local JSON file for keys.
const http = require("http");
const fs = require("fs");
const path = require("path");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY || "sk_test_dummy");

// ─────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────
const ADMIN_PASSWORD = process.env.ADMIN_PASS || "Laurab1400";
const PORT = process.env.PORT || 8080;
const DB_PATH = path.join(__dirname, "keys.json");
const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || "pk_test_dummy";

// Key pricing (in cents)
const PRICING = {
  "1-month": { price: 999, durationDays: 30, name: "1 Month" },
  "3-month": { price: 2499, durationDays: 90, name: "3 Months" },
  "1-year": { price: 7999, durationDays: 365, name: "1 Year" }
};

// ─────────────────────────────────────────────
// DB helpers
// ─────────────────────────────────────────────
function loadDB() {
  if (!fs.existsSync(DB_PATH)) return { keys: {}, orders: {} };
  try { return JSON.parse(fs.readFileSync(DB_PATH, "utf8")); }
  catch { return { keys: {}, orders: {} }; }
}

function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// ─────────────────────────────────────────────
// Request helpers
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

// Generate a random key
function generateKey() {
  const seg = () => Math.random().toString(36).substring(2, 6).toUpperCase();
  return "XPRD-" + seg() + "-" + seg() + "-" + seg();
}

// ─────────────────────────────────────────────
// Validation Routes
// ─────────────────────────────────────────────

// POST /validate { key, hwid }
async function handleValidate(req, res) {
  const { key, hwid } = await readBody(req);
  if (!key || !hwid) return json(res, 400, { valid: false, reason: "Missing key or hwid" });

  const db = loadDB();
  const norm = key.trim().toUpperCase();
  const entry = db.keys[norm];

  if (!entry) return json(res, 200, { valid: false, reason: "Unknown key" });
  if (entry.revoked) return json(res, 200, { valid: false, reason: "Key revoked" });

  // Check expiration
  if (entry.expiresAt && new Date(entry.expiresAt) < new Date()) {
    return json(res, 200, { valid: false, reason: "Key expired" });
  }

  // First use — bind to device
  if (!entry.hwid) {
    entry.hwid = hwid;
    entry.activatedAt = new Date().toISOString();
    entry.lastSeen = new Date().toISOString();
    saveDB(db);
    return json(res, 200, { valid: true, reason: "Activated" });
  }

  // Already bound — check device matches
  if (entry.hwid !== hwid) {
    return json(res, 200, { valid: false, reason: "Key already in use on another device" });
  }

  // All good
  entry.lastSeen = new Date().toISOString();
  saveDB(db);
  return json(res, 200, { valid: true, reason: "OK" });
}

// ─────────────────────────────────────────────
// Shop Routes
// ─────────────────────────────────────────────

// GET /shop
// Shop page with pricing
function handleShop(req, res) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>X Predictions — Buy License Key</title>
<script src="https://js.stripe.com/v3/"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Courier New',monospace;background:#050508;color:#eef0ff;min-height:100vh;padding:32px 24px}
h1{color:#e8ff00;font-size:20px;letter-spacing:.15em;margin-bottom:4px}
.sub{color:#5a5a8a;font-size:11px;letter-spacing:.1em;margin-bottom:28px}
.container{max-width:900px;margin:0 auto}
.pricing-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px;margin-bottom:32px}
.card{background:#0c0c18;border:1px solid #1c1c35;border-radius:8px;padding:24px;transition:border-color .2s}
.card:hover{border-color:#6e44ff}
.card h2{color:#e8ff00;font-size:14px;letter-spacing:.1em;margin-bottom:8px}
.price{font-size:24px;color:#00f5a0;margin:16px 0;font-weight:700}
.price-label{color:#5a5a8a;font-size:10px;letter-spacing:.08em}
.features{list-style:none;margin:16px 0;font-size:11px;line-height:1.8}
.features li{color:#5a5a8a;margin-bottom:6px}
.features li:before{content:"✓ ";color:#00f5a0;margin-right:6px}
button{padding:10px 20px;border-radius:4px;border:none;cursor:pointer;font-family:inherit;font-size:11px;letter-spacing:.1em;font-weight:700;transition:opacity .15s;background:#e8ff00;color:#050508;width:100%;margin-top:16px}
button:hover{opacity:.85}
button:disabled{opacity:.5;cursor:not-allowed}
.checkout-form{background:#0c0c18;border:1px solid #1c1c35;border-radius:8px;padding:24px;max-width:500px;margin:0 auto}
.checkout-form h2{color:#e8ff00;font-size:14px;letter-spacing:.1em;margin-bottom:16px}
.form-group{margin-bottom:16px}
.form-group label{display:block;color:#5a5a8a;font-size:10px;letter-spacing:.08em;margin-bottom:6px}
input{background:#08080f;border:1px solid #252545;border-radius:4px;padding:10px 12px;color:#eef0ff;font-family:inherit;font-size:12px;width:100%;outline:none}
input:focus{border-color:rgba(232,255,0,.4)}
#card-element{background:#08080f;border:1px solid #252545;border-radius:4px;padding:10px 12px;color:#eef0ff}
.error{color:#ff3d6e;font-size:10px;margin-top:4px;min-height:14px}
.success{color:#00f5a0;font-size:11px;margin-top:8px;padding:8px;background:rgba(0,245,160,.1);border-radius:4px}
.hidden{display:none}
</style>
</head>
<body>
<div class="container">
<h1>X PREDICTIONS</h1>
<div class="sub">LICENSE KEY SHOP</div>

<div id="pricing" class="pricing-grid">
  <div class="card">
    <h2>1 MONTH</h2>
    <div class="price-label">Full access</div>
    <div class="price">$9.99</div>
    <ul class="features">
      <li>30 days of access</li>
      <li>All features included</li>
      <li>Instant activation</li>
    </ul>
    <button onclick="selectPlan('1-month')">BUY NOW</button>
  </div>

  <div class="card">
    <h2>3 MONTHS</h2>
    <div class="price-label">Best value</div>
    <div class="price">$24.99</div>
    <ul class="features">
      <li>90 days of access</li>
      <li>All features included</li>
      <li>Save 17%</li>
    </ul>
    <button onclick="selectPlan('3-month')">BUY NOW</button>
  </div>

  <div class="card">
    <h2>1 YEAR</h2>
    <div class="price-label">Best deal</div>
    <div class="price">$79.99</div>
    <ul class="features">
      <li>365 days of access</li>
      <li>All features included</li>
      <li>Save 33%</li>
    </ul>
    <button onclick="selectPlan('1-year')">BUY NOW</button>
  </div>
</div>

<div id="checkout" class="checkout-form hidden">
  <h2 id="planName"></h2>
  <form id="payment-form">
    <div class="form-group">
      <label>Email</label>
      <input type="email" id="email" required placeholder="your@email.com"/>
    </div>
    <div class="form-group">
      <label>Card Details</label>
      <div id="card-element"></div>
      <div class="error" id="card-error"></div>
    </div>
    <button type="submit" id="submit-btn">Complete Purchase</button>
    <button type="button" onclick="cancelCheckout()" style="background:rgba(255,61,110,.15);color:#ff3d6e;margin-top:8px">Cancel</button>
    <div class="error" id="error-message"></div>
    <div class="success hidden" id="success-message"></div>
  </form>
</div>
</div>

<script>
const stripe = Stripe('${STRIPE_PUBLISHABLE_KEY}');
const elements = stripe.elements();
const cardElement = elements.create('card');
let selectedPlan = null;

function selectPlan(plan) {
  selectedPlan = plan;
  const plans = { '1-month': '1 Month - $9.99', '3-month': '3 Months - $24.99', '1-year': '1 Year - $79.99' };
  document.getElementById('planName').textContent = plans[plan];
  document.getElementById('pricing').classList.add('hidden');
  document.getElementById('checkout').classList.remove('hidden');
  cardElement.mount('#card-element');
}

function cancelCheckout() {
  selectedPlan = null;
  document.getElementById('pricing').classList.remove('hidden');
  document.getElementById('checkout').classList.add('hidden');
  cardElement.unmount();
  document.getElementById('payment-form').reset();
}

document.getElementById('payment-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('email').value;
  const submitBtn = document.getElementById('submit-btn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Processing...';

  try {
    const res = await fetch('/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: selectedPlan, email })
    });
    const { clientSecret } = await res.json();

    const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
      payment_method: { card: cardElement, billing_details: { email } }
    });

    if (error) {
      document.getElementById('card-error').textContent = error.message;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Complete Purchase';
    } else if (paymentIntent.status === 'succeeded') {
      document.getElementById('payment-form').classList.add('hidden');
      const successMsg = document.getElementById('success-message');
      successMsg.classList.remove('hidden');
      successMsg.innerHTML = \`<strong>✓ Payment successful!</strong><br/>Your license key is being generated. Check your email at <strong>\${email}</strong> shortly.\`;
    }
  } catch (err) {
    document.getElementById('error-message').textContent = 'Error: ' + err.message;
    submitBtn.disabled = false;
    submitBtn.textContent = 'Complete Purchase';
  }
});
</script>
</body>
</html>`;
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(html);
}

// POST /checkout
// Create Stripe payment intent
async function handleCheckout(req, res) {
  const { plan, email } = await readBody(req);
  if (!plan || !PRICING[plan]) return json(res, 400, { error: "Invalid plan" });
  if (!email) return json(res, 400, { error: "Email required" });

  try {
    const intent = await stripe.paymentIntents.create({
      amount: PRICING[plan].price,
      currency: "usd",
      metadata: { plan, email }
    });
    return json(res, 200, { clientSecret: intent.client_secret });
  } catch (err) {
    return json(res, 500, { error: err.message });
  }
}

// POST /webhook/stripe
// Handle Stripe webhook for successful payments
async function handleStripeWebhook(req, res) {
  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.warn("STRIPE_WEBHOOK_SECRET not set — webhook verification skipped");
    return json(res, 400, { error: "Webhook secret not configured" });
  }

  try {
    const event = stripe.webhooks.constructEvent(
      await readBody(req),
      sig,
      webhookSecret
    );

    if (event.type === "payment_intent.succeeded") {
      const { metadata } = event.data.object;
      const db = loadDB();
      const key = generateKey();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + PRICING[metadata.plan].durationDays);

      db.keys[key] = {
        revoked: false,
        hwid: null,
        createdAt: new Date().toISOString(),
        expiresAt: expiresAt.toISOString(),
        purchasedBy: metadata.email,
        plan: metadata.plan
      };
      saveDB(db);

      console.log(`✓ Key generated for ${metadata.email}: ${key}`);
      // TODO: Send email with key to metadata.email
    }

    return json(res, 200, { received: true });
  } catch (err) {
    console.error("Webhook error:", err.message);
    return json(res, 400, { error: err.message });
  }
}

// ─────────────────────────────────────────────
// Admin Routes (unchanged)
// ─────────────────────────────────────────────

function handleListKeys(req, res) {
  if (req.headers["x-admin-pass"] !== ADMIN_PASSWORD)
    return json(res, 401, { error: "Bad password" });
  const db = loadDB();
  return json(res, 200, db.keys);
}

async function handleAddKey(req, res) {
  if (req.headers["x-admin-pass"] !== ADMIN_PASSWORD)
    return json(res, 401, { error: "Bad password" });
  const { key } = await readBody(req);
  if (!key) return json(res, 400, { error: "No key provided" });
  const db = loadDB();
  const norm = key.trim().toUpperCase();
  if (db.keys[norm]) return json(res, 409, { error: "Key already exists" });
  db.keys[norm] = { revoked: false, hwid: null, createdAt: new Date().toISOString() };
  saveDB(db);
  return json(res, 200, { ok: true, key: norm });
}

async function handleRevokeKey(req, res) {
  if (req.headers["x-admin-pass"] !== ADMIN_PASSWORD)
    return json(res, 401, { error: "Bad password" });
  const { key, resetHwid } = await readBody(req);
  if (!key) return json(res, 400, { error: "No key provided" });
  const db = loadDB();
  const norm = key.trim().toUpperCase();
  if (!db.keys[norm]) return json(res, 404, { error: "Key not found" });
  db.keys[norm].revoked = true;
  if (resetHwid) db.keys[norm].hwid = null;
  saveDB(db);
  return json(res, 200, { ok: true });
}

async function handleUnrevokeKey(req, res) {
  if (req.headers["x-admin-pass"] !== ADMIN_PASSWORD)
    return json(res, 401, { error: "Bad password" });
  const { key } = await readBody(req);
  const db = loadDB();
  const norm = key.trim().toUpperCase();
  if (!db.keys[norm]) return json(res, 404, { error: "Key not found" });
  db.keys[norm].revoked = false;
  saveDB(db);
  return json(res, 200, { ok: true });
}

async function handleResetHwid(req, res) {
  if (req.headers["x-admin-pass"] !== ADMIN_PASSWORD)
    return json(res, 401, { error: "Bad password" });
  const { key } = await readBody(req);
  const db = loadDB();
  const norm = key.trim().toUpperCase();
  if (!db.keys[norm]) return json(res, 404, { error: "Key not found" });
  db.keys[norm].hwid = null;
  db.keys[norm].activatedAt = null;
  saveDB(db);
  return json(res, 200, { ok: true });
}

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
 <td style="color:#5a5a8a;font-size:9px">\${info.hwid ? info.hwid.slice(0,12)+"..." : "—"}</td>
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
// Main router
// ─────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = req.url.split("?")[0];
  if (req.method === "OPTIONS") return cors(res);

  // Shop routes
  if (req.method === "GET" && url === "/shop") return handleShop(req, res);
  if (req.method === "POST" && url === "/checkout") return handleCheckout(req, res);
  if (req.method === "POST" && url === "/webhook/stripe") return handleStripeWebhook(req, res);

  // Validation
  if (req.method === "POST" && url === "/validate") return handleValidate(req, res);

  // Admin
  if (req.method === "GET" && url === "/admin/keys") return handleListKeys(req, res);
  if (req.method === "GET" && url === "/admin/dashboard") return handleDashboard(req, res);
  if (req.method === "POST" && url === "/admin/add") return handleAddKey(req, res);
  if (req.method === "POST" && url === "/admin/revoke") return handleRevokeKey(req, res);
  if (req.method === "POST" && url === "/admin/unrevoke") return handleUnrevokeKey(req, res);
  if (req.method === "POST" && url === "/admin/reset-hwid") return handleResetHwid(req, res);

  // Root redirect
  if (url === "/") return res.writeHead(302, { Location: "/shop" }), res.end();

  return json(res, 404, { error: "Not found" });
});

server.listen(PORT, () => console.log("X Predictions key server running on port", PORT));

