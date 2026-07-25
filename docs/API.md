# API Documentation

## Base URL
```
Development: http://localhost:3001
Production: https://api.sadel.app
```

## Authentication

All endpoints (except `/auth/register` and `/auth/login`) require JWT token in Authorization header:

```
Authorization: Bearer <token>
```

## Status Codes

- `200 OK`: Successful request
- `201 Created`: Resource created successfully
- `400 Bad Request`: Invalid parameters
- `401 Unauthorized`: Missing or invalid token
- `403 Forbidden`: Insufficient permissions
- `404 Not Found`: Resource not found
- `429 Too Many Requests`: Rate limited
- `500 Internal Server Error`: Server error

## Error Response Format

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable error message",
    "details": {}
  }
}
```

## Success Response Format

```json
{
  "success": true,
  "data": {}
}
```

## Pagination

Endpoints returning lists support pagination:

```
GET /endpoint?page=1&limit=10&sortBy=createdAt&sortOrder=desc
```

Response includes:

```json
{
  "items": [],
  "total": 100,
  "page": 1,
  "limit": 10,
  "hasMore": true
}
```

## Endpoints

### Authentication

#### Register
```
POST /auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securepassword",
  "name": "John Doe",
  "phone": "+1234567890",
  "role": "CUSTOMER",
  "region": "region-code"
}

Response:
{
  "success": true,
  "data": {
    "id": "user-id",
    "email": "user@example.com",
    "token": "jwt-token"
  }
}
```

#### Login
```
POST /auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securepassword"
}

Response:
{
  "success": true,
  "data": {
    "token": "jwt-token",
    "refreshToken": "refresh-token"
  }
}
```

### Restaurants

#### Get Restaurants
```
GET /restaurants?page=1&limit=10&region=region-id&search=name

Response:
{
  "items": [
    {
      "id": "restaurant-id",
      "name": "Restaurant Name",
      "description": "Description",
      "address": "Address",
      "rating": 4.5,
      "minDeliveryTime": 30,
      "maxDeliveryTime": 60
    }
  ],
  "total": 50,
  "page": 1,
  "hasMore": true
}
```

#### Get Restaurant Details
```
GET /restaurants/:id

Response:
{
  "id": "restaurant-id",
  "name": "Restaurant Name",
  "categories": [
    {
      "id": "category-id",
      "name": "Category",
      "products": [
        {
          "id": "product-id",
          "name": "Product",
          "price": 10.99,
          "description": "Description"
        }
      ]
    }
  ]
}
```

### Orders

#### Create Order
```
POST /orders
Authorization: Bearer <token>
Content-Type: application/json

{
  "restaurantId": "restaurant-id",
  "items": [
    {
      "productId": "product-id",
      "quantity": 2,
      "specialInstructions": "No onions"
    }
  ],
  "deliveryAddress": {
    "street": "123 Main St",
    "number": "123",
    "neighborhood": "Downtown",
    "city": "City",
    "state": "State",
    "zipCode": "12345"
  },
  "paymentMethod": "CASH"
}

Response:
{
  "success": true,
  "data": {
    "id": "order-id",
    "orderReference": "SAD-XXXXX-XXXXX",
    "totalAmount": 45.99,
    "status": "PENDING"
  }
}
```

#### Get Order Status
```
GET /orders/:id
Authorization: Bearer <token>

Response:
{
  "id": "order-id",
  "status": "IN_TRANSIT",
  "items": [...],
  "driver": {
    "name": "Driver Name",
    "phone": "1234567890",
    "latitude": 40.7128,
    "longitude": -74.0060
  },
  "estimatedDeliveryTime": "2024-01-20T15:30:00Z"
}
```

### Drivers

#### Get Available Drivers
```
GET /drivers/available?region=region-id&latitude=40.7128&longitude=-74.0060
Authorization: Bearer <token>

Response:
{
  "items": [
    {
      "id": "driver-id",
      "name": "Driver Name",
      "rating": 4.8,
      "totalDeliveries": 150,
      "availability": "AVAILABLE"
    }
  ]
}
```

#### Update Location
```
PATCH /drivers/:id/location
Authorization: Bearer <token>
Content-Type: application/json

{
  "latitude": 40.7128,
  "longitude": -74.0060
}

Response:
{
  "success": true
}
```

### Admin

#### Get Dashboard Stats
```
GET /admin/stats?region=region-id&startDate=2024-01-01&endDate=2024-01-31
Authorization: Bearer <token>

Response:
{
  "totalOrders": 1250,
  "totalRevenue": 45000.00,
  "totalUsers": 5000,
  "activeRestaurants": 125,
  "activeDrivers": 450
}
```

#### Get Restaurants List
```
GET /admin/restaurants?page=1&limit=20&status=ACTIVE
Authorization: Bearer <token>

Response:
{
  "items": [
    {
      "id": "restaurant-id",
      "name": "Restaurant",
      "owner": "Owner Name",
      "totalOrders": 250,
      "totalRevenue": 5000.00,
      "status": "ACTIVE"
    }
  ],
  "total": 150,
  "page": 1,
  "hasMore": true
}
```

---

**For complete API documentation, see OpenAPI specification (coming soon)**
