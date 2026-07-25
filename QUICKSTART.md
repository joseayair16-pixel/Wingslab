# SaDeL Quick Start Guide

## 🚀 Development Setup

### Prerequisites
- Node.js 18+
- Docker & Docker Compose
- Git

### 1. Clone & Install

```bash
cd /Users/ayair/Desktop/SaDeL
npm install
```

### 2. Start Docker Services

```bash
npm run docker:up
```

This starts:
- PostgreSQL (port 5432)
- Redis (port 6379)
- Backend (port 3001)
- Frontend (port 3000)

### 3. Run Database Migrations

```bash
npm run db:migrate
npm run db:generate
npm run db:seed:billing-demo
```

### 4. Start Development Servers

```bash
npm run dev
```

All services will start:
- Admin Portal: http://localhost:3000
- Restaurant Portal: http://localhost:3002
- Customer Portal: http://localhost:3003
- Driver Portal: http://localhost:3004
- Backend API: http://localhost:3001

### 5. Stop Services

```bash
npm run docker:down
```

## 📁 Project Structure

```
sadel/
├── packages/
│   ├── backend/          # Fastify API
│   ├── shared/           # Types & utilities
│   ├── web-admin/        # Admin dashboard
│   ├── web-restaurant/   # Restaurant portal
│   ├── web-customer/     # Customer app
│   └── web-driver/       # Driver app
├── infrastructure/       # Docker & database
├── .github/workflows/    # CI/CD
└── docs/                 # Documentation
```

## 🔧 Available Commands

### Development
```bash
npm run dev              # Start all services
npm run build            # Build all packages
npm run lint             # Run ESLint
npm run format           # Format code
npm run type-check       # TypeScript check
npm run test             # Run tests
npm run verify:web       # Validate all web apps: lint + type-check + production build
npm run verify:flow      # Validate the full customer -> restaurant -> driver flow
npm run verify:backend   # Validate backend HTTP contracts and failure handling
```

### Database
```bash
npm run db:migrate       # Run migrations
npm run db:generate      # Generate Prisma client
npm run db:seed:billing-demo # Seed a billing demo with debt + settlement history
npm run db:studio        # Open Prisma Studio (UI)
```

### Docker
```bash
npm run docker:up        # Start containers
npm run docker:down      # Stop containers
npm run docker:build     # Build images
```

## 📚 Key Technologies

- **Backend**: Fastify + Node.js + TypeScript
- **Frontend**: Next.js 14 + React 18 + TailwindCSS
- **Database**: PostgreSQL + Prisma ORM
- **Cache**: Redis
- **Real-time**: Socket.io
- **DevOps**: Docker + GitHub Actions

## 🗄️ Database

### Connection
- Host: localhost
- Port: 5432
- User: sadel_user
- Password: sadel_password_dev
- Database: sadel_db

### Prisma Studio
```bash
npm run db:studio
```

Opens browser UI to view and edit database.

## 🔐 Environment Variables

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Key variables:
- `DATABASE_URL`: PostgreSQL connection
- `REDIS_URL`: Redis connection
- `JWT_SECRET`: Token secret (change in production!)
- `NODE_ENV`: development/production

## 📝 API Testing

### Using curl
```bash
# Login
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password"}'

# Get restaurants
curl http://localhost:3001/restaurants
```

### Using Postman
1. Import the Postman collection (coming soon)
2. Set `{{BASE_URL}}` to `http://localhost:3001`
3. Set `{{TOKEN}}` after login

## 🧪 Testing

```bash
# Run all tests
npm run test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

### High-value validation commands

```bash
# Full business flow for demo confidence
npm run verify:flow

# HTTP contracts plus failure scenarios
npm run verify:backend

# Frontend quality gate for every web app
npm run verify:web
```

## 📦 Backend Package Structure

```
packages/backend/
├── src/
│   ├── index.ts              # Main entry point
│   ├── config/               # Configuration
│   │   ├── database.ts       # Prisma setup
│   │   └── redis.ts          # Redis setup
│   ├── middleware/           # Express middleware
│   ├── routes/               # API routes
│   ├── services/             # Business logic
│   │   └── socket.service.ts # Real-time
│   ├── utils/                # Utilities
│   └── types/                # TypeScript types
├── prisma/
│   └── schema.prisma         # Database schema
└── package.json
```

## 🎨 Frontend Structure

Each web package (admin, restaurant, customer, driver) follows:

```
packages/web-*/
├── src/
│   ├── app/                  # Next.js app directory
│   │   ├── layout.tsx        # Root layout
│   │   └── page.tsx          # Home page
│   ├── components/           # React components
│   ├── hooks/                # Custom hooks
│   ├── services/             # API services
│   ├── stores/               # Zustand stores
│   ├── types/                # Types
│   ├── styles/
│   │   └── globals.css       # Global styles
│   └── utils/                # Utilities
├── next.config.js
├── tailwind.config.ts
├── postcss.config.js
└── package.json
```

## 🔄 Git Workflow

1. Create feature branch: `git checkout -b feature/my-feature`
2. Make changes
3. Commit: `git commit -m "feat: add new feature"`
4. Push: `git push origin feature/my-feature`
5. Create Pull Request

## 🚨 Troubleshooting

### Docker won't start
```bash
# Clean up
docker-compose down -v
npm run docker:up
```

### Port already in use
```bash
# Kill process on port 3001 (macOS)
lsof -ti:3001 | xargs kill -9
```

### Database connection error
```bash
# Check PostgreSQL is running
npm run docker:up
npm run db:migrate
```

### Prisma type errors
```bash
npm run db:generate
```

## 📞 Support

- Check [ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed architecture
- Check [API.md](docs/API.md) for API documentation
- Review [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines

## ✅ Development Checklist

- [ ] Node.js 18+ installed
- [ ] Docker & Docker Compose installed
- [ ] Repository cloned
- [ ] Dependencies installed: `npm install`
- [ ] Docker services running: `npm run docker:up`
- [ ] Migrations run: `npm run db:migrate`
- [ ] Dev server started: `npm run dev`
- [ ] All services accessible on localhost

---

**Ready to develop!** 🎉

For more info, check the [README.md](README.md) and [docs/](docs/) folder.
