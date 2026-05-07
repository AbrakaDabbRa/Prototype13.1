/**
 * database.js
 * SQLite handles ONLY users (login info).
 * Games are stored as JSON files per user in /data/
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(process.env.DB_PATH || path.join(__dirname, 'users.db'));

// Enable WAL for better performance
db.exec(`PRAGMA journal_mode = WAL`);

// Users table — just what we need
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    username   TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password   TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

const stmt = {
  getById:       db.prepare(`SELECT * FROM users WHERE id = ?`),
  getByUsername: db.prepare(`SELECT * FROM users WHERE username = ? COLLATE NOCASE`),
  insert:        db.prepare(`INSERT INTO users (id, username, password) VALUES (?, ?, ?)`),
};

function getUserById(id)             { return stmt.getById.get(id); }
function getUserByUsername(username) { return stmt.getByUsername.get(username); }
function createUser(id, username, password) {
  stmt.insert.run(id, username, password);
  return getUserById(id);
}

module.exports = { getUserById, getUserByUsername, createUser };
