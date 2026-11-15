# SaDeL - Architecture Documentation

## Overview

SaDeL is a professional-grade, multi-region delivery management platform built with modern technology stack for robustness, scalability, and reliability.

## System Architecture

### Monorepo Structure

```
sadel/
├── packages/
│   ├── backend/          # Node.js + Fastify API
│   ├── shared/           # Shared types and utilities
│   ├── web-restaurant/   # Restaurant portal (Next.js)
│   ├── web-customer/     # Customer app (Next.js)
│   └── web-driver/       # Driver app (Next.js)
├── infrastructure/       # Docker, database configs
└── docs/                 # Documentation
```

## Technology Stack

### Backend
- **Framework**: Fastify (fast, lightweight, TypeScript-ready)
- **Runtime**: Node.js 18+
- **Language**: TypeScript (strict mode, no technical debt)
- **Database**: PostgreSQL 16 (enterprise-grade)
- **ORM**: Prisma (type-safe, migrations included)
- **Cache**: Redis 7 (performance & real-time)
- **Real-time**: Socket.io (websockets)
- **Authentication**: JWT with refresh tokens
- **Task Queue**: Bull/BullMQ (async processing)

### Frontend (All portals)
- **Framework**: Next.js 14 (App Router)
- **UI Library**: React 18
- **Language**: TypeScript (strict)
- **Styling**: TailwindCSS
- **State**: Zustand (lightweight)
- **HTTP**: Axios + SWR
- **Real-time**: Socket.io Client
- **Forms**: React Hook Form
- **Charts**: Recharts

### DevOps & Infrastructure
- **Containerization**: Docker + Docker Compose
- **CI/CD**: GitHub Actions
- **Version Control**: Git

## Database Schema

### Core Models

**User**
- Central authentication entity
- Supports 4 roles: ADMIN, RESTAURANT, CUSTOMER, DRIVER
- Region-based organization

**Restaurant**
- Menu management
- Operating hours
- Delivery configuration
- Order processing
- Real-time status updates

**Customer**
- Address management
- Order history
- Favorites
- Reviews & ratings

**Driver**
- Location tracking
- Availability status
- Earnings tracking
- Performance metrics

**Order**
- Complete order lifecycle
- Payment tracking
- Real-time status
- Order history

**Transaction**
- Payment records
- Commission tracking
- Audit trail

### Additional Models

- `MenuCategory`: Restaurant menu organization
- `Product`: Menu items with pricing
- `Address`: Customer delivery addresses
- `OrderItem`: Line items in orders
- `OrderTracking`: Real-time tracking updates
- `Review`: Customer feedback
- `FavoriteRestaurant`: Customer bookmarks
- `Region`: Multi-region configuration
- `OperatingHours`: Restaurant hours
- Statistics: Daily, restaurant, and driver stats

## API Architecture

### Core Principles

1. **RESTful Design**: Standard HTTP methods and status codes
2. **Type Safety**: All endpoints have TypeScript types
3. **Validation**: Zod schemas for request validation
4. **Error Handling**: Consistent error responses
5. **Rate Limiting**: DDoS protection built-in
6. **CORS**: Secure cross-origin setup
7. **Helmet**: Security headers included

### Key Endpoints (Planned)

```
Authentication
  POST   /auth/register
  POST   /auth/login
  POST   /auth/refresh
  POST   /auth/logout

Restaurants
  GET    /restaurants
  GET    /restaurants/:id
  POST   /restaurants (requires RESTAURANT role)
  PUT    /restaurants/:id
  GET    /restaurants/:id/orders
  PATCH  /restaurants/:id/status

Orders
  POST   /orders
  GET    /orders/:id
  PATCH  /orders/:id/status
  GET    /orders/history

Drivers
  GET    /drivers/available
  POST   /drivers/:id/accept-order
  PATCH  /drivers/:id/location

Admin
  GET    /admin/stats
  GET    /admin/restaurants
  GET    /admin/drivers
  POST   /admin/users/:id/suspend
```

## Real-time Features

### Socket.io Events

```
User Connection
  - join-room: User joins specific room (role:userId)
  - leave-room: User leaves room
  
Order Events
  - order:created: New order placed
  - order:status-changed: Order status update
  - order:ready: Order ready for pickup
  - order:location-update: Driver location
  - order:delivered: Order delivered

Notifications
  - notification:new
  - notification:read
```

## Multi-Region Support

SaDeL is designed to operate across 10+ regions with:

1. **Region Configuration**
   - Base delivery fees per region
   - Tax rates
   - Supported payment methods
   - Delivery radius

2. **Localization**
   - Currency handling
   - Language support
   - Regional regulations

3. **Driver Assignment**
   - Region-specific driver pools
   - Geolocation-based matching

4. **Analytics**
   - Region-specific metrics
   - Daily statistics

## Security Implementation

### Authentication & Authorization

- **JWT**: Access tokens (24h expiry)
- **Refresh Tokens**: Secure refresh mechanism
- **Role-Based Access Control (RBAC)**:
  - ADMIN: Full system access
  - RESTAURANT: Own restaurant management
  - CUSTOMER: Order placement and tracking
  - DRIVER: Delivery management

### Data Protection

- **Password Hashing**: bcryptjs with salt rounds
- **HTTPS**: All communications encrypted (production)
- **CORS**: Restricted origins
- **Rate Limiting**: 100 requests per 15 minutes
- **SQL Injection**: Protected by Prisma ORM
- **XSS Protection**: Security headers via Helmet

## Performance Optimization

1. **Caching Strategy**
   - Redis for session storage
   - API response caching
   - Real-time data with WebSockets

2. **Database Optimization**
   - Indexed queries
   - Connection pooling
   - Pagination

3. **Frontend Optimization**
   - Static generation (Next.js)
   - Image optimization
   - Code splitting

## Scalability Design

1. **Horizontal Scaling**
   - Stateless API servers
   - Shared Redis cache
   - PostgreSQL read replicas (future)

2. **Async Processing**
   - Bull queue for heavy tasks
   - Email notifications
   - SMS alerts

3. **Load Balancing**
   - Docker Compose ready
   - Kubernetes compatible

## Monitoring & Logging

- **Application Logs**: Winston/Pino (planned)
- **Error Tracking**: Sentry integration (planned)
- **Performance Monitoring**: APM integration (planned)
- **Health Checks**: `/health` endpoint
- **Metrics**: Prometheus export (planned)

## Deployment

### Development
```bash
npm run docker:up
npm run dev
```

### Production
1. Build Docker images
2. Push to registry
3. Deploy with Kubernetes or Docker Swarm
4. Run migrations
5. Scale as needed

## Development Workflow

### Prerequisites
- Node.js 18+
- Docker & Docker Compose
- Git

### Setup
```bash
git clone <repo>
cd sadel
npm install
npm run docker:up
npm run db:migrate
npm run dev
```

### Code Quality
- ESLint: Code linting
- Prettier: Code formatting
- TypeScript: Type checking
- Jest: Unit testing

## Git Strategy

- **main**: Production code
- **develop**: Development integration branch
- **feature/**: Feature branches
- **bugfix/**: Bug fix branches

Conventional commits required.

## Future Enhancements

1. **Advanced Features**
   - Machine learning for driver assignment
   - Predictive demand
   - Dynamic pricing
   - Customer loyalty program

2. **Expansion**
   - Mobile apps (React Native)
   - Advanced analytics dashboard
   - Business intelligence reports

3. **Integration**
   - Payment gateway providers
   - SMS notifications (Twilio)
   - Email service (SendGrid)
   - Analytics (Google Analytics)

## Support & Maintenance

- Regular security updates
- Performance monitoring
- Database maintenance
- Backup strategy (daily backups)

---

**Version**: 1.0.0-alpha
**Last Updated**: April 18, 2026
