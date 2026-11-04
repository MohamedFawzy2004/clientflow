# Architecture overview

A one-page map of how ClientFlow is put together. The detailed sources are:

- the [data model](08_DATABASE_ERD.md);
- the [architecture decisions](07_ARCHITECTURE_ADRS.md) (ADR-001 to ADR-071);
- the [threat model](11_THREAT_MODEL.md);
- the [deployment guide](17_DEPLOYMENT.md).

## 1. System view

```mermaid
flowchart LR
  subgraph Browser
    SPA["React 19 single-page app<br/>(staff app + client portal)"]
  end

  subgraph Container["One Node 24 container (production image)"]
    direction TB
    WEB["Static web build<br/>(served on the same origin)"]
    API["Express 5 API<br/>/api/v1"]
    JOBS["Background worker<br/>(outbox, reminders)"]
  end

  PG[("PostgreSQL 17<br/>46 Prisma models")]
  FILES[("File volume<br/>AES-256-GCM per file")]
  AV["ClamAV (clamd)<br/>optional"]
  MAIL["Resend<br/>optional"]

  SPA -- "HTTPS, same origin<br/>__Host- cookies" --> WEB
  SPA -- "JSON + CSRF token" --> API
  API --> PG
  JOBS --> PG
  API --> FILES
  API -- "scan before store" --> AV
  JOBS -- "email" --> MAIL
```

- **One deployable.** The API serves the built web app on the same origin. That gives one origin for cookies, CSP and CORS, and one image to scan and roll back (ADR-034).
- **The worker runs inside the API process** by default and claims jobs with `SKIP LOCKED`. It can run as a separate process instead (ADR-058).
- **Optional services** are refused at start-up when they are half-configured. Two examples:
  - production refuses to start without either ClamAV or an explicit `UPLOAD_SCAN=builtin-only`;
  - a demo refuses any mail transport that sends.

## 2. Request pipeline

Every `/api/v1` request passes these steps in order (`apps/api/src/app.ts`). A request that fails a step never reaches the next.

```mermaid
flowchart TB
  A[Request id + structured log] --> B[no-store, API rate limit]
  B --> C[Origin check]
  C --> D["JSON body ≤ 32 KB<br/>(imports parse their own, later)"]
  D --> E[Load session from hashed cookie token]
  E --> F[CSRF token check on writes]
  F --> G["Two-step setup gate for required roles<br/>(403 MFA_SETUP_REQUIRED)"]
  G --> H{DEMO_MODE?}
  H -- yes --> H1["Demo write cap + DEMO_RESTRICTED guard"]
  H -- no --> I
  H1 --> I[Route: requireAuth + role permission]
  I --> J["Zod validation (shared contracts)"]
  J --> K["Service: scope check<br/>(out of scope → 404)"]
  K --> L["Transaction: write + audit event + outbox job"]
```

## 3. Business workflow

The path the product is built around. Each box is a real state machine in the database (`prisma/schema.prisma` enums). Frozen states are protected by database triggers, not only by the API.

```mermaid
flowchart LR
  L["Lead<br/>(Contact)"] --> D["Deal<br/>OPEN → WON / LOST"]
  D --> P["Proposal<br/>DRAFT → IN_REVIEW → APPROVED_INTERNAL<br/>→ SENT (version frozen)"]
  P -- "client decides in portal" --> PA{"ACCEPTED /<br/>CHANGES_REQUESTED /<br/>REJECTED"}
  PA -- accepted --> PR["Project<br/>PLANNED → ACTIVE → COMPLETED"]
  PR --> T["Tasks<br/>TODO → … → DONE"]
  PR --> DV["Deliverables<br/>published versions,<br/>client approves / asks revision"]
  PR --> CR["Change requests<br/>priced, approved inside,<br/>client accepts → baseline updates"]
  PR --> INV["Invoices<br/>DRAFT → ISSUED (frozen, INV-000n)<br/>→ PARTIALLY_PAID → PAID"]
  CR --> INV
```

**Rules that keep the path honest:**

- An accepted proposal records the hash of the exact version the client saw (ADR-031).
- Converting a deal into a project is idempotent, so a retry never creates a second project.
- Extra work has to point to an accepted change request or carry a written exception.
- Invoice numbers advance only when an invoice is issued. Payments are reversed, never edited.

## 4. Core data model (condensed)

Twelve of the 46 models. The full map, by area, is in [`08_DATABASE_ERD.md`](08_DATABASE_ERD.md).

```mermaid
erDiagram
  AGENCY ||--o{ USER : employs
  CLIENT_ORGANIZATION ||--o{ USER : "portal users"
  USER ||--o{ CONTACT : owns
  CONTACT ||--o{ DEAL : has
  DEAL ||--o{ PROPOSAL : has
  PROPOSAL ||--|{ PROPOSAL_VERSION : "versions (frozen once sent)"
  DEAL |o--o| PROJECT : "converted to"
  PROJECT ||--o{ TASK : tasks
  PROJECT ||--o{ DELIVERABLE : deliverables
  PROJECT ||--o{ CHANGE_REQUEST : changes
  PROJECT |o--o{ INVOICE : billed
  INVOICE ||--o{ PAYMENT : payments
```

**Conventions:**

- IDs are UUIDv7.
- Money is integer minor units with a currency, and different currencies are never summed.
- Editable rows carry a `version` for optimistic locking (`409` on a stale write).
- Composite foreign keys keep a row inside its agency.

## 5. Code layout

| Path                      | What lives there                                                                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts`      | Zod schemas, roles, error codes, shared by API and web                                                                                                                  |
| `apps/api/src/modules/*`  | One folder per area (auth, contacts, deals, proposals, projects, tasks, files, deliverables, changes, invoices, portal, imports, ops, demo, …): routes, service, policy |
| `apps/api/src/middleware` | Sessions, CSRF, Origin, rate limits, MFA gate, demo guard, security headers                                                                                             |
| `apps/api/src/jobs`       | Outbox worker and reminder scans                                                                                                                                        |
| `apps/api/src/demo`       | Demo builder: creates the fictional workspace through the real API                                                                                                      |
| `apps/web/src/features/*` | Screens per area, TanStack Query hooks, role-aware navigation                                                                                                           |
| `prisma/`                 | Schema, SQL migrations with `CHECK` constraints and freeze triggers                                                                                                     |
| `e2e/`                    | Playwright suites per milestone, plus the demo tour                                                                                                                     |

## 6. Deployment shapes

```mermaid
flowchart TB
  subgraph Local["Local production-like staging (verified)"]
    C1["Caddy, internal CA<br/>https://127.0.0.1:8443"] --> A1["Production image"]
    A1 --> P1[("Postgres 17<br/>non-superuser app role")]
    A1 --> V1["ClamAV 1.5.4"]
    A1 --> F1[("files volume")]
  end
  subgraph Demo["Public demo blueprint (not deployed yet)"]
    R["Render Free web<br/>DEMO_MODE, reset on every boot"] --> N[("Neon Free Postgres<br/>fictional data only")]
  end
  subgraph Pilot["Pilot staging blueprint (paid, not deployed)"]
    R2["Render web + disk"] --> N2[("Render Postgres + PITR")]
    R2 --> V2["ClamAV service"]
  end
```

The trade-offs, the free-tier limits and the owner steps are in [`24_STAGING_AND_DEMO.md`](24_STAGING_AND_DEMO.md).
