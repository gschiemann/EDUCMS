# EDU CMS — Local Development Setup

## Prerequisites

- **Docker Desktop** (for PostgreSQL + Redis)
- **Node.js 18+** 
- **pnpm** (`npm install -g pnpm`)

## Quick Start (3 commands)

```powershell
# 1. Start PostgreSQL + Redis via Docker
docker compose up db redis -d

# 2. Push schema and seed the database
pnpm run db:setup

# 3. Start both API + Frontend in dev mode
pnpm run dev:api    # Terminal 1 — NestJS on :8080
pnpm run dev:web    # Terminal 2 — Next.js on :3000
```

## Login

Open **http://localhost:3000/login**

| Email | Password | Role |
|---|---|---|
| `admin@springfield.edu` | `admin123` | Super Admin |
| `teacher@springfield.edu` | `admin123` | Contributor |

## Available Pages

| Route | Description |
|---|---|
| `/login` | Authentication |
| `/{schoolId}/dashboard` | Live stats, audit feed, device health |
| `/{schoolId}/screens` | Screen groups with create + online/offline |
| `/{schoolId}/playlists` | Playlist list, drag-drop timeline |
| `/{schoolId}/assets` | File upload with progress + approve/reject |
| `/{schoolId}/announcements` | Announcement composer with HTML sanitization |
| `/{schoolId}/settings` | School profile + user management CRUD |

The seed school ID is `00000000-0000-0000-0000-000000000002`.

## API Endpoints

All endpoints require JWT auth (`Authorization: Bearer <token>`).

```
POST   /api/v1/auth/login         — Login (returns JWT + user)
GET    /api/v1/stats/overview      — Dashboard stats
GET    /api/v1/audit/recent        — Recent audit logs
GET    /api/v1/screen-groups       — List screen groups with screens
POST   /api/v1/screen-groups       — Create group
GET    /api/v1/playlists           — List playlists with items
POST   /api/v1/playlists           — Create playlist
DELETE /api/v1/playlists/:id       — Delete playlist
GET    /api/v1/assets              — List all assets
POST   /api/v1/assets/upload       — Upload file (multipart/form-data)
PUT    /api/v1/assets/:id/approve  — Approve pending asset
PUT    /api/v1/assets/:id/reject   — Reject pending asset
GET    /api/v1/users               — List users
POST   /api/v1/users               — Create user (Argon2id hashed)
PUT    /api/v1/users/:id/role      — Update user role
DELETE /api/v1/users/:id           — Delete user
GET    /api/v1/schedules           — List schedules
POST   /api/v1/schedules           — Create schedule
DELETE /api/v1/schedules/:id       — Delete schedule
POST   /api/v1/emergency/trigger   — Trigger emergency broadcast
```

## Architecture

```
EDU CMS/
├── apps/
│   ├── api/          — NestJS 11 backend (port 8080)
│   └── web/          — Next.js 16 frontend (port 3000)
├── packages/
│   ├── database/     — Prisma schema + seed + AppRole enum
│   ├── api-types/    — Shared TypeScript API types
│   ├── auth-core/    — Auth utilities
│   └── ws-events/    — WebSocket event types
├── docker-compose.yml
└── .env
```

## Troubleshooting

**"ECONNREFUSED" on API start:** Docker containers aren't running.
```powershell
docker compose up db redis -d
```

**"relation does not exist":** Schema hasn't been pushed.
```powershell
pnpm run db:push
```

**"Invalid credentials" on login:** Database needs seeding.
```powershell
pnpm run db:seed
```

**Redis connection warning:** This is fine — the API runs without Redis, you just won't have realtime WebSocket or token revocation features.

**OneDrive symlink errors during pnpm install:** OneDrive locks files. Pause OneDrive sync, run `pnpm install`, then resume.
