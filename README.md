# 🎮 Gameify v2 — With Accounts

## Features
- Register / Login with username & password
- Google Sign-In (optional)
- Each user has their own private game library
- Full CRUD: add, edit, delete games
- Star ratings, notes, status tracking
- Zero npm dependencies

## Run Locally

```bash
node server.js
# Open http://localhost:3000
```

## Deploy to Render

1. Push this folder to GitHub
2. Go to render.com → New Web Service
3. Connect your repo
4. Set:
   - **Build Command:** (leave blank)
   - **Start Command:** `node server.js`
5. Add these Environment Variables on Render:
   - `JWT_SECRET` → any long random string (e.g. `mygameifysecret123`)
   - `BASE_URL` → your Render URL (e.g. `https://gameify.onrender.com`)

## Enable Google Sign-In (optional)

1. Go to console.cloud.google.com
2. Create a project → Enable Google+ API
3. OAuth Credentials → Create OAuth 2.0 Client ID
4. Add authorized redirect URI: `https://your-app.onrender.com/auth/google/callback`
5. Add to Render environment variables:
   - `GOOGLE_CLIENT_ID` → your client ID
   - `GOOGLE_CLIENT_SECRET` → your client secret

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `JWT_SECRET` | Yes (in prod) | Secret key for signing tokens |
| `BASE_URL` | Yes (in prod) | Your full app URL |
| `GOOGLE_CLIENT_ID` | No | For Google sign-in |
| `GOOGLE_CLIENT_SECRET` | No | For Google sign-in |
| `PORT` | No | Defaults to 3000 |
