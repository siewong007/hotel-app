<div align="center">
  <img src="https://img.icons8.com/color/96/000000/5-star-hotel.png" alt="HotelApp Logo" width="80" />

  <h2>oh — HotelApp: Open Hotel Harness</h2>

  <p>
    <strong>HotelApp delivers core lightweight hospitality infrastructure: AI-tool-use, real-time sync, analytics, and booking coordination.</strong>
  </p>

  <p>
    <strong>Join the community</strong>: contribute to HotelApp for open system development.
  </p>

  <p>
    <a href="#quick-start"><img src="https://img.shields.io/badge/QUICK_START-5_MIN-00A9E0?style=for-the-badge" alt="Quick Start" /></a>
    <img src="https://img.shields.io/badge/ARCHITECTURE-RUST_%7C_POSTGRES-ff69b4?style=for-the-badge" alt="Architecture" />
    <img src="https://img.shields.io/badge/TOOLS-14+-yellow?style=for-the-badge" alt="Tools" />
    <img src="https://img.shields.io/badge/TESTS-PASSING-32CD32?style=for-the-badge" alt="Tests" />
    <img src="https://img.shields.io/badge/LICENSE-MIT-FFA500?style=for-the-badge" alt="License" />
  </p>

  <p>
    <img src="https://img.shields.io/badge/Rust-%E2%89%A51.95.0-blue?logo=rust" alt="Rust" />
    <img src="https://img.shields.io/badge/TypeScript-Frontend-blue?logo=typescript" alt="TypeScript" />
    <img src="https://img.shields.io/badge/Docker-CI-brightgreen?logo=docker" alt="Docker CI" />
  </p>
</div>

<br/>

One Command to Launch **HotelApp** and Unlock All AI Agent Harnesses.

Supports direct integration with Claude Desktop, Cursor, and more.

---

### 🚀 MCP Servers

MCP servers (analytics, hotel-search): planned only — no `mcp-server/` directory exists yet.

### 🖥️ Rebuild the Desktop App

See `../hotel-desktop/BUILD_SPEED.md` for comprehensive build and development instructions.

### 🛑 Stop Previous Processes

Stop interactive processes with `Ctrl+C`. Kill lingering ports on macOS:

```bash
kill $(lsof -ti tcp:3000)  # frontend
kill $(lsof -ti tcp:3030)  # backend
kill $(lsof -ti tcp:3031)  # alternate backend
```

To stop desktop PostgreSQL: `cd hotel-desktop/src-tauri && ./pgsql/bin/pg_ctl stop -D "$HOME/Library/Application Support/HotelApp/pgdata" -m fast`
