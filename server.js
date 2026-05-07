/**
 * server.js
 * Main entry point.
 * - Serves static files from /public
 * - Auth routes: /auth/register, /auth/login, /auth/logout, /auth/me
 * - Games API: /api/games (CRUD, stored as JSON per user)
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { URL } = require('url');

const db   = require('./database');
const auth = require('./auth');

const PORT       = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR   = path.join(__dirname, 'data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// ── MIME types ─────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
};

// ── Helpers ────────────────────────────────────────────────────────────────
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end',  () => { try { resolve(JSON.parse(body || '{}')); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}

function json(res, status, data, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...extraHeaders });
  res.end(JSON.stringify(data));
}

function serveStatic(res, pathname) {
  const filePath = (pathname === '/' || !path.extname(pathname))
    ? path.join(PUBLIC_DIR, 'index.html')
    : path.join(PUBLIC_DIR, pathname);

  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e, html) => {
        if (e) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'text/plain' });
    res.end(data);
  });
}

// ── Games JSON helpers ─────────────────────────────────────────────────────
function gamesFile(userId)   { return path.join(DATA_DIR, `games_${userId}.json`); }
function readGames(userId)   { try { return JSON.parse(fs.readFileSync(gamesFile(userId), 'utf8')); } catch { return []; } }
function writeGames(userId, games) { fs.writeFileSync(gamesFile(userId), JSON.stringify(games, null, 2)); }

// ── Server ─────────────────────────────────────────────────────────────────
http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  const method = req.method.toUpperCase();

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  try {

    // ── POST /auth/register ──────────────────────────────────────────────
    if (pathname === '/auth/register' && method === 'POST') {
      const { username, password } = await parseBody(req);
      if (!username || !password)      return json(res, 400, { error: 'Username and password required' });
      if (username.length < 3)         return json(res, 400, { error: 'Username must be at least 3 characters' });
      if (password.length < 6)         return json(res, 400, { error: 'Password must be at least 6 characters' });
      if (db.getUserByUsername(username)) return json(res, 400, { error: 'Username already taken' });

      const user  = db.createUser(auth.makeUUID(), username.trim(), auth.hashPassword(password));
      const token = auth.signToken({ id: user.id, username: user.username });
      return json(res, 201, { user: { id: user.id, username: user.username } }, { 'Set-Cookie': auth.setCookie(token) });
    }

    // ── POST /auth/login ─────────────────────────────────────────────────
    if (pathname === '/auth/login' && method === 'POST') {
      const { username, password } = await parseBody(req);
      if (!username || !password) return json(res, 400, { error: 'Username and password required' });

      const user = db.getUserByUsername(username);
      if (!user || !auth.verifyPassword(password, user.password))
        return json(res, 401, { error: 'Invalid username or password' });

      const token = auth.signToken({ id: user.id, username: user.username });
      return json(res, 200, { user: { id: user.id, username: user.username } }, { 'Set-Cookie': auth.setCookie(token) });
    }

    // ── POST /auth/logout ────────────────────────────────────────────────
    if (pathname === '/auth/logout' && method === 'POST') {
      return json(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie() });
    }

    // ── GET /auth/me ─────────────────────────────────────────────────────
    if (pathname === '/auth/me' && method === 'GET') {
      const payload = auth.getAuthUser(req);
      if (!payload) return json(res, 401, { error: 'Not logged in' });
      const user = db.getUserById(payload.id);
      if (!user)    return json(res, 401, { error: 'User not found' });
      return json(res, 200, { id: user.id, username: user.username });
    }

    // ── Games API (/api/games) ───────────────────────────────────────────
    if (pathname.startsWith('/api/games')) {
      const user = auth.getAuthUser(req);
      if (!user) return json(res, 401, { error: 'Please log in' });

      const idMatch = pathname.match(/^\/api\/games\/([^/]+)$/);
      const id      = idMatch ? idMatch[1] : null;

      // GET all games
      if (method === 'GET' && !id) {
        return json(res, 200, readGames(user.id));
      }

      // POST - add game
      if (method === 'POST' && !id) {
        const { title, platform, status, rating, notes } = await parseBody(req);
        if (!title?.trim()) return json(res, 400, { error: 'Title is required' });
        const game = { id: auth.makeUUID(), title: title.trim(), platform: platform || 'PC', status: status || 'Backlog', rating: rating || 0, notes: notes || '', addedAt: new Date().toISOString() };
        const games = readGames(user.id);
        games.unshift(game);
        writeGames(user.id, games);
        return json(res, 201, game);
      }

      // PUT - update game
      if (method === 'PUT' && id) {
        const body  = await parseBody(req);
        const games = readGames(user.id);
        const idx   = games.findIndex(g => g.id === id);
        if (idx === -1) return json(res, 404, { error: 'Game not found' });
        games[idx] = { ...games[idx], ...body, id, updatedAt: new Date().toISOString() };
        writeGames(user.id, games);
        return json(res, 200, games[idx]);
      }

      // DELETE - remove game
      if (method === 'DELETE' && id) {
        const games = readGames(user.id);
        const idx   = games.findIndex(g => g.id === id);
        if (idx === -1) return json(res, 404, { error: 'Game not found' });
        const [removed] = games.splice(idx, 1);
        writeGames(user.id, games);
        return json(res, 200, removed);
      }

      return json(res, 405, { error: 'Method not allowed' });
    }

    // ── Static files ─────────────────────────────────────────────────────
    serveStatic(res, pathname);

  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: 'Server error' });
  }

}).listen(PORT, () => {
  console.log(`\n  🎮  GAMEIFY  →  http://localhost:${PORT}`);
  console.log(`  🗄️   Users    →  SQLite (users.db)`);
  console.log(`  📁  Games    →  /data/games_<userId>.json\n`);
});
