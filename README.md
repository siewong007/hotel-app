# Hotel Management System

Comprehensive hotel management system with Docker, PostgreSQL, authentication, RBAC, and MCP integration.

## Features

- 🏨 Hotel Management (rooms, guests, bookings)
- 🔐 Authentication (password + WebAuthn/passkeys)
- 👥 Role-Based Access Control
- 📊 Analytics Dashboard
- 🤖 MCP Integration (2 servers: Analytics + Search)
- 🌐 Multi-Platform (Web React + iOS Swift)

## Quick Start

```bash
# Start all services (database setup runs automatically!)
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

**Access:**
- Frontend: http://localhost:3000
- Backend API: http://localhost:3030
- Database: localhost:5432
- Default login: `admin` / `admin123`

**✨ Everything is automatic!** Database schema, seed data, and migrations all run automatically on first start.

## Architecture

- **Backend**: Rust (Axum) + PostgreSQL
- **Frontend**: React/TypeScript + Material-UI
- **iOS**: Swift with full API integration
- **MCP**: TypeScript servers for AI analytics

## Project Structure

```
├── database/              # SQL schema & seeds
├── hotel-management-be/   # Rust backend
├── hotel-web-fe/          # React frontend
├── hotel-mobile-ios/      # iOS app
└── docker-compose.yml     # Full stack deployment
```

## Development

**Backend:**
```bash
cd hotel-management-be && cargo run
```

**Frontend:**
```bash
cd hotel-web-fe && npm install && npm start
```

## API Endpoints

- `POST /auth/login` - Authentication
- `GET /rooms`, `GET /rooms/available` - Room management
- `GET /guests`, `POST /guests` - Guest management
- `GET /bookings`, `POST /bookings` - Booking management
- `GET /analytics/*` - Analytics (MCP-compatible)

All protected endpoints require: `Authorization: Bearer <token>`

## MCP Servers

See `hotel-management-be/mcp-server/README.md` for:
- Analytics Server (11 tools)
- Hotel Search Server (3 tools)
- Claude Desktop integration

## Security Checklist

- [ ] Change default admin password
- [ ] Set strong JWT_SECRET (32+ chars)
- [ ] Enable HTTPS
- [ ] Configure CORS
- [ ] Set up backups

## Documentation

- Backend: `hotel-management-be/README.md`
- iOS: `hotel-mobile-ios/README.md`
- MCP: `hotel-management-be/mcp-server/README.md`
