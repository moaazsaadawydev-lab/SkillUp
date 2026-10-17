# 🚀 SkillUp (SkillHub) — Cloud-Native Microservices Platform

**SkillUp** is an enterprise-grade, high-performance educational platform architected as a distributed microservices system inside an **Nx Monorepo** powered by **NestJS** and **TypeScript**. Designed from the ground up for extreme **scalability**, fault tolerance, and hardened security, the platform adheres to modern distributed systems design principles including **gRPC inter-service communication**, **Event-Driven Architecture (EDA)**, **Transactional Outbox Pattern**, **Direct-to-Storage Upload Pattern (Presigned URLs)**, and **Database-per-Service**.

---

## 📑 Table of Contents
1. [System Architecture](#1-system-architecture)
2. [Microservices & Infrastructure Inventory](#2-microservices--infrastructure-inventory)
3. [Architectural Design Patterns](#3-architectural-design-patterns)
4. [Direct-to-Storage & Media Pipeline](#4-direct-to-storage--media-pipeline)
5. [Security & Abuse Prevention Architecture](#5-security--abuse-prevention-architecture)
6. [API Reference (Implemented Endpoints)](#6-api-reference-implemented-endpoints)
7. [Roadmap & Implementation Progress](#7-roadmap--implementation-progress)
8. [Local Setup & Deployment](#8-local-setup--deployment)
9. [Developer Tooling: Octa Workspace](#9-developer-tooling-octa-workspace)

---

## 1. System Architecture

The system decouples edge networking, core business logic, asynchronous background tasks, and high-speed in-memory state:
- **API Gateway:** The single entrypoint handling edge HTTP/REST traffic, cookie management, pure JSON request validation, and internal gRPC routing. Zero file buffers pass through the gateway.
- **Internal Services:** Inter-service communication is powered by **gRPC over HTTP/2 with Protocol Buffers**, minimizing network serialization overhead and latency.
- **Direct-to-Storage Ingestion:** Clients upload heavy multimedia directly to **MinIO (S3)** via short-lived, cryptographically signed **Presigned URLs**, offloading heavy I/O and RAM consumption from application servers.
- **Asynchronous Event Pipeline:** Long-running, compute-heavy, and network I/O operations (image smart cropping/resizing and email dispatch) are completely decoupled through **RabbitMQ** and the **Transactional Outbox Pattern**.
- **In-Memory Cache & Session Layer:** **Redis** handles ephemeral state: cryptographic OTP hashes, rate limiters, abuse prevention locks, and active multi-device sessions.

```mermaid
flowchart TB
    subgraph ClientLayer ["Clients & Developer Tools"]
        Client["Web / Mobile Applications"]
        Octa["Octa Workspace Client"]
    end

    subgraph GatewayLayer ["Edge API Gateway (Port 3000)"]
        Gateway["NestJS API Gateway<br/>REST • Pure JSON • ValidationPipes • CookieParser"]
    end

    subgraph ServiceLayer ["Microservices Ecosystem (gRPC & HTTP)"]
        UsersSvc["Users Service (:3001 / :50051)<br/>Identity, Auth & Outbox Engine"]
        MediaSvc["Media Service (:3006 / :50056)<br/>Presigned URLs • Sharp Smart Image Processing"]
        NotifSvc["Notifications Service (:3005 / :50055)<br/>Nodemailer & Handlebars Dispatcher"]
        CatalogSvc["Catalog Service (:3002)<br/>Courses & Curriculum (Scaffold)"]
        BookingSvc["Booking Service (:3003)<br/>Reservations & Slots (Scaffold)"]
        PaymentSvc["Payment Service (:3004)<br/>Billing & Saga Orchestration (Scaffold)"]
    end

    subgraph BrokerLayer ["Asynchronous Message Broker"]
        RabbitMQ["RabbitMQ (Port 5672 / 15672)<br/>Exchange: skillhub.events (Topic)"]
    end

    subgraph DataLayer ["Persistence & State Layer"]
        Postgres[("PostgreSQL 16 (Port 5433)<br/>Database-per-Service: users, catalog, booking, payment")]
        Redis[("Redis 7 (Port 6379)<br/>Sessions • OTP Hashes • Lockout Counters")]
        MinIO[("MinIO Object Storage (Port 9000 / 9001)<br/>S3-Compatible Bucket: skillhub-media")]
    end

    %% Client Traffic
    Client -->|"1. POST /media/avatar/upload-url"| Gateway
    Client -->|"2. PUT Binary Stream"| MinIO
    Client -->|"3. POST /users/auth/register (JSON)"| Gateway
    Octa -->|"HTTP / REST"| Gateway
    Octa -->|"PUT Binary Stream"| MinIO

    %% Gateway Routing
    Gateway -->|"gRPC :50056 (GetPresignedUrl / CheckFile)"| MediaSvc
    Gateway -->|"gRPC :50051 (CreateUser)"| UsersSvc
    Gateway -->|"gRPC :50052"| CatalogSvc
    Gateway -->|"gRPC :50053"| BookingSvc
    Gateway -->|"gRPC :50054"| PaymentSvc

    %% Users Service Interactions
    UsersSvc -->|"TypeORM Transactions"| Postgres
    UsersSvc -->|"In-Memory State & Rate Limiting"| Redis
    UsersSvc -->|"Publish Outbox Events"| RabbitMQ

    %% Async Consumers
    RabbitMQ -->|"Event: media.photo.process"| MediaSvc
    RabbitMQ -->|"Event: user.verification.email"| NotifSvc

    %% Media Processing
    MediaSvc -->|"Fetch Raw Temp & Store Final WebP"| MinIO
```

---

## 2. Microservices & Infrastructure Inventory

### A. Application Services
| Service | Stack & Protocols | Responsibilities | Current Status |
| :--- | :--- | :--- | :---: |
| **API Gateway** | NestJS, Express, gRPC Client, Class-Validator | Public REST API, global exception filters, strict JSON validation pipes, cookie parsing, gRPC client dispatch. Zero Multer/buffer dependencies. | **Active & Production-Ready** |
| **Users Service** | NestJS, TypeORM, gRPC Server, Redis | User identity lifecycle, bcrypt hashing, dual-token generation, multi-device session management, Transactional Outbox engine. | **Active & Production-Ready** |
| **Media Service** | NestJS, gRPC Server, Sharp, MinIO S3 SDK, RabbitMQ | Dual interface: **gRPC** for presigned URLs & file verification; **RabbitMQ Consumer** for asynchronous image smart-cropping, WebP optimization, and temp file purges. | **Active & Production-Ready** |
| **Notifications Service** | NestJS, Nodemailer, Handlebars, RabbitMQ | Consumes email events, compiles Handlebars email templates, handles SMTP dispatch with retry logic. | **Active & Production-Ready** |
| **Catalog Service** | NestJS, gRPC | Educational course catalog, lessons, curriculum structure, search index. | Skeleton Scaffold |
| **Booking Service** | NestJS, gRPC | Course seat reservations, schedule locks, concurrency control. | Skeleton Scaffold |
| **Payment Service** | NestJS, gRPC | Payment gateways, transaction outbox, distributed Saga compensation. | Skeleton Scaffold |

### B. Backing Infrastructure
- **PostgreSQL 16 (Alpine):** Isolated databases per service: `skillhub_users`, `skillhub_catalog`, `skillhub_booking`, `skillhub_payment`.
- **Redis 7 (Alpine):** In-memory session hashes, token revocation, OTP cryptographic hashes, rate limiting, and 15-minute lockouts.
- **RabbitMQ 3 (Management Alpine):** Reliable AMQP topic exchange (`skillhub.events`) with durable queues and acknowledgments.
- **MinIO Object Storage:** Self-hosted S3-compatible storage cluster with public read policy for published media (`avatars/*`), private staging (`temp_uploads/*`), and automated ILM lifecycle auto-expiration.

---

## 3. Architectural Design Patterns

### 1. Transactional Outbox Pattern
* **The Problem:** In distributed architectures, updating a relational database and publishing an event to a message broker within the same execution cycle creates a dual-write problem. If the message broker is unreachable, the event is lost.
* **The Solution:** The user entity and the event payload are written atomically to `users` and `outbox_messages` tables inside a single database transaction (`queryRunner`).
* A background `OutboxWorker` reads pending messages, publishes them to RabbitMQ, and marks them as `PUBLISHED` only after acknowledgment, guaranteeing **At-Least-Once Delivery**.

### 2. Direct-to-Storage Upload Pattern (Presigned URLs)
* **The Problem:** Uploading media files (avatars, course videos, attachments) through an API Gateway causes server memory bloat, high CPU utilization during multipart parsing (Multer), and network bottlenecks that degrade API response times.
* **The Solution:**
  1. The client requests a cryptographically signed PUT URL from `POST /api/v1/media/avatar/upload-url`.
  2. The client streams the raw binary file directly to MinIO Object Storage under `temp_uploads/avatars/{uuid}_{filename}`.
  3. The client submits a pure JSON registration payload containing `tempPhotoKey`.
  4. The API Gateway verifies the file exists via high-speed gRPC (`CheckFileExists`) without loading the image buffer into memory.

### 3. Distributed Multi-Device Session Management
* Active sessions are tracked inside Redis Hash structures: `session:{sessionId}` containing:
  - `userId`
  - `hashedRefreshToken` (SHA-256)
  - `ipAddress`
  - `userAgent`
  - `createdAt`
* Every user maintains a **Redis Sorted Set** (`user_sessions:{userId}`) storing timestamps as scores.
* The system enforces a strict **maximum of 5 active devices/sessions** per user. When a 6th session is registered, the oldest session is automatically purged from Redis.

---

## 4. Direct-to-Storage & Media Pipeline

```
[Client]                      [Gateway]                    [Media Service]                    [MinIO Storage]
   │                              │                               │                                  │
   │── 1. POST /avatar/upload-url ─►│                               │                                  │
   │                              │── 2. gRPC GetPresignedUrl ───►│                                  │
   │                              │                               │── 3. Generate Signed S3 URL ────►│
   │                              │◄── 4. Returns { uploadUrl } ──│                                  │
   │◄── 5. Returns { uploadUrl } ─│                               │                                  │
   │                                                              │                                  │
   │── 6. PUT Binary Stream directly to MinIO ──────────────────────────────────────────────────────►│ (temp_uploads/)
   │                                                              │                                  │
   │── 7. POST /users/auth/register (JSON with tempPhotoKey) ────►│                                  │
   │   (Optionally includes cropX, cropY, cropWidth, cropHeight)  │                                  │
   │                              │── 8. gRPC CheckFileExists ───►│                                  │
   │                              │                               │── 9. HeadObject check ──────────►│
   │                              │◄── 10. File verified ─────────│                                  │
   │                              │                               │                                  │
   │                              │── 11. Transaction: Save User + Outbox Event (RabbitMQ)            │
   │                                                              │                                  │
   │                                                              │◄── 12. Consumes media.photo.process
   │                                                              │── 13. Download raw temp buffer ─►│
   │                                                              │── 14. Sharp Smart Attention Crop │
   │                                                              │       Auto-Orient + WebP + 500x500│
   │                                                              │── 15. Store to avatars/{id}/... ─►│ (avatars/)
   │                                                              │── 16. Purge raw temp file ──────►│ (DELETE temp)
```

### Key Media Features:
1. **Smart Attention Face Crop:** If no crop coordinates are passed, **Sharp / libvips** uses `sharp.strategy.attention` to automatically detect facial features and human skin tones, cropping a perfect 500x500 circular avatar centered on the person.
2. **Smartphone EXIF Auto-Orientation:** Automatically parses EXIF orientation metadata so mobile camera uploads are never rotated sideways or upside-down.
3. **WebP Optimization:** Converts all uploaded formats (JPEG, PNG, WebP) to lightweight, high-performance WebP images at 90% quality with alpha circular masking.
4. **Automated ILM Storage Hygiene:** An automated MinIO Information Lifecycle Management (ILM) policy automatically expires and purges abandoned files in `temp_uploads/` after 24 hours.

---

## 5. Security & Abuse Prevention Architecture

### A. Cryptographic OTP Verification
- OTP codes are generated using cryptographically secure random integers (`crypto.randomInt(100000, 1000000)`).
- The OTP is stored in Redis **hashed with SHA-256** under `otp:verify:{email}`. Plaintext codes are never stored in cache memory.
- Standard validity window: **10 minutes (600 seconds)**.

### B. Brute-Force Lockout Guard (7 Attempts / 15-Minute Freeze)
- Max allowed failed verification attempts: **7 attempts**.
- On every invalid submission, the remaining attempts are returned:
  > *"Invalid verification code. You have X attempts remaining."*
- Upon reaching 7 consecutive failures:
  1. The OTP code is immediately invalidated and purged from Redis.
  2. The account is locked for **15 minutes (900 seconds)** under `rate:verify:{email}`.
  3. The API responds with `HTTP 429 Too Many Requests` including a `Retry-After: 900` response header.
- **Dual-Path Lockout Enforcement:** A locked account is prevented from bypassing the lockout via the resend endpoint. Both `/verify-account` and `/send-verification-code` strictly enforce the 15-minute freeze window.

### C. 60-Second Cooldown Guard (Email Flooding Prevention)
- Enforced via `cooldown:verify:{email}` in Redis with a **60-second TTL**.
- Activated upon user registration and refreshed on every code resend.
- Prevents malicious automated scripts or users from spamming verification emails.
- If invoked before expiry, the endpoint rejects the call with `HTTP 429 Too Many Requests` and a dynamic `Retry-After` header.

### D. Dual-Token Authentication Security
- **Access Token:** Short-lived JWT (15 minutes expiry) containing `sub`, `email`, `role`, and `sessionId`.
- **Refresh Token:** Cryptographically secure 32-byte hex string, hashed with SHA-256 in Redis.
- Transported exclusively inside an **HttpOnly Cookie**:
  - `httpOnly: true` (Shields token against Cross-Site Scripting / XSS).
  - `sameSite: 'lax'` (Mitigates Cross-Site Request Forgery / CSRF).
  - `path: '/api/v1/users/auth'` (Scoped strictly to authentication endpoints).
  - `maxAge: 7 days`.

---

## 6. API Reference (Implemented Endpoints)

Base URL: `http://localhost:3000/api/v1`

### 1. Request Presigned Avatar Upload URL
* **Endpoint:** `POST /media/avatar/upload-url`
* **Content-Type:** `application/json`
* **Request Body:**
```json
{
  "filename": "my-photo.jpg",
  "contentType": "image/jpeg",
  "fileSize": 1048576,
  "category": "AVATAR"
}
```
* **Success Response (200 OK):**
```json
{
  "success": true,
  "uploadUrl": "http://localhost:9000/skillhub-media/temp_uploads/avatars/uuid_my-photo.jpg?X-Amz-Algorithm=...",
  "fileKey": "temp_uploads/avatars/uuid_my-photo.jpg",
  "expiresIn": 300,
  "publicUrl": "http://localhost:9000/skillhub-media/temp_uploads/avatars/uuid_my-photo.jpg"
}
```

---

### 2. User Registration (Pure JSON)
* **Endpoint:** `POST /users/auth/register`
* **Content-Type:** `application/json`
* **Request Fields:**
  - `username` *(string, required)*: Unique user handle (3-50 chars).
  - `email` *(string, required)*: Valid email address.
  - `password` *(string, required)*: Minimum 8 characters.
  - `birthDate` *(string, optional)*: ISO date string.
  - `tempPhotoKey` *(string, optional)*: Key returned from `upload-url` endpoint (e.g., `temp_uploads/avatars/...`).
  - `cropX`, `cropY`, `cropWidth`, `cropHeight` *(numbers, optional)*: Optional crop dimensions. If omitted, smart face detection auto-centers the image.
* **Request Body:**
```json
{
  "username": "moazsaadawy",
  "email": "moaazseadawy@gmail.com",
  "password": "Password123!",
  "tempPhotoKey": "temp_uploads/avatars/uuid_my-photo.jpg"
}
```
* **Success Response (201 Created):**
```json
{
  "success": true,
  "message": "Verification code sent to your email",
  "userId": "97e283f5-7484-48f8-b3d6-444dd1a5f60b"
}
```

---

### 3. Account Verification & Auto-Login
* **Endpoint:** `POST /users/auth/verify-account`
* **Content-Type:** `application/json`
* **Request Body:**
```json
{
  "email": "moaazseadawy@gmail.com",
  "code": "437334"
}
```
* **Success Response (200 OK):**
```json
{
  "success": true,
  "message": "Account verified and logged in successfully",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "97e283f5-7484-48f8-b3d6-444dd1a5f60b",
      "email": "moaazseadawy@gmail.com",
      "username": "moazsaadawy",
      "role": "STUDENT",
      "status": "ACTIVE",
      "profilePhoto": "avatars/97e283f5-7484-48f8-b3d6-444dd1a5f60b/avatar.webp"
    }
  }
}
```
* **Set-Cookie Header:** Automatically attaches the secure `refreshToken` cookie (7 days expiry).

---

### 4. Resend Verification Code
* **Endpoint:** `POST /users/auth/send-verification-code`
* **Content-Type:** `application/json`
* **Request Body:**
```json
{
  "email": "moaazseadawy@gmail.com"
}
```
* **Success Response (200 OK):**
```json
{
  "success": true,
  "message": "A new verification code has been sent to your email address."
}
```
* **Rate-Limited Response (429 Too Many Requests):**
```json
{
  "success": false,
  "statusCode": 429,
  "message": "Please wait 45 seconds before requesting a new verification code.",
  "error": "Too Many Requests",
  "retryAfter": 45
}
```

---

## 7. Roadmap & Implementation Progress

| Feature / Milestone | Service Scope | Status |
| :--- | :--- | :---: |
| **Direct-to-Storage Presigned URLs** | Gateway + Media (gRPC) + MinIO | ✅ Completed |
| **Smart Attention Face Crop + WebP** | Media Service + Sharp + RabbitMQ | ✅ Completed |
| **Pure JSON Registration** | Gateway + Users + ValidationPipe | ✅ Completed |
| **Transactional Outbox Engine** | Users Service + PostgreSQL + RabbitMQ | ✅ Completed |
| **Account Verification + Auto-Login** | Gateway + Users + Redis | ✅ Completed |
| **Resend Code + Cooldown + Lockout** | Gateway + Users + Notifications | ✅ Completed |
| **Login Endpoint (`/users/auth/login`)** | Bcrypt validation, Redis session issuance, dual tokens | ⏳ **Next Milestone** |
| **Token Refresh (`/users/auth/refresh`)** | Cookie parsing, token rotation, Redis session renewal | ⏳ Upcoming |
| **Logout Endpoint (`/users/auth/logout`)** | Session purge, cookie clearance, token blacklisting | ⏳ Upcoming |
| **Profile Management (`/users/me`)** | User profile retrieval and patch updates | ⏳ Upcoming |
| **Password Management** | Change password & forgot password recovery | ⏳ Upcoming |
| **Catalog, Booking & Payment Services** | Courses, reservations, and distributed Saga transactions | ⏳ Upcoming |

---

## 8. Local Setup & Deployment

### Start Backing Infrastructure (Docker):
```bash
docker compose up -d postgres redis rabbitmq minio
```

### Build & Run Microservices via Docker Compose:
```bash
docker compose up -d --build api-gateway users-service media-service notifications-service
```

### Run Microservices Locally via Nx (Development Mode):
```bash
npm run start:api-gateway
npm run start:users
npm run start:media
npm run start:notifications
```

---

## 9. Developer Tooling: Octa Workspace

The repository is integrated with **Octa** (all-in-one developer workspace) via [`skillUP.octa`](./skillUP.octa):
- Collection: **Skillup HUB**
  - **Folder: Media**
    1. `Get Avatar Upload URL`: Requests presigned S3 URL (`POST {{baseURL}}/media/avatar/upload-url`).
    2. `Upload Direct to MinIO`: Binary PUT upload stream directly to MinIO.
    3. `Check File Exists`: Verifies key existence in storage (`GET {{baseURL}}/media/check-file`).
  - **Folder: Users**
    1. `Register`: Pure JSON registration with `tempPhotoKey` (`POST {{baseURL}}/users/auth/register`).
    2. `Activate email`: OTP verification and auto-login (`POST {{baseURL}}/users/auth/verify-account`).
    3. `Resend activation code`: Resend OTP with cooldown and lockout validation (`POST {{baseURL}}/users/auth/send-verification-code`).
- Auto-configured environment variables (`{{baseURL}}`) for zero-friction testing.
