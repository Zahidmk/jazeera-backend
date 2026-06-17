# Jazeera Storekeeper & Driver Stock Load API Guide

This document describes the API endpoints and workflow for the **Storekeeper Mobile App** and the **Driver Confirmation Flow** for stock loading.

---

## Complete Stock Loading Workflow

```mermaid
sequenceDiagram
    autonumber
    actor Driver as Driver App
    actor Storekeeper as Storekeeper App
    participant API as Backend API
    participant DB as Database / Odoo

    Driver->>API: 1. POST /shift/start (starts active shift on a van)
    Storekeeper->>API: 2. GET /storekeeper/vans (views active driver & shift)
    Storekeeper->>API: 3. POST /storekeeper/vans/:vanId/load (submits load, status PENDING)
    Driver->>API: 4. GET /driver/stock/queue (views pending assigned stock)
    
    alt Driver Accepts Load
        Driver->>API: 5a. POST /driver/stock/confirm (accepts load)
        API->>DB: Updates VanInventory & Triggers Odoo Transfer picking
        API-->>Driver: Success, stock added to van
    else Driver Rejects Load
        Driver->>API: 5b. POST /driver/stock/reject (rejects load with optional notes)
        API-->>Driver: Status updated to REJECTED (no inventory change)
        Storekeeper->>API: 6. GET /storekeeper/vans/:vanId/queue (views REJECTED status and notes)
        Storekeeper->>API: 7. POST /storekeeper/vans/:vanId/load (overwrites rejected list with new correct list)
    end
```

---

## 1. Authentication
Both the Storekeeper and Driver log in using the same authentication endpoint.

* **Endpoint**: `POST /api/v1/auth/login`
* **Request Body**:
  ```json
  {
    "email": "storekeeper@jazeera.com",
    "password": "password123"
  }
  ```
* **Response**:
  ```json
  {
    "success": true,
    "data": {
      "token": "eyJhbGciOi...",
      "user": {
        "id": "abc-123-uuid",
        "name": "Warehouse Lead",
        "email": "storekeeper@jazeera.com",
        "role": "STORE_KEEPER"
      }
    }
  }
  ```

---

## 2. Storekeeper App Endpoints

All storekeeper endpoints require the bearer token in the `Authorization` header and are restricted to users with roles `STORE_KEEPER`, `ADMIN`, or `MANAGER`.

### A. List Vans
Used to list all active vans in the depot. If a van has an active driver/shift, the details are populated.

* **Method**: `GET`
* **Endpoint**: `/api/v1/storekeeper/vans`
* **Response**:
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "van-uuid-111",
        "plateNumber": "DXB-A-12345",
        "model": "Toyota HiAce",
        "isActive": true,
        "activeDriver": {
          "id": "driver-uuid-222",
          "name": "Ahmed Al-Rashid"
        },
        "activeShift": {
          "id": "shift-uuid-333",
          "startedAt": "2026-06-17T09:00:00.000Z"
        }
      }
    ]
  }
  ```

### B. Get Van Queue Status
Get the real-time status of the items assigned to a van for the active shift.

* **Method**: `GET`
* **Endpoint**: `/api/v1/storekeeper/vans/:vanId/queue`
* **Response**:
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "queue-item-uuid",
        "shiftId": "shift-uuid-333",
        "productId": "product-uuid-444",
        "quantity": 25,
        "confirmed": false,
        "status": "PENDING",
        "notes": null,
        "scannedAt": "2026-06-17T09:05:00.000Z",
        "product": {
          "id": "product-uuid-444",
          "name": "Mineral Water 500ml",
          "sku": "WAT-500",
          "unit": "pcs",
          "imageUrl": null
        }
      }
    ],
    "meta": {
      "driver": {
        "id": "driver-uuid-222",
        "name": "Ahmed Al-Rashid"
      },
      "shiftId": "shift-uuid-333"
    }
  }
  ```

### C. Assign Van Load
Assign/send a stock load to a van. 
> **Important**: This endpoint transactionally overwrites/deletes any unconfirmed (`PENDING` or `REJECTED`) items for the current active shift and sets the new list as `PENDING`. It will block submission if items have already been accepted/confirmed.

* **Method**: `POST`
* **Endpoint**: `/api/v1/storekeeper/vans/:vanId/load`
* **Request Body**:
  ```json
  {
    "products": [
      {
        "productId": "product-uuid-444",
        "quantity": 50
      }
    ]
  }
  ```
* **Response**:
  ```json
  {
    "success": true,
    "message": "Stock load assigned successfully"
  }
  ```

---

## 3. Driver App Endpoints

### A. Get Stock Queue (Pending Load)
Fetch the pending items loaded by the storekeeper to display to the driver.

* **Method**: `GET`
* **Endpoint**: `/api/v1/driver/stock/queue`
* **Response**: Same array structure as the storekeeper queue list (only returns unconfirmed items).

### B. Confirm Stock Load (Accept)
Confirm and accept the stock load list. This increments the van's inventory and pushes the transfer Picking to Odoo.

* **Method**: `POST`
* **Endpoint**: `/api/v1/driver/stock/confirm`
* **Response**:
  ```json
  {
    "success": true,
    "message": "1 items loaded into van successfully"
  }
  ```

### C. Reject Stock Load
Reject the stock load assignment (e.g., if quantities in the van don't match the list). This moves the queue items to `REJECTED` status so the storekeeper can correct it.

* **Method**: `POST`
* **Endpoint**: `/api/v1/driver/stock/reject`
* **Request Body**:
  ```json
  {
    "notes": "Quantity is incorrect, only received 40 instead of 50"
  }
  ```
* **Response**:
  ```json
  {
    "success": true,
    "message": "Stock load rejected successfully"
  }
  ```

### D. Get Van Inventory
View current stocks loaded inside the van.

* **Method**: `GET`
* **Endpoint**: `/api/v1/driver/van/inventory`
* **Response**:
  ```json
  {
    "success": true,
    "data": {
      "van": {
        "id": "van-uuid-111",
        "plateNumber": "DXB-A-12345"
      },
      "items": [
        {
          "id": "inventory-item-uuid",
          "productId": "product-uuid-444",
          "quantity": 50,
          "name": "Mineral Water 500ml",
          "sku": "WAT-500",
          "unit": "pcs",
          "priceRetail": 1.5,
          "imageUrl": null
        }
      ],
      "totalItems": 1,
      "totalUnits": 50
    }
  }
  ```

---

## Sharing & Testing Steps

1. **Share the Postman Collection**:
   - Provide the file [jazeera-storekeeper.postman_collection.json](file:///c:/Users/Zahid/OneDrive/Desktop/syg/jazeera-backend/jazeera-storekeeper.postman_collection.json) to the developer.
   - They can import this directly in Postman (`File -> Import`).
2. **Setup Environments in Postman**:
   - Set the `base_url` variable to match the deployed server or local server (e.g., `http://localhost:3000`).
   - Run the login endpoints to retrieve tokens, and paste them into variables `storekeeper_jwt_token` and `driver_jwt_token`.
3. **Execute Flow**:
   - The developer can follow the Sequence Diagram workflow to verify step-by-step functionality.
