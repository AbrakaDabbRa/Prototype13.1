# 🎮 Gameify

A web-based game tracking app with a **Node.js backend** — zero npm dependencies required.

## Features
- **Full CRUD**: Add, view, edit, and delete games
- **Star ratings** (1–5)
- **Notes** per game
- **Filter** by status (Backlog / Playing / Completed)
- **Search** by title or platform
- **Persistent storage** via `games.json` on the server
- **Live stats** (total, playing, backlog, done)

## Quick Start

```bash
node server.js
```

Then open **http://localhost:3000** in your browser.

> Requires **Node.js v14.17+** (for `crypto.randomUUID`). No `npm install` needed.

## API Endpoints

| Method | URL               | Description        |
|--------|-------------------|--------------------|
| GET    | /api/games        | List all games     |
| POST   | /api/games        | Create a game      |
| PUT    | /api/games/:id    | Update a game      |
| DELETE | /api/games/:id    | Delete a game      |

### Game Object
```json
{
  "id":       "uuid-string",
  "title":    "Elden Ring",
  "platform": "PC",
  "status":   "Playing",
  "rating":   5,
  "notes":    "Incredible game.",
  "addedAt":  "2026-04-22T00:00:00.000Z"
}
```

## Project Structure
```
gameify/
├── server.js     ← Node.js backend + frontend HTML (single file)
├── games.json    ← Created automatically on first run
├── package.json
└── README.md
```
