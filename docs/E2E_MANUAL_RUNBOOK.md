# E2E Manual Runbook

## Objective

Validate the real user flow across:

1. `web-customer`
2. `web-restaurant`
3. `web-driver`
4. `web-admin` as supporting control panel

The goal is to catch friction that automated tests do not cover:

- visual clarity
- confusing copy
- broken transitions
- missing feedback
- operational dead-ends

## Preconditions

1. PostgreSQL running on `localhost:5432`
2. Redis running on `localhost:6379`
3. Backend running on `http://localhost:3001`
4. Frontends running:
   - Admin: `http://localhost:3000`
   - Restaurant: `http://localhost:3002`
   - Customer: `http://localhost:3003`
   - Driver: `http://localhost:3004`
5. `.env.local` contains:

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
NODE_ENV=development
```

## Quality Gate Before Manual QA

Run these commands first:

```bash
npm run verify:web
npm run verify:flow
npm run verify:backend
```

## Latest Validation

- Date: `2026-04-18 16:42 CST`
- Result: manual E2E flow validated successfully in local environment.
- Scope covered: `web-customer` -> `web-restaurant` -> `web-driver` -> `web-admin`.
- Verified transitions: order creation, restaurant acceptance, preparation, ready for pickup, driver delivery flow, and final delivered state reflected in customer/admin views.

## Manual Flow

### 1. Customer creates order

Open `http://localhost:3003`.

1. Request OTP with a customer phone.
2. If backend is in development, use the `mockCode` shown by the API response.
3. Log in.
4. Select a restaurant.
5. Add at least one product.
6. Complete delivery address.
7. Submit the order.

Expected:

- clear success feedback
- order appears in history
- tracking panel opens correctly

### 2. Restaurant accepts and prepares

Open `http://localhost:3002`.

1. Request OTP with a restaurant user phone.
2. Log in.
3. Open the active order.
4. Accept the order.
5. Move it to preparation.
6. Mark it as ready.
7. Assign a driver if the restaurant does not use own delivery.

Expected:

- visible action feedback
- order status updates without confusion
- customer tracking reflects changes

### 3. Driver completes delivery

Open `http://localhost:3004`.

1. Request OTP with a driver phone.
2. Log in.
3. Set availability to `Conectado` if needed.
4. Accept assigned order.
5. Mark as picked up.
6. Mark as in transit.
7. Mark as delivered.

Expected:

- active order actions appear in the right sequence
- history updates after delivery
- customer sees delivered state

### 4. Admin verification

Open `http://localhost:3000`.

1. Log in as admin.
2. Search the restaurant involved in the flow.
3. Verify detail data renders correctly.
4. Test one safe administrative edit.

Expected:

- list filters work
- selected restaurant detail stays in sync
- edit feedback is clear

## What To Watch For

- Buttons that do not communicate disabled/loading states
- Sections that feel visually denser than the rest of the system
- Error messages that are too technical
- Data that looks fake or inconsistent
- Any step where the next action is not obvious
- Any socket update that appears late or not at all

## Environment Notes

This runbook depends on local infrastructure being available at execution time:

- PostgreSQL on `localhost:5432`
- Redis on `localhost:6379`
- Backend on `http://localhost:3001`
- Frontends on ports `3000`, `3002`, `3003`, and `3004`

If any of those services are unavailable, manual QA may be blocked until the local environment is restored.
