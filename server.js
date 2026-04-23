  /**
 * GAMEIFY - Node.js Backend (zero dependencies)
 * Uses built-in: http, fs, path, crypto
 * Data is persisted to games.json
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT      = 3000;
const DATA_FILE = path.join(__dirname, 'games.json');

// ── Helpers ──────────────────────────────────────────────────────────────────

function readGames() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeGames(games) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(games, null, 2));
}

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(body);
}

function sendHtml(res, html) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

// ── API Routes ────────────────────────────────────────────────────────────────
// GET    /api/games          → list all games
// POST   /api/games          → create a game
// PUT    /api/games/:id      → update a game
// DELETE /api/games/:id      → delete a game

function handleAPI(req, res) {
  const urlParts = req.url.split('?')[0].split('/').filter(Boolean);
  // urlParts: ['api', 'games'] or ['api', 'games', ':id']
  const id = urlParts[2] || null;
  const method = req.method.toUpperCase();

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  // GET /api/games
  if (method === 'GET' && !id) {
    return send(res, 200, readGames());
  }

  // POST /api/games
  if (method === 'POST' && !id) {
    parseBody(req).then(body => {
      const { title, platform, status, rating, notes } = body;
      if (!title || !title.trim()) return send(res, 400, { error: 'Title is required' });
      const game = {
        id: uuid(),
        title: title.trim(),
        platform: platform || 'PC',
        status: status || 'Backlog',
        rating: rating || 0,
        notes: notes || '',
        addedAt: new Date().toISOString()
      };
      const games = readGames();
      games.push(game);
      writeGames(games);
      return send(res, 201, game);
    }).catch(() => send(res, 400, { error: 'Bad request' }));
    return;
  }

  // PUT /api/games/:id
  if (method === 'PUT' && id) {
    parseBody(req).then(body => {
      const games = readGames();
      const idx = games.findIndex(g => g.id === id);
      if (idx === -1) return send(res, 404, { error: 'Game not found' });
      games[idx] = { ...games[idx], ...body, id }; // id is immutable
      writeGames(games);
      return send(res, 200, games[idx]);
    }).catch(() => send(res, 400, { error: 'Bad request' }));
    return;
  }

  // DELETE /api/games/:id
  if (method === 'DELETE' && id) {
    const games = readGames();
    const idx = games.findIndex(g => g.id === id);
    if (idx === -1) return send(res, 404, { error: 'Game not found' });
    const [removed] = games.splice(idx, 1);
    writeGames(games);
    return send(res, 200, removed);
  }

  return send(res, 405, { error: 'Method not allowed' });
}

// ── Frontend HTML (served at /) ───────────────────────────────────────────────

const HTML = /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Gameify</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
  /* ── Reset & Variables ── */
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:        #0c0c10;
    --surface:   #13131a;
    --surface2:  #1b1b26;
    --border:    rgba(255,255,255,0.07);
    --accent:    #e8ff47;
    --accent2:   #ff5c5c;
    --accent3:   #5cffa1;
    --text:      #e8e8f0;
    --muted:     #6b6b82;
    --font-head: 'Bebas Neue', sans-serif;
    --font-body: 'DM Sans', sans-serif;
    --radius:    10px;
    --transition: 0.22s cubic-bezier(.4,0,.2,1);
  }

  html { font-size: 16px; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-body);
    font-weight: 400;
    min-height: 100vh;
    overflow-x: hidden;
  }

  /* ── Background noise texture ── */
  body::before {
    content: '';
    position: fixed; inset: 0;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E");
    pointer-events: none; z-index: 0;
  }

  /* ── Layout ── */
  .app { position: relative; z-index: 1; max-width: 1100px; margin: 0 auto; padding: 0 24px 80px; }

  /* ── Header ── */
  header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 36px 0 28px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 40px;
  }
  .logo {
    display: flex; align-items: baseline; gap: 10px;
  }
  .logo h1 {
    font-family: var(--font-head);
    font-size: clamp(2.8rem, 5vw, 4.2rem);
    letter-spacing: 3px;
    color: var(--accent);
    line-height: 1;
    text-shadow: 0 0 40px rgba(232,255,71,0.3);
  }
  .logo .tagline {
    font-size: 0.78rem; font-weight: 500; letter-spacing: 2px;
    text-transform: uppercase; color: var(--muted);
    padding-bottom: 4px;
  }
  .stats-bar {
    display: flex; gap: 24px;
  }
  .stat {
    text-align: center;
  }
  .stat .num {
    font-family: var(--font-head);
    font-size: 1.9rem; letter-spacing: 1px; line-height: 1;
    color: var(--text);
  }
  .stat .lbl {
    font-size: 0.68rem; font-weight: 500; letter-spacing: 1.5px;
    text-transform: uppercase; color: var(--muted);
    margin-top: 3px;
  }

  /* ── Panel / Card ── */
  .panel {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 28px;
    margin-bottom: 28px;
  }
  .panel-title {
    font-family: var(--font-head);
    font-size: 1.1rem; letter-spacing: 2px;
    color: var(--muted);
    text-transform: uppercase;
    margin-bottom: 20px;
  }

  /* ── Add-Game Form ── */
  .form-grid {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr auto auto;
    gap: 12px;
    align-items: end;
  }
  @media (max-width: 750px) {
    .form-grid { grid-template-columns: 1fr 1fr; }
    .form-grid .field:first-child { grid-column: 1 / -1; }
  }
  .field { display: flex; flex-direction: column; gap: 6px; }
  .field label {
    font-size: 0.7rem; font-weight: 600; letter-spacing: 1.5px;
    text-transform: uppercase; color: var(--muted);
  }
  .field input, .field select, .field textarea {
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    font-family: var(--font-body);
    font-size: 0.92rem;
    padding: 10px 14px;
    outline: none;
    transition: border-color var(--transition), box-shadow var(--transition);
    appearance: none;
    -webkit-appearance: none;
  }
  .field input:focus, .field select:focus, .field textarea:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(232,255,71,0.12);
  }
  .field select { cursor: pointer; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%236b6b82' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center; padding-right: 32px; }

  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 7px;
    padding: 10px 20px; border-radius: 8px; border: none; cursor: pointer;
    font-family: var(--font-body); font-size: 0.88rem; font-weight: 600;
    letter-spacing: 0.5px; transition: all var(--transition); white-space: nowrap;
  }
  .btn-primary {
    background: var(--accent); color: #0c0c10;
  }
  .btn-primary:hover { background: #f5ff80; transform: translateY(-1px); box-shadow: 0 6px 20px rgba(232,255,71,0.3); }
  .btn-primary:active { transform: translateY(0); }
  .btn-ghost {
    background: transparent; color: var(--muted);
    border: 1px solid var(--border);
  }
  .btn-ghost:hover { color: var(--text); border-color: var(--muted); }
  .btn-danger { background: rgba(255,92,92,0.12); color: var(--accent2); border: 1px solid rgba(255,92,92,0.2); }
  .btn-danger:hover { background: rgba(255,92,92,0.22); }
  .btn-sm { padding: 6px 12px; font-size: 0.78rem; }
  .btn[disabled] { opacity: 0.4; cursor: not-allowed; transform: none !important; }

  /* ── Filters ── */
  .filters { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 20px; }
  .filter-btn {
    padding: 6px 16px; border-radius: 99px; font-size: 0.8rem; font-weight: 500;
    letter-spacing: 0.5px; border: 1px solid var(--border); background: transparent;
    color: var(--muted); cursor: pointer; transition: all var(--transition);
  }
  .filter-btn:hover { color: var(--text); border-color: var(--muted); }
  .filter-btn.active { background: var(--accent); color: #0c0c10; border-color: var(--accent); font-weight: 600; }

  /* ── Search ── */
  .search-row { display: flex; gap: 12px; margin-bottom: 20px; }
  .search-wrap { position: relative; flex: 1; }
  .search-wrap input { width: 100%; padding-left: 38px; }
  .search-icon { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--muted); pointer-events: none; }

  /* ── Game Grid ── */
  .game-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 16px;
  }

  /* ── Game Card ── */
  .game-card {
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 20px;
    display: flex; flex-direction: column; gap: 14px;
    transition: transform var(--transition), border-color var(--transition), box-shadow var(--transition);
    animation: cardIn 0.35s ease both;
  }
  @keyframes cardIn {
    from { opacity: 0; transform: translateY(12px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .game-card:hover {
    transform: translateY(-3px);
    border-color: rgba(255,255,255,0.14);
    box-shadow: 0 12px 32px rgba(0,0,0,0.4);
  }
  .card-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
  .game-title {
    font-family: var(--font-head);
    font-size: 1.3rem; letter-spacing: 1px; line-height: 1.15;
    color: var(--text); flex: 1;
  }
  .platform-badge {
    font-size: 0.65rem; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase;
    padding: 4px 8px; border-radius: 5px; white-space: nowrap; flex-shrink: 0;
    background: rgba(255,255,255,0.06); color: var(--muted); border: 1px solid var(--border);
  }
  .status-pill {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: 0.72rem; font-weight: 600; letter-spacing: 1px; text-transform: uppercase;
    padding: 5px 10px; border-radius: 99px;
  }
  .status-pill::before { content: ''; width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .status-Backlog        { background: rgba(255,183,74,0.12); color: #ffb74a; border: 1px solid rgba(255,183,74,0.2); }
  .status-Backlog::before        { background: #ffb74a; }
  .status-Playing        { background: rgba(92,255,161,0.12); color: var(--accent3); border: 1px solid rgba(92,255,161,0.2); }
  .status-Playing::before        { background: var(--accent3); box-shadow: 0 0 6px var(--accent3); animation: pulse 1.6s infinite; }
  .status-Completed      { background: rgba(99,128,255,0.12); color: #9db4ff; border: 1px solid rgba(99,128,255,0.2); }
  .status-Completed::before      { background: #9db4ff; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }

  .stars { display: flex; gap: 3px; }
  .star { font-size: 0.9rem; cursor: pointer; transition: transform 0.1s; color: var(--muted); }
  .star.filled { color: var(--accent); }
  .star:hover { transform: scale(1.25); }

  .card-notes {
    font-size: 0.82rem; color: var(--muted); line-height: 1.5;
    border-top: 1px solid var(--border); padding-top: 10px;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .card-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: auto; }

  /* ── Edit inline ── */
  .card-edit-form { display: flex; flex-direction: column; gap: 10px; }
  .card-edit-form .field label { font-size: 0.65rem; }
  .card-edit-actions { display: flex; gap: 8px; }

  /* ── Empty state ── */
  .empty-state {
    grid-column: 1 / -1;
    text-align: center;
    padding: 64px 24px;
    color: var(--muted);
  }
  .empty-state .big { font-family: var(--font-head); font-size: 4rem; letter-spacing: 3px; color: rgba(255,255,255,0.05); margin-bottom: 12px; }
  .empty-state p { font-size: 0.9rem; }

  /* ── Toast ── */
  #toast {
    position: fixed; bottom: 28px; right: 28px;
    background: var(--surface2); border: 1px solid var(--border);
    color: var(--text); padding: 13px 20px; border-radius: var(--radius);
    font-size: 0.88rem; font-weight: 500;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    transform: translateY(20px); opacity: 0;
    transition: all 0.3s cubic-bezier(.4,0,.2,1);
    pointer-events: none; z-index: 999; max-width: 320px;
  }
  #toast.show { transform: translateY(0); opacity: 1; }
  #toast.success { border-left: 3px solid var(--accent3); }
  #toast.error   { border-left: 3px solid var(--accent2); }

  /* ── Loading ── */
  .loader { display: flex; justify-content: center; padding: 48px; }
  .spinner { width: 32px; height: 32px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Modal (edit) ── */
  .modal-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.7);
    backdrop-filter: blur(6px);
    display: flex; align-items: center; justify-content: center;
    z-index: 100; opacity: 0; pointer-events: none;
    transition: opacity 0.25s;
  }
  .modal-overlay.open { opacity: 1; pointer-events: all; }
  .modal {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 14px; padding: 32px; width: 100%; max-width: 480px;
    transform: scale(0.95); transition: transform 0.25s cubic-bezier(.4,0,.2,1);
  }
  .modal-overlay.open .modal { transform: scale(1); }
  .modal h2 { font-family: var(--font-head); font-size: 1.6rem; letter-spacing: 2px; margin-bottom: 24px; color: var(--accent); }
  .modal .form-stack { display: flex; flex-direction: column; gap: 14px; }
  .modal-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 24px; }

  /* ── Rating input ── */
  .rating-input { display: flex; gap: 4px; }
  .rating-input .star { font-size: 1.4rem; }
</style>
</head>
<body>
<div class="app">

  <!-- Header -->
  <header>
    <div class="logo">
      <h1>GAMEIFY</h1>
      <span class="tagline">Track your journey</span>
    </div>
    <div class="stats-bar">
      <div class="stat"><div class="num" id="stat-total">0</div><div class="lbl">Total</div></div>
      <div class="stat"><div class="num" id="stat-playing">0</div><div class="lbl">Playing</div></div>
      <div class="stat"><div class="num" id="stat-backlog">0</div><div class="lbl">Backlog</div></div>
      <div class="stat"><div class="num" id="stat-done">0</div><div class="lbl">Done</div></div>
    </div>
  </header>

  <!-- Add Game Panel -->
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
          <span class="star" data-v="1">★</span>
          <span class="star" data-v="2">★</span>
          <span class="star" data-v="3">★</span>
          <span class="star" data-v="4">★</span>
          <span class="star" data-v="5">★</span>
        </div>
      </div>
      <div class="field" style="align-self:end">
        <button class="btn btn-primary" id="btn-add">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          Add Game
        </button>
      </div>
    </div>
  </div>

  <!-- Game List Panel -->
  <div class="panel">
    <div class="panel-title">Library</div>

    <div class="search-row">
      <div class="search-wrap">
        <svg class="search-icon" width="15" height="15" viewBox="0 0 20 20" fill="none"><circle cx="9" cy="9" r="6" stroke="currentColor" stroke-width="1.8"/><path d="m14.5 14.5 3.5 3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        <input type="text" id="search" placeholder="Search games…" class="field input">
      </div>
    </div>

    <div class="filters" id="filters">
      <button class="filter-btn active" data-filter="All">All</button>
      <button class="filter-btn" data-filter="Backlog">Backlog</button>
      <button class="filter-btn" data-filter="Playing">Playing</button>
      <button class="filter-btn" data-filter="Completed">Completed</button>
    </div>

    <div class="game-grid" id="game-grid">
      <div class="loader"><div class="spinner"></div></div>
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
          <option value="PC">PC</option>
          <option value="PlayStation">PlayStation</option>
          <option value="Xbox">Xbox</option>
          <option value="Switch">Switch</option>
          <option value="Mobile">Mobile</option>
        </select>
      </div>
      <div class="field"><label>Status</label>
        <select id="e-status">
          <option value="Backlog">Backlog</option>
          <option value="Playing">Currently Playing</option>
          <option value="Completed">Completed</option>
        </select>
      </div>
      <div class="field">
        <label>Rating</label>
        <div class="rating-input" id="e-rating-stars">
          <span class="star" data-v="1">★</span>
          <span class="star" data-v="2">★</span>
          <span class="star" data-v="3">★</span>
          <span class="star" data-v="4">★</span>
          <span class="star" data-v="5">★</span>
        </div>
      </div>
      <div class="field"><label>Notes</label><textarea id="e-notes" rows="3" placeholder="Any thoughts…"></textarea></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="modal-cancel">Cancel</button>
      <button class="btn btn-primary" id="modal-save">Save Changes</button>
    </div>
  </div>
</div>

<!-- Toast -->
<div id="toast"></div>

<script>
// ── State ──────────────────────────────────────────────────────────────────
const API = '/api/games';
let games = [];
let filter = 'All';
let search = '';
let addRating = 0;
let editRating = 0;

// ── Fetch helpers ──────────────────────────────────────────────────────────
async function apiFetch(url, opts = {}) {
  const r = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: 'Network error' }));
    throw new Error(err.error || 'Request failed');
  }
  return r.json();
}

// ── Toast ──────────────────────────────────────────────────────────────────
function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show ' + type;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = ''; }, 2800);
}

// ── Stars widget ───────────────────────────────────────────────────────────
function initStars(containerId, onSet) {
  const container = document.getElementById(containerId);
  container.querySelectorAll('.star').forEach(s => {
    s.addEventListener('click', () => {
      const v = +s.dataset.v;
      onSet(v);
      renderStars(containerId, v);
    });
    s.addEventListener('mouseenter', () => renderStars(containerId, +s.dataset.v, true));
    s.addEventListener('mouseleave', () => {
      const cur = containerId === 'f-rating-stars' ? addRating : editRating;
      renderStars(containerId, cur);
    });
  });
}
function renderStars(containerId, value, hover = false) {
  document.getElementById(containerId).querySelectorAll('.star').forEach(s => {
    s.classList.toggle('filled', +s.dataset.v <= value);
  });
}

// ── Load & render ──────────────────────────────────────────────────────────
async function loadGames() {
  try {
    games = await apiFetch(API);
    render();
  } catch (e) {
    document.getElementById('game-grid').innerHTML =
      '<div class="empty-state"><div class="big">ERROR</div><p>' + e.message + '</p></div>';
  }
}

function render() {
  const grid = document.getElementById('game-grid');
  const q = search.toLowerCase();
  const filtered = games.filter(g => {
    const matchFilter = filter === 'All' || g.status === filter;
    const matchSearch = !q || g.title.toLowerCase().includes(q) || (g.platform||'').toLowerCase().includes(q);
    return matchFilter && matchSearch;
  });

  // Stats
  document.getElementById('stat-total').textContent   = games.length;
  document.getElementById('stat-playing').textContent = games.filter(g => g.status === 'Playing').length;
  document.getElementById('stat-backlog').textContent = games.filter(g => g.status === 'Backlog').length;
  document.getElementById('stat-done').textContent    = games.filter(g => g.status === 'Completed').length;

  if (!filtered.length) {
    grid.innerHTML = '<div class="empty-state"><div class="big">EMPTY</div><p>' +
      (games.length ? 'No games match your filter.' : 'No games yet. Add your first one above!') +
      '</p></div>';
    return;
  }

  grid.innerHTML = filtered.map(g => {
    const stars = [1,2,3,4,5].map(i =>
      '<span class="star' + (i <= (g.rating||0) ? ' filled' : '') + '">★</span>'
    ).join('');
    const notes = g.notes ? '<div class="card-notes">' + esc(g.notes) + '</div>' : '';
    return \`
      <div class="game-card" data-id="\${g.id}">
        <div class="card-top">
          <div class="game-title">\${esc(g.title)}</div>
          <span class="platform-badge">\${esc(g.platform)}</span>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
          <span class="status-pill status-\${g.status}">\${g.status === 'Playing' ? 'Playing' : g.status}</span>
          <div class="stars">\${stars}</div>
        </div>
        \${notes}
        <div class="card-actions">
          <button class="btn btn-ghost btn-sm" onclick="openEdit('\${g.id}')">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteGame('\${g.id}')">Delete</button>
        </div>
      </div>
    \`;
  }).join('');
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── CRUD ───────────────────────────────────────────────────────────────────

// CREATE
async function addGame() {
  const title    = document.getElementById('f-title').value.trim();
  const platform = document.getElementById('f-platform').value;
  const status   = document.getElementById('f-status').value;
  if (!title) { toast('Please enter a game title.', 'error'); return; }

  const btn = document.getElementById('btn-add');
  btn.disabled = true;
  try {
    const game = await apiFetch(API, {
      method: 'POST',
      body: JSON.stringify({ title, platform, status, rating: addRating })
    });
    games.push(game);
    render();
    document.getElementById('f-title').value = '';
    addRating = 0;
    renderStars('f-rating-stars', 0);
    toast('Game added to your library!');
  } catch(e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// DELETE
async function deleteGame(id) {
  if (!confirm('Remove this game from your library?')) return;
  try {
    await apiFetch(API + '/' + id, { method: 'DELETE' });
    games = games.filter(g => g.id !== id);
    render();
    toast('Game removed.');
  } catch(e) {
    toast(e.message, 'error');
  }
}

// ── Edit Modal ─────────────────────────────────────────────────────────────
function openEdit(id) {
  const g = games.find(x => x.id === id);
  if (!g) return;
  document.getElementById('e-id').value       = g.id;
  document.getElementById('e-title').value    = g.title;
  document.getElementById('e-platform').value = g.platform;
  document.getElementById('e-status').value   = g.status;
  document.getElementById('e-notes').value    = g.notes || '';
  editRating = g.rating || 0;
  renderStars('e-rating-stars', editRating);
  document.getElementById('modal').classList.add('open');
}

document.getElementById('modal-cancel').onclick = () => document.getElementById('modal').classList.remove('open');
document.getElementById('modal').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.classList.remove('open'); });

// UPDATE
document.getElementById('modal-save').onclick = async () => {
  const id     = document.getElementById('e-id').value;
  const title  = document.getElementById('e-title').value.trim();
  const platform = document.getElementById('e-platform').value;
  const status   = document.getElementById('e-status').value;
  const notes    = document.getElementById('e-notes').value.trim();
  if (!title) { toast('Title is required.', 'error'); return; }

  const btn = document.getElementById('modal-save');
  btn.disabled = true;
  try {
    const updated = await apiFetch(API + '/' + id, {
      method: 'PUT',
      body: JSON.stringify({ title, platform, status, rating: editRating, notes })
    });
    games = games.map(g => g.id === id ? updated : g);
    render();
    document.getElementById('modal').classList.remove('open');
    toast('Game updated!');
  } catch(e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
  }
};

// ── Filter & Search ────────────────────────────────────────────────────────
document.getElementById('filters').querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    filter = btn.dataset.filter;
    render();
  });
});

document.getElementById('search').addEventListener('input', e => {
  search = e.target.value;
  render();
});

// ── Add button & Enter key ─────────────────────────────────────────────────
document.getElementById('btn-add').addEventListener('click', addGame);
document.getElementById('f-title').addEventListener('keydown', e => { if (e.key === 'Enter') addGame(); });

// ── Star init ──────────────────────────────────────────────────────────────
initStars('f-rating-stars', v => { addRating = v; });
initStars('e-rating-stars', v => { editRating = v; });

// ── Boot ───────────────────────────────────────────────────────────────────
loadGames();
</script>
</body>
</html>`;

// ── HTTP Server ───────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (url.startsWith('/api/')) {
    return handleAPI(req, res);
  }

  // Serve frontend for all other routes
  sendHtml(res, HTML);
});

server.listen(PORT, () => {
  console.log(`\n  🎮  GAMEIFY running at http://localhost:${PORT}\n`);
});
