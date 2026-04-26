/**
 * GAMEIFY - Full Stack with Auth
 * Node.js built-ins only for local crypto/storage
 * Uses: http, fs, crypto, path
 * 
 * Auth: username/password + Google OAuth
 * Storage: users.json + per-user game data
 * Sessions: JWT-style signed tokens (HMAC-SHA256)
 */

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const https  = require('https');
const url    = require('url');

const PORT       = process.env.PORT || 3000;
const SECRET     = process.env.JWT_SECRET || 'gameify-secret-change-in-production';
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const BASE_URL   = process.env.BASE_URL || `http://localhost:${PORT}`;
const DATA_DIR   = path.join(__dirname, 'data');

// ── Ensure data directory exists ──────────────────────────────────────────────
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── Data helpers ──────────────────────────────────────────────────────────────
function readJSON(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

const USERS_FILE = path.join(DATA_DIR, 'users.json');
function getUsers()       { return readJSON(USERS_FILE, {}); }
function saveUsers(u)     { writeJSON(USERS_FILE, u); }

function getUserGamesFile(userId) { return path.join(DATA_DIR, `games_${userId}.json`); }
function getUserGames(userId)     { return readJSON(getUserGamesFile(userId), []); }
function saveUserGames(userId, g) { writeJSON(getUserGamesFile(userId), g); }

// ── Crypto helpers ────────────────────────────────────────────────────────────
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const check = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha256').toString('hex');
  return check === hash;
}
function makeUUID() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

// ── JWT-style tokens (HMAC-SHA256, no library needed) ─────────────────────────
function signToken(payload) {
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body    = Buffer.from(JSON.stringify({ ...payload, iat: Date.now(), exp: Date.now() + 7*24*60*60*1000 })).toString('base64url');
  const sig     = crypto.createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}
function verifyToken(token) {
  try {
    const [header, body, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url');
    if (sig !== expected) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function parseCookies(req) {
  const cookies = {};
  (req.headers.cookie || '').split(';').forEach(c => {
    const [k, ...v] = c.trim().split('=');
    if (k) cookies[k.trim()] = decodeURIComponent(v.join('='));
  });
  return cookies;
}
function getAuthUser(req) {
  const cookies = parseCookies(req);
  const token = cookies['gameify_token'] || (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return null;
  return verifyToken(token);
}
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}
function parseFormBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const params = {};
      body.split('&').forEach(p => { const [k,v] = p.split('='); if(k) params[decodeURIComponent(k)] = decodeURIComponent((v||'').replace(/\+/g,' ')); });
      resolve(params);
    });
    req.on('error', reject);
  });
}
function send(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', ...extraHeaders });
  res.end(body);
}
function sendHtml(res, html, status = 200, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...extraHeaders });
  res.end(html);
}
function redirect(res, location, extraHeaders = {}) {
  res.writeHead(302, { Location: location, ...extraHeaders });
  res.end();
}
function setCookieHeader(token) {
  return `gameify_token=${token}; HttpOnly; Path=/; Max-Age=${7*24*3600}; SameSite=Lax`;
}
function clearCookieHeader() {
  return `gameify_token=; HttpOnly; Path=/; Max-Age=0`;
}

// ── Google OAuth helpers ──────────────────────────────────────────────────────
function httpsGet(reqUrl) {
  return new Promise((resolve, reject) => {
    https.get(reqUrl, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
    }).on('error', reject);
  });
}
function httpsPost(hostname, path, postData) {
  return new Promise((resolve, reject) => {
    const body = typeof postData === 'string' ? postData : new url.URLSearchParams(postData).toString();
    const opts = { hostname, path, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Auth Routes ───────────────────────────────────────────────────────────────
async function handleAuth(req, res, pathname) {

  // POST /auth/register
  if (pathname === '/auth/register' && req.method === 'POST') {
    const { username, password, email } = await parseBody(req);
    if (!username || !password) return send(res, 400, { error: 'Username and password required' });
    if (password.length < 6) return send(res, 400, { error: 'Password must be at least 6 characters' });
    const users = getUsers();
    const usernameLower = username.toLowerCase().trim();
    if (Object.values(users).find(u => u.username.toLowerCase() === usernameLower)) {
      return send(res, 400, { error: 'Username already taken' });
    }
    const id = makeUUID();
    users[id] = { id, username: username.trim(), email: email || '', password: hashPassword(password), provider: 'local', createdAt: new Date().toISOString() };
    saveUsers(users);
    const token = signToken({ id, username: users[id].username });
    return send(res, 201, { token, user: { id, username: users[id].username } }, { 'Set-Cookie': setCookieHeader(token) });
  }

  // POST /auth/login
  if (pathname === '/auth/login' && req.method === 'POST') {
    const { username, password } = await parseBody(req);
    if (!username || !password) return send(res, 400, { error: 'Username and password required' });
    const users = getUsers();
    const user = Object.values(users).find(u => u.username.toLowerCase() === username.toLowerCase().trim() && u.provider === 'local');
    if (!user || !verifyPassword(password, user.password)) return send(res, 401, { error: 'Invalid username or password' });
    const token = signToken({ id: user.id, username: user.username });
    return send(res, 200, { token, user: { id: user.id, username: user.username } }, { 'Set-Cookie': setCookieHeader(token) });
  }

  // POST /auth/logout
  if (pathname === '/auth/logout' && req.method === 'POST') {
    return send(res, 200, { ok: true }, { 'Set-Cookie': clearCookieHeader() });
  }

  // GET /auth/me
  if (pathname === '/auth/me' && req.method === 'GET') {
    const user = getAuthUser(req);
    if (!user) return send(res, 401, { error: 'Not authenticated' });
    return send(res, 200, { id: user.id, username: user.username });
  }

  // GET /auth/google — redirect to Google
  if (pathname === '/auth/google' && req.method === 'GET') {
    if (!GOOGLE_CLIENT_ID) return send(res, 503, { error: 'Google OAuth not configured' });
    const params = new url.URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: `${BASE_URL}/auth/google/callback`,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'offline'
    });
    return redirect(res, `https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  }

  // GET /auth/google/callback
  if (pathname === '/auth/google/callback' && req.method === 'GET') {
    if (!GOOGLE_CLIENT_ID) return send(res, 503, { error: 'Google OAuth not configured' });
    const parsedUrl = new url.URL(req.url, BASE_URL);
    const code = parsedUrl.searchParams.get('code');
    if (!code) return redirect(res, '/?error=google_failed');
    try {
      // Exchange code for tokens
      const tokenData = await httpsPost('oauth2.googleapis.com', '/token', {
        code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: `${BASE_URL}/auth/google/callback`, grant_type: 'authorization_code'
      });
      if (!tokenData.access_token) return redirect(res, '/?error=google_failed');
      // Get user info
      const userInfo = await httpsGet(`https://www.googleapis.com/oauth2/v2/userinfo?access_token=${tokenData.access_token}`);
      if (!userInfo.id) return redirect(res, '/?error=google_failed');
      // Find or create user
      const users = getUsers();
      let user = Object.values(users).find(u => u.googleId === userInfo.id);
      if (!user) {
        const id = makeUUID();
        // Make username unique
        let baseUsername = (userInfo.name || userInfo.email.split('@')[0]).replace(/[^a-zA-Z0-9_]/g, '');
        let username = baseUsername;
        let counter = 1;
        while (Object.values(users).find(u => u.username.toLowerCase() === username.toLowerCase())) {
          username = `${baseUsername}${counter++}`;
        }
        user = { id, username, email: userInfo.email, googleId: userInfo.id, avatar: userInfo.picture, provider: 'google', createdAt: new Date().toISOString() };
        users[id] = user;
        saveUsers(users);
      }
      const token = signToken({ id: user.id, username: user.username });
      return redirect(res, '/', { 'Set-Cookie': setCookieHeader(token) });
    } catch (e) {
      console.error('Google OAuth error:', e);
      return redirect(res, '/?error=google_failed');
    }
  }

  return null; // not an auth route
}

// ── Games API ─────────────────────────────────────────────────────────────────
async function handleGamesAPI(req, res, pathname) {
  const user = getAuthUser(req);
  if (!user) return send(res, 401, { error: 'Please log in' });

  const idMatch = pathname.match(/^\/api\/games\/([^/]+)$/);
  const id = idMatch ? idMatch[1] : null;
  const method = req.method.toUpperCase();

  if (method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization' });
    return res.end();
  }

  if (method === 'GET' && !id) return send(res, 200, getUserGames(user.id));

  if (method === 'POST' && !id) {
    const { title, platform, status, rating, notes } = await parseBody(req);
    if (!title?.trim()) return send(res, 400, { error: 'Title is required' });
    const game = { id: makeUUID(), title: title.trim(), platform: platform || 'PC', status: status || 'Backlog', rating: rating || 0, notes: notes || '', addedAt: new Date().toISOString() };
    const games = getUserGames(user.id);
    games.push(game);
    saveUserGames(user.id, games);
    return send(res, 201, game);
  }

  if (method === 'PUT' && id) {
    const body = await parseBody(req);
    const games = getUserGames(user.id);
    const idx = games.findIndex(g => g.id === id);
    if (idx === -1) return send(res, 404, { error: 'Game not found' });
    games[idx] = { ...games[idx], ...body, id };
    saveUserGames(user.id, games);
    return send(res, 200, games[idx]);
  }

  if (method === 'DELETE' && id) {
    let games = getUserGames(user.id);
    const idx = games.findIndex(g => g.id === id);
    if (idx === -1) return send(res, 404, { error: 'Game not found' });
    const [removed] = games.splice(idx, 1);
    saveUserGames(user.id, games);
    return send(res, 200, removed);
  }

  return send(res, 405, { error: 'Method not allowed' });
}

// ── Frontend HTML ─────────────────────────────────────────────────────────────
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Gameify</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0c0c10;--surface:#13131a;--surface2:#1b1b26;--border:rgba(255,255,255,0.07);
  --accent:#e8ff47;--accent2:#ff5c5c;--accent3:#5cffa1;
  --text:#e8e8f0;--muted:#6b6b82;
  --font-head:'Segoe UI',sans-serif;--radius:10px;--transition:0.22s cubic-bezier(.4,0,.2,1);
}
html{font-size:16px}
body{background:var(--bg);color:var(--text);font-family:'Segoe UI',sans-serif;min-height:100vh;overflow-x:hidden}
.app{max-width:1100px;margin:0 auto;padding:0 24px 80px}

/* Auth Pages */
.auth-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
.auth-card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:40px;width:100%;max-width:420px}
.auth-logo{font-size:2.8rem;font-weight:900;letter-spacing:3px;color:var(--accent);text-align:center;margin-bottom:6px;text-shadow:0 0 40px rgba(232,255,71,0.3)}
.auth-sub{text-align:center;color:var(--muted);font-size:0.85rem;margin-bottom:32px;letter-spacing:1px;text-transform:uppercase}
.auth-tabs{display:flex;gap:0;margin-bottom:28px;background:var(--surface2);border-radius:8px;padding:4px}
.auth-tab{flex:1;padding:9px;border:none;background:transparent;color:var(--muted);font-size:0.88rem;font-weight:600;cursor:pointer;border-radius:6px;transition:all var(--transition)}
.auth-tab.active{background:var(--accent);color:#0c0c10}
.field{display:flex;flex-direction:column;gap:6px;margin-bottom:16px}
.field label{font-size:0.72rem;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted)}
.field input{background:var(--surface2);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:0.92rem;padding:11px 14px;outline:none;transition:border-color var(--transition),box-shadow var(--transition);font-family:inherit}
.field input:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(232,255,71,0.12)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:11px 20px;border-radius:8px;border:none;cursor:pointer;font-family:inherit;font-size:0.9rem;font-weight:600;transition:all var(--transition);white-space:nowrap;width:100%}
.btn-primary{background:var(--accent);color:#0c0c10}
.btn-primary:hover{background:#f5ff80;transform:translateY(-1px);box-shadow:0 6px 20px rgba(232,255,71,0.3)}
.btn-primary:disabled{opacity:0.5;cursor:not-allowed;transform:none}
.btn-google{background:var(--surface2);color:var(--text);border:1px solid var(--border);margin-bottom:16px}
.btn-google:hover{border-color:var(--muted)}
.btn-ghost{background:transparent;color:var(--muted);border:1px solid var(--border)}
.btn-ghost:hover{color:var(--text);border-color:var(--muted)}
.btn-danger{background:rgba(255,92,92,0.12);color:var(--accent2);border:1px solid rgba(255,92,92,0.2)}
.btn-danger:hover{background:rgba(255,92,92,0.22)}
.btn-sm{padding:6px 12px;font-size:0.78rem;width:auto}
.divider{display:flex;align-items:center;gap:12px;margin:16px 0;color:var(--muted);font-size:0.78rem}
.divider::before,.divider::after{content:'';flex:1;height:1px;background:var(--border)}
.auth-error{background:rgba(255,92,92,0.1);border:1px solid rgba(255,92,92,0.3);color:var(--accent2);padding:10px 14px;border-radius:8px;font-size:0.85rem;margin-bottom:16px;display:none}
.auth-error.show{display:block}

/* Header */
header{display:flex;align-items:center;justify-content:space-between;padding:36px 0 28px;border-bottom:1px solid var(--border);margin-bottom:40px}
.logo h1{font-size:clamp(2.4rem,5vw,3.8rem);font-weight:900;letter-spacing:3px;color:var(--accent);line-height:1;text-shadow:0 0 40px rgba(232,255,71,0.3)}
.logo .tagline{font-size:0.72rem;font-weight:500;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-top:2px}
.header-right{display:flex;align-items:center;gap:16px}
.user-pill{display:flex;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--border);border-radius:99px;padding:7px 14px;font-size:0.82rem;color:var(--muted)}
.user-pill span{color:var(--text);font-weight:600}
.stats-bar{display:flex;gap:24px}
.stat{text-align:center}
.stat .num{font-size:1.8rem;font-weight:900;letter-spacing:1px;line-height:1;color:var(--text)}
.stat .lbl{font-size:0.66rem;font-weight:500;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);margin-top:3px}

/* Panel */
.panel{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:28px;margin-bottom:28px}
.panel-title{font-size:0.78rem;font-weight:700;letter-spacing:2px;color:var(--muted);text-transform:uppercase;margin-bottom:20px}

/* Form */
.form-grid{display:grid;grid-template-columns:2fr 1fr 1fr auto auto;gap:12px;align-items:end}
@media(max-width:750px){.form-grid{grid-template-columns:1fr 1fr}.form-grid .field:first-child{grid-column:1/-1}}
.field select{background:var(--surface2);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:0.92rem;padding:11px 32px 11px 14px;outline:none;appearance:none;cursor:pointer;font-family:inherit;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%236b6b82' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;transition:border-color var(--transition)}
.field select:focus{border-color:var(--accent)}

/* Stars */
.rating-input{display:flex;gap:4px}
.star{font-size:1.3rem;cursor:pointer;transition:transform 0.1s;color:var(--muted)}
.star.filled{color:var(--accent)}
.star:hover{transform:scale(1.25)}

/* Filters */
.filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px}
.filter-btn{padding:6px 16px;border-radius:99px;font-size:0.8rem;font-weight:500;letter-spacing:0.5px;border:1px solid var(--border);background:transparent;color:var(--muted);cursor:pointer;transition:all var(--transition)}
.filter-btn:hover{color:var(--text);border-color:var(--muted)}
.filter-btn.active{background:var(--accent);color:#0c0c10;border-color:var(--accent);font-weight:700}
.search-wrap{position:relative;flex:1;margin-bottom:20px}
.search-wrap input{width:100%;padding:11px 14px 11px 38px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:0.92rem;outline:none;font-family:inherit;transition:border-color var(--transition)}
.search-wrap input:focus{border-color:var(--accent)}
.search-icon{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--muted);pointer-events:none}

/* Game Grid */
.game-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
.game-card{background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);padding:20px;display:flex;flex-direction:column;gap:14px;transition:transform var(--transition),border-color var(--transition),box-shadow var(--transition);animation:cardIn 0.35s ease both}
@keyframes cardIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
.game-card:hover{transform:translateY(-3px);border-color:rgba(255,255,255,0.14);box-shadow:0 12px 32px rgba(0,0,0,0.4)}
.card-top{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
.game-title{font-size:1.2rem;font-weight:800;letter-spacing:0.5px;line-height:1.2;color:var(--text);flex:1}
.platform-badge{font-size:0.65rem;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:4px 8px;border-radius:5px;white-space:nowrap;flex-shrink:0;background:rgba(255,255,255,0.06);color:var(--muted);border:1px solid var(--border)}
.status-pill{display:inline-flex;align-items:center;gap:6px;font-size:0.72rem;font-weight:600;letter-spacing:1px;text-transform:uppercase;padding:5px 10px;border-radius:99px}
.status-pill::before{content:'';width:6px;height:6px;border-radius:50%;flex-shrink:0}
.status-Backlog{background:rgba(255,183,74,0.12);color:#ffb74a;border:1px solid rgba(255,183,74,0.2)}
.status-Backlog::before{background:#ffb74a}
.status-Playing{background:rgba(92,255,161,0.12);color:var(--accent3);border:1px solid rgba(92,255,161,0.2)}
.status-Playing::before{background:var(--accent3);box-shadow:0 0 6px var(--accent3);animation:pulse 1.6s infinite}
.status-Completed{background:rgba(99,128,255,0.12);color:#9db4ff;border:1px solid rgba(99,128,255,0.2)}
.status-Completed::before{background:#9db4ff}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.stars{display:flex;gap:3px}
.stars .star{font-size:0.9rem;cursor:default}
.card-notes{font-size:0.82rem;color:var(--muted);line-height:1.5;border-top:1px solid var(--border);padding-top:10px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:auto}

/* Empty */
.empty-state{grid-column:1/-1;text-align:center;padding:64px 24px;color:var(--muted)}
.empty-state .big{font-size:4rem;font-weight:900;letter-spacing:3px;color:rgba(255,255,255,0.05);margin-bottom:12px}

/* Modal */
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;z-index:100;opacity:0;pointer-events:none;transition:opacity 0.25s}
.modal-overlay.open{opacity:1;pointer-events:all}
.modal{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:32px;width:100%;max-width:480px;transform:scale(0.95);transition:transform 0.25s cubic-bezier(.4,0,.2,1)}
.modal-overlay.open .modal{transform:scale(1)}
.modal h2{font-size:1.4rem;font-weight:800;letter-spacing:1px;margin-bottom:24px;color:var(--accent)}
.modal-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:24px}
.modal-actions .btn{width:auto}
.form-stack{display:flex;flex-direction:column;gap:14px}
.field textarea{background:var(--surface2);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:0.92rem;padding:11px 14px;outline:none;resize:vertical;min-height:80px;font-family:inherit;transition:border-color var(--transition)}
.field textarea:focus{border-color:var(--accent)}

/* Toast */
#toast{position:fixed;bottom:28px;right:28px;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:13px 20px;border-radius:var(--radius);font-size:0.88rem;font-weight:500;box-shadow:0 8px 32px rgba(0,0,0,0.5);transform:translateY(20px);opacity:0;transition:all 0.3s;pointer-events:none;z-index:999;max-width:320px}
#toast.show{transform:translateY(0);opacity:1}
#toast.success{border-left:3px solid var(--accent3)}
#toast.error{border-left:3px solid var(--accent2)}

/* Loader */
.loader{display:flex;justify-content:center;padding:48px}
.spinner{width:32px;height:32px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin 0.7s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
</style>
</head>
<body>

<!-- ── AUTH PAGE ── -->
<div id="auth-page" style="display:none">
  <div class="auth-wrap">
    <div class="auth-card">
      <div class="auth-logo">GAMEIFY</div>
      <div class="auth-sub">Track your journey</div>

      ${GOOGLE_CLIENT_ID ? `
      <button class="btn btn-google" onclick="googleLogin()">
        <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
        Continue with Google
      </button>
      <div class="divider">or</div>
      ` : ''}

      <div class="auth-tabs">
        <button class="auth-tab active" onclick="switchTab('login')">Sign In</button>
        <button class="auth-tab" onclick="switchTab('register')">Register</button>
      </div>

      <div id="auth-error" class="auth-error"></div>

      <!-- Login Form -->
      <div id="login-form">
        <div class="field"><label>Username</label><input id="l-username" type="text" placeholder="Your username" autocomplete="username"></div>
        <div class="field"><label>Password</label><input id="l-password" type="password" placeholder="Your password" autocomplete="current-password"></div>
        <button class="btn btn-primary" id="btn-login" onclick="login()">Sign In</button>
      </div>

      <!-- Register Form -->
      <div id="register-form" style="display:none">
        <div class="field"><label>Username</label><input id="r-username" type="text" placeholder="Choose a username" autocomplete="username"></div>
        <div class="field"><label>Email (optional)</label><input id="r-email" type="email" placeholder="you@email.com" autocomplete="email"></div>
        <div class="field"><label>Password</label><input id="r-password" type="password" placeholder="At least 6 characters" autocomplete="new-password"></div>
        <button class="btn btn-primary" id="btn-register" onclick="register()">Create Account</button>
      </div>
    </div>
  </div>
</div>

<!-- ── MAIN APP ── -->
<div id="main-app" style="display:none">
  <div class="app">
    <header>
      <div class="logo">
        <h1>GAMEIFY</h1>
        <div class="tagline">Track your journey</div>
      </div>
      <div class="header-right">
        <div class="stats-bar">
          <div class="stat"><div class="num" id="stat-total">0</div><div class="lbl">Total</div></div>
          <div class="stat"><div class="num" id="stat-playing">0</div><div class="lbl">Playing</div></div>
          <div class="stat"><div class="num" id="stat-backlog">0</div><div class="lbl">Backlog</div></div>
          <div class="stat"><div class="num" id="stat-done">0</div><div class="lbl">Done</div></div>
        </div>
        <div class="user-pill">👾 <span id="user-display"></span></div>
        <button class="btn btn-ghost btn-sm" style="width:auto" onclick="logout()">Sign Out</button>
      </div>
    </header>

    <!-- Add Game -->
    <div class="panel">
      <div class="panel-title">Add Game</div>
      <div class="form-grid">
        <div class="field">
          <label>Title</label>
          <input id="f-title" type="text" placeholder="e.g. Elden Ring" autocomplete="off">
        </div>
        <div class="field">
          <label>Platform</label>
          <select id="f-platform">
            <option value="PC">PC</option>
            <option value="PlayStation">PlayStation</option>
            <option value="Xbox">Xbox</option>
            <option value="Switch">Switch</option>
            <option value="Mobile">Mobile</option>
          </select>
        </div>
        <div class="field">
          <label>Status</label>
          <select id="f-status">
            <option value="Backlog">Backlog</option>
            <option value="Playing">Currently Playing</option>
            <option value="Completed">Completed</option>
          </select>
        </div>
        <div class="field">
          <label>Rating</label>
          <div class="rating-input" id="f-rating-stars">
            <span class="star" data-v="1">★</span><span class="star" data-v="2">★</span>
            <span class="star" data-v="3">★</span><span class="star" data-v="4">★</span>
            <span class="star" data-v="5">★</span>
          </div>
        </div>
        <div class="field" style="align-self:end">
          <button class="btn btn-primary" id="btn-add" style="width:auto" onclick="addGame()">+ Add</button>
        </div>
      </div>
    </div>

    <!-- Library -->
    <div class="panel">
      <div class="panel-title">My Library</div>
      <div class="search-wrap">
        <svg class="search-icon" width="15" height="15" viewBox="0 0 20 20" fill="none"><circle cx="9" cy="9" r="6" stroke="currentColor" stroke-width="1.8"/><path d="m14.5 14.5 3.5 3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        <input type="text" id="search" placeholder="Search games…" oninput="onSearch(this.value)">
      </div>
      <div class="filters" id="filters">
        <button class="filter-btn active" data-filter="All" onclick="setFilter('All',this)">All</button>
        <button class="filter-btn" data-filter="Backlog" onclick="setFilter('Backlog',this)">Backlog</button>
        <button class="filter-btn" data-filter="Playing" onclick="setFilter('Playing',this)">Playing</button>
        <button class="filter-btn" data-filter="Completed" onclick="setFilter('Completed',this)">Completed</button>
      </div>
      <div class="game-grid" id="game-grid">
        <div class="loader"><div class="spinner"></div></div>
      </div>
    </div>
  </div>
</div>

<!-- Edit Modal -->
<div class="modal-overlay" id="modal">
  <div class="modal">
    <h2>Edit Game</h2>
    <div class="form-stack">
      <input type="hidden" id="e-id">
      <div class="field"><label>Title</label><input id="e-title" type="text"></div>
      <div class="field"><label>Platform</label>
        <select id="e-platform">
          <option value="PC">PC</option><option value="PlayStation">PlayStation</option>
          <option value="Xbox">Xbox</option><option value="Switch">Switch</option><option value="Mobile">Mobile</option>
        </select>
      </div>
      <div class="field"><label>Status</label>
        <select id="e-status">
          <option value="Backlog">Backlog</option>
          <option value="Playing">Currently Playing</option>
          <option value="Completed">Completed</option>
        </select>
      </div>
      <div class="field"><label>Rating</label>
        <div class="rating-input" id="e-rating-stars">
          <span class="star" data-v="1">★</span><span class="star" data-v="2">★</span>
          <span class="star" data-v="3">★</span><span class="star" data-v="4">★</span>
          <span class="star" data-v="5">★</span>
        </div>
      </div>
      <div class="field"><label>Notes</label><textarea id="e-notes" rows="3" placeholder="Any thoughts…"></textarea></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveEdit()">Save Changes</button>
    </div>
  </div>
</div>

<div id="toast"></div>

<script>
// ── State ──────────────────────────────────────────────────────────────────
let games = [], filter = 'All', search = '', addRating = 0, editRating = 0;
let currentUser = null;

// ── Boot ───────────────────────────────────────────────────────────────────
async function boot() {
  // Check URL for google error
  if (location.search.includes('error=google_failed')) {
    showAuthError('Google sign-in failed. Please try again.');
    history.replaceState({}, '', '/');
  }
  try {
    const r = await fetch('/auth/me');
    if (r.ok) {
      currentUser = await r.json();
      showApp();
    } else {
      showAuth();
    }
  } catch { showAuth(); }
}

function showAuth() {
  document.getElementById('auth-page').style.display = 'block';
  document.getElementById('main-app').style.display = 'none';
}
function showApp() {
  document.getElementById('auth-page').style.display = 'none';
  document.getElementById('main-app').style.display = 'block';
  document.getElementById('user-display').textContent = currentUser.username;
  loadGames();
  initStars('f-rating-stars', v => { addRating = v; });
  initStars('e-rating-stars', v => { editRating = v; });
}

// ── Auth ───────────────────────────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.auth-tab').forEach((t,i) => t.classList.toggle('active', (i===0&&tab==='login')||(i===1&&tab==='register')));
  document.getElementById('login-form').style.display = tab === 'login' ? 'block' : 'none';
  document.getElementById('register-form').style.display = tab === 'register' ? 'block' : 'none';
  hideAuthError();
}
function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg; el.classList.add('show');
}
function hideAuthError() {
  document.getElementById('auth-error').classList.remove('show');
}
function googleLogin() { location.href = '/auth/google'; }

async function login() {
  const username = document.getElementById('l-username').value.trim();
  const password = document.getElementById('l-password').value;
  if (!username || !password) return showAuthError('Please fill in all fields.');
  const btn = document.getElementById('btn-login');
  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    const r = await fetch('/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username,password}) });
    const data = await r.json();
    if (!r.ok) { showAuthError(data.error); return; }
    currentUser = data.user;
    showApp();
  } catch { showAuthError('Something went wrong. Try again.'); }
  finally { btn.disabled = false; btn.textContent = 'Sign In'; }
}

async function register() {
  const username = document.getElementById('r-username').value.trim();
  const email    = document.getElementById('r-email').value.trim();
  const password = document.getElementById('r-password').value;
  if (!username || !password) return showAuthError('Username and password are required.');
  const btn = document.getElementById('btn-register');
  btn.disabled = true; btn.textContent = 'Creating account…';
  try {
    const r = await fetch('/auth/register', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username,email,password}) });
    const data = await r.json();
    if (!r.ok) { showAuthError(data.error); return; }
    currentUser = data.user;
    showApp();
  } catch { showAuthError('Something went wrong. Try again.'); }
  finally { btn.disabled = false; btn.textContent = 'Create Account'; }
}

async function logout() {
  await fetch('/auth/logout', { method: 'POST' });
  currentUser = null;
  games = [];
  showAuth();
}

// ── Enter key support ──────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  if (document.getElementById('login-form').style.display !== 'none' &&
      document.getElementById('auth-page').style.display !== 'none') login();
  else if (document.getElementById('register-form').style.display !== 'none' &&
           document.getElementById('auth-page').style.display !== 'none') register();
});

// ── Games ──────────────────────────────────────────────────────────────────
async function loadGames() {
  try {
    const r = await fetch('/api/games');
    if (r.status === 401) { showAuth(); return; }
    games = await r.json();
    render();
  } catch(e) {
    document.getElementById('game-grid').innerHTML = '<div class="empty-state"><div class="big">ERROR</div><p>' + e.message + '</p></div>';
  }
}

function render() {
  const grid = document.getElementById('game-grid');
  const q = search.toLowerCase();
  const filtered = games.filter(g => {
    const mf = filter === 'All' || g.status === filter;
    const ms = !q || g.title.toLowerCase().includes(q) || (g.platform||'').toLowerCase().includes(q);
    return mf && ms;
  });
  document.getElementById('stat-total').textContent   = games.length;
  document.getElementById('stat-playing').textContent = games.filter(g=>g.status==='Playing').length;
  document.getElementById('stat-backlog').textContent = games.filter(g=>g.status==='Backlog').length;
  document.getElementById('stat-done').textContent    = games.filter(g=>g.status==='Completed').length;
  if (!filtered.length) {
    grid.innerHTML = '<div class="empty-state"><div class="big">EMPTY</div><p>' + (games.length ? 'No games match your filter.' : 'No games yet — add your first one!') + '</p></div>';
    return;
  }
  grid.innerHTML = filtered.map(g => {
    const stars = [1,2,3,4,5].map(i => '<span class="star' + (i<=(g.rating||0)?' filled':'') + '">★</span>').join('');
    const notes = g.notes ? '<div class="card-notes">' + esc(g.notes) + '</div>' : '';
    return \`<div class="game-card">
      <div class="card-top"><div class="game-title">\${esc(g.title)}</div><span class="platform-badge">\${esc(g.platform)}</span></div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
        <span class="status-pill status-\${g.status}">\${g.status}</span>
        <div class="stars">\${stars}</div>
      </div>
      \${notes}
      <div class="card-actions">
        <button class="btn btn-ghost btn-sm" onclick="openEdit('\${g.id}')">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteGame('\${g.id}')">Delete</button>
      </div>
    </div>\`;
  }).join('');
}

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

async function addGame() {
  const title = document.getElementById('f-title').value.trim();
  const platform = document.getElementById('f-platform').value;
  const status = document.getElementById('f-status').value;
  if (!title) { toast('Please enter a game title.', 'error'); return; }
  const btn = document.getElementById('btn-add');
  btn.disabled = true;
  try {
    const r = await fetch('/api/games', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({title,platform,status,rating:addRating}) });
    if (r.status === 401) { showAuth(); return; }
    const game = await r.json();
    games.push(game);
    render();
    document.getElementById('f-title').value = '';
    addRating = 0; renderStars('f-rating-stars', 0);
    toast('Game added!');
  } catch(e) { toast(e.message,'error'); }
  finally { btn.disabled = false; }
}

async function deleteGame(id) {
  if (!confirm('Remove this game?')) return;
  try {
    await fetch('/api/games/' + id, { method:'DELETE' });
    games = games.filter(g => g.id !== id);
    render(); toast('Game removed.');
  } catch(e) { toast(e.message,'error'); }
}

function openEdit(id) {
  const g = games.find(x => x.id === id);
  if (!g) return;
  document.getElementById('e-id').value = g.id;
  document.getElementById('e-title').value = g.title;
  document.getElementById('e-platform').value = g.platform;
  document.getElementById('e-status').value = g.status;
  document.getElementById('e-notes').value = g.notes || '';
  editRating = g.rating || 0;
  renderStars('e-rating-stars', editRating);
  document.getElementById('modal').classList.add('open');
}
function closeModal() { document.getElementById('modal').classList.remove('open'); }
document.getElementById('modal').addEventListener('click', e => { if(e.target===e.currentTarget) closeModal(); });

async function saveEdit() {
  const id = document.getElementById('e-id').value;
  const title = document.getElementById('e-title').value.trim();
  const platform = document.getElementById('e-platform').value;
  const status = document.getElementById('e-status').value;
  const notes = document.getElementById('e-notes').value.trim();
  if (!title) { toast('Title is required.','error'); return; }
  try {
    const r = await fetch('/api/games/'+id, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({title,platform,status,rating:editRating,notes}) });
    const updated = await r.json();
    games = games.map(g => g.id===id ? updated : g);
    render(); closeModal(); toast('Game updated!');
  } catch(e) { toast(e.message,'error'); }
}

function setFilter(f, btn) {
  filter = f;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  render();
}
function onSearch(v) { search = v; render(); }

document.getElementById('f-title').addEventListener('keydown', e => { if(e.key==='Enter') addGame(); });

// ── Stars ──────────────────────────────────────────────────────────────────
function initStars(cid, onSet) {
  document.getElementById(cid).querySelectorAll('.star').forEach(s => {
    s.addEventListener('click', () => { const v=+s.dataset.v; onSet(v); renderStars(cid,v); });
    s.addEventListener('mouseenter', () => renderStars(cid,+s.dataset.v,true));
    s.addEventListener('mouseleave', () => renderStars(cid, cid==='f-rating-stars'?addRating:editRating));
  });
}
function renderStars(cid, value) {
  document.getElementById(cid).querySelectorAll('.star').forEach(s => s.classList.toggle('filled',+s.dataset.v<=value));
}

// ── Toast ──────────────────────────────────────────────────────────────────
function toast(msg, type='success') {
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = 'show '+type;
  clearTimeout(el._t); el._t = setTimeout(()=>{ el.className=''; }, 2800);
}

boot();
</script>
</body>
</html>`;

// ── Server ────────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const parsedUrl = new url.URL(req.url, `http://localhost`);
  const pathname  = parsedUrl.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization' });
    return res.end();
  }

  try {
    // Auth routes
    if (pathname.startsWith('/auth/')) {
      const handled = await handleAuth(req, res, pathname);
      if (handled !== null) return;
    }

    // Games API
    if (pathname.startsWith('/api/games')) {
      return await handleGamesAPI(req, res, pathname);
    }

    // Frontend
    return sendHtml(res, HTML);

  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'Internal server error' });
  }
});

server.listen(PORT, () => {
  console.log(`\n  🎮  GAMEIFY running at http://localhost:${PORT}`);
  console.log(`  👤  Auth: username/password ${GOOGLE_CLIENT_ID ? '+ Google OAuth' : '(Google OAuth: set GOOGLE_CLIENT_ID env var)'}\n`);
});
