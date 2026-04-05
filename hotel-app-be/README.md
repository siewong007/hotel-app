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
    <img src="https://img.shields.io/badge/Rust-%E2%89%A51.70-blue?logo=rust" alt="Rust" />
    <img src="https://img.shields.io/badge/TypeScript-Frontend-blue?logo=typescript" alt="TypeScript" />
    <img src="https://img.shields.io/badge/Docker-CI-brightgreen?logo=docker" alt="Docker CI" />
  </p>
</div>

<br/>

One Command to Launch **HotelApp** and Unlock All AI Agent Harnesses.

Supports direct integration with Claude Desktop, Cursor, and more.

---

### 🚀 Quick Start

The hotel management system includes two Model Context Protocol (MCP) servers that provide AI-powered tools and analytics capabilities:

1. **Build the servers**:
   ```bash
   cd hotel-app-be/mcp-server/analytics-server
   npm install && npm run build

   cd ../hotel-search-server
   npm install && npm run build
   ```

2. **Test with MCP Inspector**:
   ```bash
   cd analytics-server
   npm run inspector  # Opens browser for testing tools
   ```

### 🧠 Core Architecture

Provides Advanced AI Reporting & Hotel Room Search availability.

- **Analytics Server** (`mcp-server/analytics-server/`)
  - *Purpose*: Advanced reporting and analytics engine.
  - *Tools Available*: 11 MCP tools including occupancy reports, trend analytics, smart recommendations, guest insights, and comprehensive executive summaries.
- **Hotel Search Server** (`mcp-server/hotel-search-server/`)
  - *Purpose*: Real-time hotel room search and availability.
  - *Tools Available*: 3 MCP tools including room search with filters, complete room inventory, and authentication.

### 🔌 MCP Integration

Both MCP servers:
- Connect directly to the hotel REST API
- Support JWT authentication for secure access
- Provide real-time data from the hotel database
- Use the MCP protocol for standardized tool communication

### ⚙️ Claude Desktop Configuration

Add the following to your Claude Desktop config file:

```json
{
  "mcpServers": {
    "analytics-server": {
      "command": "node",
      "args": ["/path/to/analytics-server/build/index.js"],
      "env": {
        "HOTEL_API_URL": "http://localhost:3030"
      }
    },
    "hotel-search-server": {
      "command": "node",
      "args": ["/path/to/hotel-search-server/build/index.js"],
      "env": {
        "HOTEL_API_URL": "http://localhost:3030"
      }
    }
  }
}
```

### 📡 Using MCP Tools from Backend

The backend also exposes MCP-compatible analytics endpoints that can be called directly:
- `GET /analytics/occupancy` - Real-time occupancy report
- `GET /analytics/bookings` - Booking analytics
- `GET /analytics/benchmark` - Performance benchmarking

*These endpoints require authentication and the `analytics:read` permission.*
