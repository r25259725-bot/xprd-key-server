# X Predictions — Key Server

## Deploy to Railway
1. Push this folder to a GitHub repo
2. Go to railway.app → New Project → Deploy from GitHub
3. Set environment variable: ADMIN_PASS=yourpassword
4. Railway gives you a URL like https://xprd-key-server.up.railway.app

## Admin Dashboard
Visit: https://your-railway-url.up.railway.app/admin/dashboard

## API Endpoints
POST /validate        { key, hwid }           → { valid, reason }
GET  /admin/keys      header: x-admin-pass    → all keys
POST /admin/add       { key }                 → add key
POST /admin/revoke    { key }                 → revoke key
POST /admin/unrevoke  { key }                 → unrevoke key
POST /admin/reset-hwid { key }               → unbind device
