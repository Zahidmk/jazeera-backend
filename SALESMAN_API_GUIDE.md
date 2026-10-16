# Jazeera Salesman Mobile Application - API Integration Guide

This guide describes the REST API endpoints provided by the backend to support the salesman mobile application. All requests and responses communicate via JSON payloads.

---

## 🔒 Authentication & Headers

Except for the Login route, all routes require a JSON Web Token (JWT) sent in the HTTP headers:
```http
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json
```

---

## 🔑 1. Authentication Endpoints

### **Salesman / User Login**
Authenticates the user and returns the JWT access token and user profile details.
* **Endpoint**: `/api/v1/auth/login`
* **Method**: `POST`
* **Request Body**:
  ```json
  {
    "email": "salesman@jazeera.com",
    "password": "password123"
  }
  ```
* **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "data": {
      "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOi...",
      "user": {
        "id": "2d1f9254-6e01-4440-97b8-69a2e0ebe34d",
        "name": "Tarek Mansoor",
        "email": "salesman@jazeera.com",
        "phone": "+971503334444",
        "role": "SALESMAN"
      }
    }
  }
  ```

---

## 📄 2. B2B Quotations Management

### **Create a Quotation (Draft)**
Creates a new draft quotation for a customer. 
* **Endpoint**: `/api/v1/salesman/quotations`
* **Method**: `POST`
* **Request Body**:
  ```json
  {
    "customerId": "5ea8986a-30a8-43db-a3b9-dbc47acff0d1", 
    "remarks": "Negotiating bulk water order discount",
    "items": [
      {
        "productId": "24589969-85e9-426a-8777-887e7ffd17a2",
        "quantity": 50,
        "unitPrice": 1.50,
        "requestedPrice": 1.20,
        "discountPct": 0,
        "suggestedMode": true
      }
    ]
  }
  ```
* **Success Response (201 Created)**:
  ```json
  {
    "success": true,
    "data": {
      "id": "1b80e503-2639-401f-aa25-174162ffda54",
      "salesmanId": "2d1f9254-6e01-4440-97b8-69a2e0ebe34d",
      "customerId": "5ea8986a-30a8-43db-a3b9-dbc47acff0d1",
      "status": "DRAFT",
      "totalAmount": 60.00,
      "remarks": "Negotiating bulk water order discount",
      "pdfUrl": null,
      "createdAt": "2026-06-13T13:30:00.000Z",
      "items": [
        {
          "id": "item-uuid",
          "productId": "24589969-85e9-426a-8777-887e7ffd17a2",
          "quantity": 50,
          "unitPrice": 1.50,
          "requestedPrice": 1.20,
          "discountPct": 0,
          "suggestedMode": true,
          "product": {
            "id": "24589969-85e9-426a-8777-887e7ffd17a2",
            "name": "Mineral Water 500ml",
            "sku": "WAT-500",
            "unit": "pcs"
          }
        }
      ]
    }
  }
  ```

---

### **List My Quotations**
Retrieves quotations made by the logged-in salesman.
* **Endpoint**: `/api/v1/salesman/quotations`
* **Method**: `GET`
* **Query Parameters (Optional)**:
  * `status`: Filter by `DRAFT`, `SUBMITTED`, `APPROVED`, or `REJECTED`.
  * `customerId`: Filter by customer UUID.
* **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "1b80e503-2639-401f-aa25-174162ffda54",
        "status": "DRAFT",
        "totalAmount": 60.00,
        "createdAt": "2026-06-13T13:30:00.000Z",
        "customer": {
          "id": "5ea8986a-30a8-43db-a3b9-dbc47acff0d1",
          "name": "Al Madina Supermarket"
        }
      }
    ]
  }
  ```

---

### **Get Quotation Details**
Retrieves itemized details for a specific quotation.
* **Endpoint**: `/api/v1/salesman/quotations/:id`
* **Method**: `GET`
* **Success Response (200 OK)**: Returns the detailed quotation JSON containing all fields (including manager rejection reasons if the quotation status is `REJECTED`, or `pdfUrl` if status is `APPROVED`).

---

### **Edit/Update Quotation**
Allows editing of items, quantities, and pricing overrides.
* **Endpoint**: `/api/v1/salesman/quotations/:id`
* **Method**: `PUT`
* **Note**: Can only be updated if current status is `"DRAFT"` or `"REJECTED"`.
* **Request Body**: Same schema as *Create a Quotation*.

---

### **Submit Quotation for Manager Review**
Submits the draft quotation to the office manager/admin. Transitions status to `"SUBMITTED"`.
* **Endpoint**: `/api/v1/salesman/quotations/:id/submit`
* **Method**: `POST`
* **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "message": "Quotation submitted successfully for manager approval",
    "data": {
      "id": "1b80e503-2639-401f-aa25-174162ffda54",
      "status": "SUBMITTED"
    }
  }
  ```

---

## 📍 3. Customer Visits Tracking

### **Log Customer Visit**
Logs salesman check-ins at client shops with notes and location logs.
* **Endpoint**: `/api/v1/salesman/visits`
* **Method**: `POST`
* **Request Body**:
  ```json
  {
    "customerId": "5ea8986a-30a8-43db-a3b9-dbc47acff0d1",
    "notes": "Met with shop manager, introduced upcoming juices inventory line.",
    "latitude": 25.0754,
    "longitude": 55.1887
  }
  ```
* **Success Response (201 Created)**:
  ```json
  {
    "success": true,
    "data": {
      "id": "76af3e1f-f99f-4440-97b8-69a2e0ebe34d",
      "salesmanId": "2d1f9254-6e01-4440-97b8-69a2e0ebe34d",
      "customerId": "5ea8986a-30a8-43db-a3b9-dbc47acff0d1",
      "notes": "Met with shop manager, introduced upcoming juices inventory line.",
      "lat": 25.0754,
      "lng": 55.1887,
      "visitedAt": "2026-06-13T13:40:00.000Z"
    }
  }
  ```

---

### **List Logged Visits**
Retrieves the history of all visits logged by the salesman.
* **Endpoint**: `/api/v1/salesman/visits`
* **Method**: `GET`
* **Success Response (200 OK)**: Returns array of visits containing notes and coordinates.

---

## 🛍️ 4. Customers & Products Listing

### **List Customers**
Retrieves a list of customers with optional search and pagination.
* **Endpoint**: `/api/v1/salesman/customers`
* **Method**: `GET`
* **Query Parameters (Optional)**:
  * `q` / `search`: Query string to filter by name, phone, or address (case-insensitive).
  * `page`: Page number (default: `1`).
  * `limit`: Number of items per page (default: `20`).
* **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "5ea8986a-30a8-43db-a3b9-dbc47acff0d1",
        "odooId": 142,
        "name": "Al Madina Supermarket",
        "phone": "+971505556666",
        "email": "madina@example.com",
        "address": "Al Barsha, Dubai, UAE",
        "lat": 25.1124,
        "lng": 55.2001,
        "createdAt": "2026-06-13T10:00:00.000Z",
        "updatedAt": "2026-06-13T10:00:00.000Z"
      }
    ],
    "meta": {
      "total": 1,
      "page": 1,
      "limit": 20,
      "totalPages": 1
    }
  }
  ```

---

### **List Products**
Retrieves a list of active products with optional search, category filter, and pagination.
* **Endpoint**: `/api/v1/salesman/products`
* **Method**: `GET`
* **Query Parameters (Optional)**:
  * `q` / `search`: Query string to filter by product name, Arabic name, SKU, or barcode (case-insensitive).
  * `category`: Filter by product category name (e.g. `Water`).
  * `customerId`: Customer UUID. **Pass this whenever you are quoting for a shop** — each row then also carries `customerPrice`, the price that shop last paid under its own Odoo pricelist. See [CUSTOMER_PRICING.md](./CUSTOMER_PRICING.md).
  * `page`: Page number (default: `1`).
  * `limit`: Number of items per page (default: `20`).
* **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "24589969-85e9-426a-8777-887e7ffd17a2",
        "odooId": 32,
        "sku": "WAT-500",
        "name": "Mineral Water 500ml",
        "nameAr": "مياه معدنية 500 مل",
        "category": "Water",
        "unit": "pcs",
        "priceRetail": 1.50,
        "priceWhole": 1.00,
        "barcode": "6291011121314",
        "imageUrl": "data:image/png;base64,...",
        "isActive": true,

        "customerPrice": 1.25,
        "priceSource": "CUSTOMER_LAST_SALE",
        "lastSaleDate": "2026-10-11 14:35:48"
      }
    ],
    "meta": {
      "total": 1,
      "page": 1,
      "limit": 20,
      "totalPages": 1,
      "customerId": "a1b2c3d4-..."
    }
  }
  ```
* **Note**: `customerPrice`, `priceSource` and `lastSaleDate` appear **only when `customerId` was passed**. Show `customerPrice` as the selling price; `priceRetail` stays the catalogue price. `priceSource` is `CUSTOMER_LAST_SALE` when the price came from that shop's history, or `LIST` when it fell back to the catalogue price.

