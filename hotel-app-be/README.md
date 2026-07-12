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

### 🚀 MCP Servers — Not Implemented

This README previously documented two Model Context Protocol (MCP) servers
(`mcp-server/analytics-server/`, `mcp-server/hotel-search-server/`) as a
quick-start feature. **Neither directory exists in this repository** — there
is no MCP server code, no `/analytics/occupancy`/`/analytics/bookings`/
`/analytics/benchmark` REST endpoints, and no Claude Desktop config to wire
up. Treat this as aspirational/removed, not a working quick-start. If MCP
tooling for this backend is built in the future, restore a section here
pointing at the real implementation.

### 🖥️ Rebuild the Desktop App

Run these commands from the repository root to rebuild the Tauri desktop application:

```bash
cd hotel-desktop
bun install
bun run desktop:prepare
bun run build
```

`desktop:prepare` refreshes the desktop bundle before Tauri builds it:

- syncs backend `database/schema.sql` and `database/data.sql` into `hotel-desktop/src-tauri/database/`, skipping unchanged copies
- builds the React frontend in `hotel-web-fe` only when frontend inputs changed
- builds the backend sidecar from `hotel-app-be` only when backend inputs changed; production builds use release, while `build:fast` and `build:debug` use debug
- copies the backend sidecar into `hotel-desktop/src-tauri/binaries/` with the target-triple filename Tauri expects, skipping unchanged copies

For a debug desktop build:

```bash
cd hotel-desktop
bun run desktop:prepare
bun run build:debug
```

For the fastest local verification build:

```bash
cd hotel-desktop
bun run build:fast
```

For local desktop development:

```bash
cd hotel-desktop
bun run desktop:prepare
bun run dev
```

`bun run build` already invokes `desktop:prepare` through Tauri's `beforeBuildCommand`, but running it manually first is useful when diagnosing build failures.

### 🛑 Stop Previous FE/BE Startup

If the frontend or backend is running in a terminal tab, stop it with:

```bash
Ctrl+C
```

If a detached or leftover process is still holding a port on macOS, stop it by port:

```bash
kill $(lsof -ti tcp:3000)  # frontend Vite server
kill $(lsof -ti tcp:3030)  # backend API default port
kill $(lsof -ti tcp:3031)  # alternate backend port, if used
```

For a desktop-app startup, close the Tauri app first. If bundled desktop PostgreSQL is still running, stop it with:

```bash
cd hotel-desktop/src-tauri
./pgsql/bin/pg_ctl stop -D "$HOME/Library/Application Support/HotelApp/pgdata" -m fast
```
