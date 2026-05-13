# Nexus — Zero-Knowledge Team Collaboration Platform

> A security-first workspace platform combining task management, role-based access control, and cryptographic secret storage — all without ever exposing user passwords or plaintext secrets to the server.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Security Model](#security-model)
- [Feature Set](#feature-set)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Environment Variables](#environment-variables)
  - [Development](#development)
  - [Production Build](#production-build)
- [Authentication Flow](#authentication-flow)
- [Vault System](#vault-system)
- [API Reference](#api-reference)
- [WebSocket Events](#websocket-events)
- [Database Schema](#database-schema)
- [Deployment](#deployment)
- [Contributing](#contributing)

---

## Overview

Nexus is a full-stack SaaS workspace platform that enables teams to collaborate on tasks and securely store sensitive secrets using a threshold cryptography vault. The system is designed around a zero-trust principle — the server never has access to user passwords (via the OPAQUE protocol) or vault secrets (via client-side Shamir's Secret Sharing and RSA-OAEP encryption).

The platform supports multiple isolated workspaces, role-based permissions, real-time notifications via WebSockets, and a cryptographic key rotation system that allows users to recover vault access after switching devices.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                        Client                           │
│   Angular 18 · Tailwind CSS · Socket.IO Client          │
│                                                         │
│  ┌────────────┐  ┌─────────────┐  ┌──────────────────┐  │
│  │ Auth Flow  │  │ Kanban Board│  │   Vault UI       │  │
│  │  (OPAQUE)  │  │  (Tasks)    │  │  (Shamir SSS)    │  │
│  └────────────┘  └─────────────┘  └──────────────────┘  │
│         │                                  │             │
│  ┌──────▼──────────────────────────────────▼───────────┐ │
│  │        WebCrypto API  ·  IndexedDB (key storage)    │ │
│  └─────────────────────────────────────────────────────┘ │
└───────────────────────────┬─────────────────────────────┘
                            │ HTTPS / WSS
┌───────────────────────────▼─────────────────────────────┐
│                       Server                            │
│   NestJS · Passport JWT · Socket.IO · Throttler         │
│                                                         │
│  ┌────────────┐  ┌─────────────┐  ┌──────────────────┐  │
│  │    Auth    │  │  Workspace  │  │  Vault Gateway   │  │
│  │  Module    │  │  Module     │  │  (WebSocket)     │  │
│  └────────────┘  └─────────────┘  └──────────────────┘  │
│         │                │                │              │
│  ┌──────▼────────────────▼────────────────▼───────────┐  │
│  │                Prisma ORM                          │  │
│  └────────────────────────┬────────────────────────────┘  │
└───────────────────────────┼─────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────┐
│                    PostgreSQL                           │
└─────────────────────────────────────────────────────────┘
```

The client and server are deployed as a single unit in production — NestJS serves the pre-built Angular SPA as static assets alongside the `/api` prefix routes.

---

## Security Model

Nexus is built on the principle that the server should know as little as possible about user credentials and sensitive data.

### Password Authentication — OPAQUE Protocol

Nexus implements the [OPAQUE](https://eprint.iacr.org/2018/163) (Oblivious Pseudo-Random Function) asymmetric password authentication protocol via `@serenity-kit/opaque`.

Key properties:
- The user's plaintext password **never leaves the browser** at any point — not during registration and not during login.
- The server stores a cryptographic registration record, not a password hash. This record cannot be used to derive or verify the password offline.
- The server derives its own session key entirely independently. The client-side `sessionKey` (used for vault key wrapping) is **never transmitted** to the server.
- A random nonce ties the two-round-trip login handshake together, preventing replay attacks.

Legacy password login (argon2id) is supported as a fallback for accounts created before OPAQUE was introduced.

### Vault Encryption — Client-Side, End-to-End

Every vault secret is encrypted entirely inside the browser before a single byte is transmitted. The server stores only opaque ciphertext and never participates in decryption.

The cryptographic pipeline:

```
User's OPAQUE sessionKey
         │
         ▼
   HKDF (SHA-256)  ──────►  AES-GCM-256 wrapping key
                                      │
                                      ▼
                          RSA-OAEP-2048 key pair
                          (private key wrapped in IndexedDB)
                                      │
                          ┌───────────▼────────────┐
                          │  Vault Secret (UTF-8)  │
                          └───────────┬────────────┘
                                      │
                          Shamir's Secret Sharing (GF(256))
                          k-of-n split into shares
                                      │
                          Each share encrypted with
                          holder's RSA-OAEP public key
                                      │
                                      ▼
                              Stored on server
```

The reconstruction path is symmetric and also entirely client-side.

### Refresh Token Security

- Refresh tokens are random 32-byte hex strings stored as SHA-256 hashes in the database.
- Tokens are transmitted exclusively via `HttpOnly; SameSite=Lax; Path=/api/auth` cookies, making them inaccessible from JavaScript.
- Every refresh rotates the token, invalidating the previous one.
- A maximum of 5 concurrent sessions per user is enforced; the oldest is evicted on overflow.

---

## Feature Set

### Workspaces
- Create isolated workspaces with a unique URL slug.
- Role hierarchy: **OWNER → ADMIN → MEMBER**.
- OWNER can manage roles; ADMIN can invite and remove members.
- Invite members by email or via time-limited shareable invite links (configurable TTL and max-use count).

### Task Management
- Kanban board with four statuses: **To Do, In Progress, Review, Done**.
- Assign tasks to workspace members.
- Role-gated mutations: members can only update tasks assigned to themselves; admins and owners can update any task.

### Vault (Cryptographic Secret Storage)
- Create secrets split into N encrypted shares using Shamir's Secret Sharing over GF(256).
- A configurable threshold K of N holders must cooperate to reconstruct the secret.
- Real-time access request and approval flow via WebSocket.
- Access requests expire after 1 hour; rotation requests expire after 24 hours.
- Quorum-reached shares are forwarded only to the requester's private WebSocket room and purged from the database immediately.

### Key Rotation
- When a holder opens the app on a new device, a key mismatch is detected automatically by comparing the locally stored public key with the key registered on each vault share.
- The holder requests rotation; other holders submit their decrypted shares until the threshold is met.
- The requester reconstructs the secret, re-splits with fresh keys, and finalises atomically via a single PUT endpoint. No secret leaves the browser.

### Holder Health Monitoring
- Admins see a "Quorum at risk" warning if any holder has been inactive for 30+ days, enabling proactive rotation before quorum is permanently lost.

### Session Management
- Users can list and individually revoke active sessions from any device.
- "Logout all devices" invalidates every session for the account.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend framework | Angular 21 (standalone components, signals API) |
| Styling | Tailwind CSS v4 |
| HTTP client | Angular `HttpClient` with functional interceptors |
| State management | Angular Signals |
| Real-time | Socket.IO client |
| Cryptography (client) | Web Crypto API, `@serenity-kit/opaque` (WASM) |
| Key persistence | IndexedDB |
| Backend framework | NestJS 11 |
| Language | TypeScript 5 (strict mode) |
| ORM | Prisma 7 with `@prisma/adapter-pg` |
| Database | PostgreSQL 18+ |
| Authentication | OPAQUE + JWT (Passport.js) + argon2id (legacy) |
| WebSockets | Socket.IO with NestJS Gateway |
| Validation | `class-validator` / `class-transformer` |
| Rate limiting | `@nestjs/throttler` |
| Security headers | Helmet |
| Email | `@nestjs-modules/mailer` (nodemailer) |
| Password hashing | argon2id (legacy path) |

---

## Project Structure

```
nexus/
├── client/                         # Angular SPA
│   └── src/
│       └── app/
│           ├── app.ts              # Root component
│           ├── app.config.ts       # Bootstrap providers
│           ├── app.routes.ts       # Lazy-loaded route config
│           ├── core/
│           │   ├── guards/
│           │   │   └── auth.guard.ts
│           │   ├── interceptors/
│           │   │   └── auth.interceptor.ts   # Bearer token + 401 refresh
│           │   ├── services/
│           │   │   ├── auth.service.ts
│           │   │   ├── opaque.service.ts     # OPAQUE WASM client
│           │   │   ├── vault.service.ts      # Shamir SSS + RSA helpers
│           │   │   ├── vault-key.service.ts  # IndexedDB + HKDF key management
│           │   │   ├── workspace.service.ts
│           │   │   └── task.service.ts
│           │   └── utils/
│           │       └── api-base.util.ts      # Environment-aware base URL
│           └── features/
│               ├── auth/
│               │   ├── login/
│               │   └── register/
│               ├── dashboard/
│               ├── workspace/
│               │   ├── workspace.component.ts
│               │   └── vault-tab.component.ts
│               └── join/
│
└── server/                         # NestJS API
    ├── prisma/
    │   ├── schema.prisma
    │   └── migrations/
    └── src/
        ├── main.ts                 # Bootstrap: Helmet, CORS, Validation, Prefix
        ├── app.module.ts           # Root module, ServeStatic in production
        ├── auth/
        │   ├── auth.controller.ts
        │   ├── auth.service.ts
        │   ├── opaque/
        │   │   └── opaque.service.ts
        │   ├── dto/
        │   ├── guards/
        │   ├── strategies/
        │   └── utils/
        ├── workspace/
        │   ├── workspace.controller.ts
        │   ├── workspace.service.ts
        │   ├── guards/
        │   │   └── workspace-member.guard.ts
        │   └── decorators/
        ├── task/
        ├── vault/
        │   ├── vault.controller.ts
        │   ├── vault.service.ts
        │   ├── vault.gateway.ts    # Socket.IO WebSocket namespace
        │   └── dto/
        ├── prisma/
        └── common/
            └── filters/
                └── all-exceptions.filter.ts
```

---

## Getting Started

### Prerequisites

- Node.js ≥ 20.x
- PostgreSQL 15+
- npm ≥ 10.x

### Environment Variables

Create `server/.env`:

```dotenv
# ── Database ──────────────────────────────────────────────────────────
DATABASE_URL="postgresql://user:password@localhost:5432/nexus"

# ── JWT ───────────────────────────────────────────────────────────────
# Generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_SECRET="your-256-bit-secret"

# ── OPAQUE ────────────────────────────────────────────────────────────
# Generated on first run if not set (ephemeral — set this in production)
# After first boot, copy the logged value here
OPAQUE_SERVER_SETUP="<generated-on-first-run>"

# ── CORS ──────────────────────────────────────────────────────────────
ALLOWED_ORIGINS="http://localhost:3000"

# ── Mail (optional) ───────────────────────────────────────────────────
MAIL_HOST="smtp.example.com"
MAIL_PORT=587
MAIL_USER="no-reply@example.com"
MAIL_PASS="your-smtp-password"

# ── Runtime ───────────────────────────────────────────────────────────
NODE_ENV="development"
PORT=4000
```

> **Important:** `OPAQUE_SERVER_SETUP` is a long-lived server keypair. All existing user OPAQUE records become invalid if this value changes. Generate it once and persist it securely (e.g., as a platform secret/environment variable in your hosting provider).

### Development

```bash
# Install all dependencies
cd server && npm install
cd ../client && npm install

# Apply database migrations
cd server && npx prisma migrate dev

# Start the backend (port 4000)
cd server && npm run start:dev

# Start the frontend dev server (port 3000) — in a separate terminal
cd client && npm start
```

The Angular dev server proxies API calls to `:4000` automatically via the `api-base.util.ts` logic.

### Production Build

```bash
# 1. Build the Angular SPA
cd client && npm run build
# Output: client/dist/client/browser/

# 2. Copy the build output to the server's static asset directory
cp -r client/dist/client/browser/* server/public/

# 3. Run database migrations
cd server && npx prisma migrate deploy

# 4. Start the server (NestJS serves both API and SPA)
cd server && NODE_ENV=production npm run start:prod
```

In production, NestJS registers `ServeStaticModule` pointing to `./public`. All requests to paths not starting with `/api` fall back to `index.html`, enabling Angular's client-side routing.

---

## Authentication Flow

### OPAQUE Registration (4 steps)

```
Client                                          Server
  │                                               │
  │─── POST /api/auth/opaque/register-init ──────►│
  │    { userIdentifier, registrationRequest }    │
  │                                               │  OPRF evaluation
  │◄── { registrationResponse } ─────────────────│
  │                                               │
  │  client.finishRegistration() → registrationRecord
  │                                               │
  │─── POST /api/auth/opaque/register-finish ────►│
  │    { email, registrationRecord, firstName,    │  CREATE User
  │      lastName, organizationName }             │  CREATE Workspace
  │                                               │
  │◄── { accessToken, workspaceSlug } ───────────│  Set-Cookie: refreshToken
  │                                               │
  │  loginOpaque() ──────────────────────────────► (2 more round-trips)
  │◄── { sessionKey } (client-only, never sent)  │
  │                                               │
  │  vaultKeySvc.initSession(userId, sessionKey) │
  │  → HKDF → AES-GCM wrapping key               │
  │  → generate RSA-OAEP keypair                  │
  │  → wrap private key in IndexedDB             │
  │                                               │
  │─── PUT /api/auth/me/public-key ─────────────►│  Store publicKey on User
```

### OPAQUE Login (3 steps)

```
Client                                          Server
  │                                               │
  │─── POST /api/auth/opaque/login-init ─────────►│
  │    { userIdentifier, startLoginRequest }      │  Lookup opaqueRecord
  │                                               │  server.startLogin()
  │◄── { loginResponse, nonce } ─────────────────│  Store serverLoginState[nonce]
  │                                               │
  │  client.finishLogin() → { finishLoginRequest, sessionKey }
  │                                               │
  │─── POST /api/auth/opaque/login-finish ───────►│
  │    { userIdentifier, nonce,                   │  server.finishLogin()
  │      finishLoginRequest }                     │  MAC verification
  │                                               │
  │◄── { accessToken } ──────────────────────────│  Set-Cookie: refreshToken
  │                                               │
  │  vaultKeySvc.initSession(userId, sessionKey) │
  │  → unwrap private key from IndexedDB (or     │
  │    generate fresh keypair on new device)      │
```

---

## Vault System

### Creating a Secret

1. The creator selects N holders from workspace members (each must have a registered public key).
2. Client generates N shares via GF(256) Shamir's Secret Sharing with threshold K.
3. Each share is individually RSA-OAEP encrypted with the corresponding holder's public key.
4. Encrypted shares are sent to the server; the plaintext secret and plaintext shares never leave the browser.

### Accessing a Secret (K-of-N flow)

```
Requester                   Server                    Holder(s)
    │                          │                           │
    │── POST /access-requests ►│── WebSocket ─────────────►│
    │                          │  vault:access_requested   │
    │                          │                           │
    │                          │◄── POST /submit ──────────│
    │                          │                           │
    │                          │  (repeat until k reached) │
    │                          │                           │
    │                          │  Delete submissions from DB
    │◄── WebSocket ────────────│
    │  vault:quorum_reached    │
    │  { shares[] }            │  (private room only)
    │                          │
    │  sscombine(shares) → plaintext secret
```

### Key Rotation Flow

Triggered when a holder's local RSA key doesn't match the public key stored in their vault share (i.e., the user is on a new device).

```
Requester                   Server                   Other Holders
    │                          │                           │
    │─ POST /rotation-requests ►│─ vault:rotation_requested ►│
    │  { newPublicKey }         │                           │
    │                          │◄─ POST /rotation/submit ──│
    │                          │   (k submissions required)│
    │                          │                           │
    │◄─ vault:rotation_quorum  │                           │
    │   { shares[], holderPublicKeys[] }                   │
    │                          │                           │
    │  sscombine(shares)        │
    │  sssplit(secret, k, n)    │
    │  encrypt each with new holderPublicKey               │
    │                          │                           │
    │─── PUT /rotation/finalize ►│                         │
    │    { newShares[] }        │  Replace all VaultShare  │
    │                          │  Update User.publicKey   │
    │◄── { updatedVault } ─────│─ vault:rotation_finalized ►│
```

---

## API Reference

All endpoints are prefixed with `/api`. Authenticated endpoints require `Authorization: Bearer <accessToken>`.

### Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/opaque/register-init` | — | OPAQUE registration round 1 |
| POST | `/auth/opaque/register-finish` | — | OPAQUE registration round 2, creates account |
| POST | `/auth/opaque/login-init` | — | OPAQUE login round 1 |
| POST | `/auth/opaque/login-finish` | — | OPAQUE login round 2, issues JWT |
| POST | `/auth/register` | — | Legacy password registration |
| POST | `/auth/login` | — | Legacy password login |
| POST | `/auth/refresh` | Cookie | Rotate refresh token, issue new access token |
| POST | `/auth/logout` | Cookie | Invalidate current session |
| POST | `/auth/logout-all` | JWT | Invalidate all sessions for the account |
| GET | `/auth/sessions` | JWT | List active sessions |
| DELETE | `/auth/sessions/:id` | JWT | Revoke a specific session |
| PUT | `/auth/me/public-key` | JWT | Publish RSA-OAEP public key for vault use |

### Workspaces

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/workspaces` | Member | List own workspaces |
| POST | `/workspaces` | — | Create a new workspace |
| GET | `/workspaces/:id` | Member | Get workspace details |
| PATCH | `/workspaces/:id` | Admin | Rename workspace |
| DELETE | `/workspaces/:id` | Owner | Delete workspace |
| GET | `/workspaces/:id/members` | Member | List members |
| POST | `/workspaces/:id/members` | Admin | Invite member by email |
| PATCH | `/workspaces/:id/members/:userId` | Owner | Change member role |
| DELETE | `/workspaces/:id/members/:userId` | Admin | Remove member |
| POST | `/workspaces/:id/invites` | Admin | Generate invite link |
| GET | `/workspaces/:id/invites` | Admin | List active invite links |
| DELETE | `/workspaces/:id/invites/:inviteId` | Admin | Revoke invite link |
| POST | `/workspaces/join` | JWT | Join via invite token |

### Tasks

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/workspaces/:id/tasks` | Member | List all tasks |
| POST | `/workspaces/:id/tasks` | Member | Create task |
| PATCH | `/workspaces/:id/tasks/:taskId` | Member* | Update task |
| DELETE | `/workspaces/:id/tasks/:taskId` | Admin | Delete task |

*Members can only update tasks assigned to themselves.

### Vault

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/workspaces/:id/vault` | Member | List vaults |
| POST | `/workspaces/:id/vault` | Admin | Create vault |
| GET | `/workspaces/:id/vault/:vaultId` | Member | Get vault |
| DELETE | `/workspaces/:id/vault/:vaultId` | Admin | Delete vault |
| GET | `/workspaces/:id/vault/:vaultId/my-share` | Member | Get own encrypted share |
| GET | `/workspaces/:id/vault/:vaultId/holder-health` | Member | Holder activity status |
| GET | `/workspaces/:id/vault/:vaultId/access-requests` | Member | List access requests |
| POST | `/workspaces/:id/vault/:vaultId/access-requests` | Member | Request secret access |
| POST | `/workspaces/:id/vault/:vaultId/access-requests/:reqId/submit` | Member | Submit share |
| DELETE | `/workspaces/:id/vault/:vaultId/access-requests/:reqId` | Member | Cancel/deny request |
| GET | `/workspaces/:id/vault/:vaultId/rotation-requests` | Member | List rotation requests |
| POST | `/workspaces/:id/vault/:vaultId/rotation-requests` | Member | Request key rotation |
| POST | `/workspaces/:id/vault/:vaultId/rotation-requests/:rotId/submit` | Member | Submit rotation share |
| PUT | `/workspaces/:id/vault/:vaultId/rotation-requests/:rotId/finalize` | Member | Finalize rotation |
| DELETE | `/workspaces/:id/vault/:vaultId/rotation-requests/:rotId` | Member | Deny rotation |

---

## WebSocket Events

Connect to `wss://<host>/vault` with `{ auth: { token: "<accessToken>" } }`.

| Direction | Event | Description |
|-----------|-------|-------------|
| C → S | `vault:subscribe` | Subscribe to a workspace vault room |
| C → S | `vault:unsubscribe` | Leave a workspace vault room |
| S → C | `vault:access_requested` | Broadcast: new access request (workspace room) |
| S → C | `vault:share_submitted` | Broadcast: a share was submitted (workspace room) |
| S → C | `vault:quorum_reached` | **Private:** quorum met, includes plaintext shares (requester only) |
| S → C | `vault:request_expired` | Broadcast: access request expired |
| S → C | `vault:request_denied` | Broadcast: access request denied |
| S → C | `vault:rotation_requested` | Broadcast: key rotation requested |
| S → C | `vault:rotation_share_submitted` | Broadcast: rotation share submitted |
| S → C | `vault:rotation_quorum_reached` | **Private:** rotation quorum met, includes shares (requester only) |
| S → C | `vault:rotation_finalized` | Broadcast: rotation complete, reload recommended |
| S → C | `vault:rotation_denied` | Broadcast: rotation request denied |

> Sensitive payloads (`vault:quorum_reached`, `vault:rotation_quorum_reached`) are emitted exclusively to the requester's private user room — never to the workspace broadcast room.

---

## Database Schema

Core models and their relationships:

```
User
 ├── password (argon2id, legacy only)
 ├── opaqueRecord (OPAQUE registration record)
 ├── publicKey (RSA-OAEP SPKI base64, for vault share encryption)
 ├── lastSeenAt (for holder health checks)
 ├── sessions[] → Session
 ├── workspaces[] → WorkspaceMember
 ├── vaultShares[] → VaultShare
 └── accessRequests[] → AccessRequest

Workspace
 ├── members[] → WorkspaceMember
 ├── tasks[] → Task
 ├── vaults[] → Vault
 └── invites[] → WorkspaceInvite

Vault
 ├── threshold (k)
 ├── totalShares (n)
 ├── shares[] → VaultShare
 │    ├── encryptedShare (RSA-OAEP ciphertext, base64)
 │    └── holderPublicKey (SPKI base64, snapshot at creation)
 ├── accessRequests[] → AccessRequest
 │    └── submissions[] → ShareSubmission
 └── rotationRequests[] → ShareRotationRequest
      └── submissions[] → RotationSubmission
```

---

## Deployment

### Fly.io (Recommended)

The project is pre-configured for [Fly.io](https://fly.io) single-instance deployment.

```bash
# Authenticate and create the app
fly auth login
fly launch --no-deploy

# Set secrets
fly secrets set \
  DATABASE_URL="postgresql://..." \
  JWT_SECRET="..." \
  OPAQUE_SERVER_SETUP="..." \
  NODE_ENV="production"

# Attach a Postgres cluster (or use external)
fly postgres create
fly postgres attach <db-app-name>

# Deploy
fly deploy
```

The `ServeStaticModule` is activated when `NODE_ENV=production`, serving the Angular build from `./public`. Angular's client-side routing is handled via an `index.html` fallback.

### Environment Notes

The `api-base.util.ts` utility automatically resolves the correct API base URL for:
- `localhost` (development)
- LAN IP addresses
- GitHub Codespaces (`name-3000.app.github.dev` → `name-4000.app.github.dev`)
- Production (same host, `/api` prefix)

---

## Contributing

1. Fork the repository and create a feature branch from `main`.
2. Ensure all TypeScript compiles without errors (`tsc --noEmit`).
3. Follow the existing service/controller/DTO patterns in NestJS modules.
4. For any changes touching the vault or authentication flow, include a description of the security impact in your PR.
5. Run `npx prisma validate` before committing schema changes, and generate a migration with `npx prisma migrate dev --name <description>`.

---

## License

MIT License — see `LICENSE` for details.

---

*Built with a security-first mindset. Contributions that weaken the zero-knowledge guarantees of the authentication or vault systems will not be accepted.*