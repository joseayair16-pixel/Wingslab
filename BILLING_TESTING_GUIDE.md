# 📋 Billing System Testing & Validation Guide

## ✅ System Overview

### Architecture
- **Job Scheduler**: Runs every Sunday at 23:59 UTC
- **Settlement Creation**: Handles $0 amounts correctly via `createBillingSettlement()`
- **Storage**: Database stores all settlements in `RestaurantBillingSettlement` table
- **Retrieval**: Frontend queries settlements ordered by `createdAt: 'desc'`

### Key Endpoints

#### Admin Panel
- `POST /admin/billing/force-settle/:restaurantId` - Force manual billing cut (testing)
- `GET /admin/billing/settlements` - List all settlements with pagination
- `PATCH /admin/billing/settlements/:id` - Update settlement status

#### Restaurant Panel
- `GET /restaurant-panel/facturacion` - Get current billing summary + recent settlements
- `GET /restaurant-panel/facturacion/:id/pedidos` - Get orders in billing period
- `PATCH /restaurant-panel/facturacion/:id` - Update settlement status when payment proof uploaded

---

## 🧪 Testing Procedures

### Test 1: Force Manual Billing Cut
**Purpose**: Verify settlements are created correctly

```bash
# Using cURL
curl -X POST http://localhost:3001/admin/billing/force-settle/{restaurantId} \
  -H "Authorization: Bearer {adminToken}" \
  -H "Content-Type: application/json"

# Expected Response
{
  "success": true,
  "message": "Corte forzado para {restaurantName}",
  "data": {
    "id": "...",
    "restaurantId": "...",
    "amount": 0 or any_number,  // Should work even with $0
    "status": "PENDING",
    "periodStart": "2026-06-01T...",
    "periodEnd": "2026-06-08T...",
    "createdAt": "2026-06-08T..."
  }
}
```

### Test 2: View Recently Created Settlements
**Purpose**: Verify settlements appear in restaurant billing panel

```bash
curl -X GET http://localhost:3001/restaurant-panel/facturacion \
  -H "Authorization: Bearer {restaurantToken}"

# Expected Response - recentSettlements should include newly created settlement
{
  "success": true,
  "data": {
    "currentDebt": 0,
    "deliveredRevenue": 0,
    "serviceFeeRevenue": 0,
    "platformFeeRevenue": 0,
    "deliveredOrders": 0,
    "platformFeeRate": 0.05,
    "billingCycle": "WEEKLY",
    "periodStart": "...",
    "periodEnd": "...",
    "nextChargeDate": "...",
    "recentSettlements": [
      {
        "id": "...",
        "restaurantId": "...",
        "amount": 0,  // THIS SHOULD APPEAR EVEN IF $0
        "status": "PENDING",
        "reference": "SETTLE-{restaurantId}-2026-6-8",
        "periodStart": "...",
        "periodEnd": "...",
        "createdAt": "..." // NOW ORDERED BY THIS
      }
    ]
  }
}
```

### Test 3: Zero-Amount Settlements
**Purpose**: Verify $0 settlements are handled correctly

1. Create a new restaurant with no delivered orders
2. Force a billing cut: `POST /admin/billing/force-settle/{newRestaurantId}`
3. Verify response shows `amount: 0`
4. Fetch restaurant panel: `GET /restaurant-panel/facturacion`
5. Verify settlement appears in `recentSettlements` with `amount: 0`

### Test 4: Settlement Status Workflow
**Purpose**: Verify status transitions work correctly

```bash
# Step 1: Settlement starts as PENDING
POST /admin/billing/force-settle/{restaurantId}
# Response: status: "PENDING"

# Step 2: Restaurant uploads payment proof
PATCH /restaurant-panel/facturacion/{settlementId}
Body: { status: "IN_REVIEW" }
# Response: status: "IN_REVIEW"

# Step 3: Admin marks as PAID
PATCH /admin/billing/settlements/{settlementId}
Body: { status: "PAID", settledAt: "2026-06-08T12:00:00Z" }
# Response: status: "PAID"
```

### Test 5: List Admin Settlements
**Purpose**: Verify admin can view all settlements

```bash
curl -X GET "http://localhost:3001/admin/billing/settlements?limit=20&page=1" \
  -H "Authorization: Bearer {adminToken}"

# Expected Response
{
  "success": true,
  "data": {
    "settlements": [
      {
        "id": "...",
        "restaurantId": "...",
        "restaurant": {
          "id": "...",
          "name": "...",
          "email": "..."
        },
        "amount": 0 or any_number,
        "status": "PENDING|IN_REVIEW|PAID|OVERDUE",
        "createdAt": "..."
      }
    ],
    "pagination": {
      "total": 10,
      "page": 1,
      "limit": 20,
      "pages": 1
    }
  }
}
```

---

## 🔍 Key Fixes Applied

### Fix 1: Query Ordering Issue
**File**: `packages/backend/src/routes/restaurant-panel.routes.ts` (Line 180)

**Before**:
```typescript
orderBy: { settledAt: 'desc' },
take: 6
```

**After**:
```typescript
orderBy: { createdAt: 'desc' },
take: 50
```

**Reason**: Newly created settlements have `settledAt = null`, so they never appeared. Ordering by `createdAt` ensures all settlements are shown, even if not yet marked as settled/paid.

---

## 📊 Database Schema

### RestaurantBillingSettlement Model
```prisma
model RestaurantBillingSettlement {
  id                   String   @id @default(cuid())
  restaurantId         String
  billingCycle         BillingCycle
  status               String   @default("PENDING") // PENDING | IN_REVIEW | PAID | OVERDUE
  periodStart          DateTime
  periodEnd            DateTime
  dueDate              DateTime
  deliveredOrders      Int      @default(0)
  deliveredRevenue     Float    @default(0)
  amount               Float    @default(0)        // Can be 0
  serviceFeeTotal      Float    @default(0)
  platformFeeTotal     Float    @default(0)
  settledAt            DateTime?                   // NULL until marked as paid
  feeRate              Float
  reference            String   @unique           // SETTLE-{restaurantId}-{year}-{month}-{date}
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  restaurant           Restaurant @relation(fields: [restaurantId], references: [id])

  @@index([restaurantId])
  @@index([settledAt])
  @@index([status])
}
```

---

## 🚀 Deployment Checklist

- [ ] All tests pass (T1-T5)
- [ ] Zero-amount settlements work correctly
- [ ] Settlement ordering displays newest first
- [ ] Status transitions (PENDING → IN_REVIEW → PAID) work
- [ ] Admin endpoints are secured (auth verified)
- [ ] Frontend displays all settlements in history
- [ ] Cron job runs correctly at scheduled time
- [ ] No TypeScript errors in build

---

## 📝 Notes

- Cron job runs: **Every Sunday at 23:59 UTC**
- Duplicate prevention: Uses unique `reference` field
- Rate limiting: May be applied to admin endpoints
- Error handling: All endpoints include proper error responses

---

## 🔧 Useful Commands

```bash
# Check billing settlements in database
npm run prisma -- query
# SELECT * FROM "RestaurantBillingSettlement" ORDER BY "createdAt" DESC LIMIT 10;

# View job logs (in development)
docker logs -f sadel-backend-1 | grep BillingJob

# Force settlement manually
curl -X POST http://localhost:3001/admin/billing/force-settle/{restaurantId}

# View restaurant billing summary
curl -X GET http://localhost:3001/restaurant-panel/facturacion
```
