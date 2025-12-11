### MCP Servers

The hotel management system includes two Model Context Protocol (MCP) servers that provide AI-powered tools and analytics capabilities:

#### 1. Analytics Server
- **Location**: `mcp-server/analytics-server/`
- **Purpose**: Advanced reporting and analytics engine
- **Tools Available**: 11 MCP tools including:
  - Occupancy reports and analytics
  - Booking analytics and trends
  - Chart data generation
  - Industry benchmarking
  - Guest insights and patterns
  - Smart room recommendations
  - Executive summaries
- **Documentation**: See `mcp-server/analytics-server/README.md`

#### 2. Hotel Search Server
- **Location**: `mcp-server/hotel-search-server/`
- **Purpose**: Real-time hotel room search and availability
- **Tools Available**: 3 MCP tools including:
  - Room search with filters
  - Complete room inventory
  - Authentication management
- **Documentation**: See `mcp-server/hotel-search-server/README.md`

#### MCP Integration
Both MCP servers:
- Connect directly to the hotel REST API
- Support JWT authentication for secure access
- Can be integrated with AI assistants (Claude Desktop, etc.)
- Provide real-time data from the hotel database
- Use the MCP protocol for standardized tool communication

#### Quick Start with MCP Servers

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

3. **Configure for Claude Desktop** (optional):
   Add to your Claude Desktop config file:
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

#### Using MCP Tools from Backend

The backend also exposes MCP-compatible analytics endpoints that can be called directly:
- `GET /analytics/occupancy` - Real-time occupancy report
- `GET /analytics/bookings` - Booking analytics
- `GET /analytics/benchmark` - Performance benchmarking

These endpoints require authentication and the `analytics:read` permission.
