# Data model (PostgreSQL 17)

The source of truth is [`prisma/schema.prisma`](../prisma/schema.prisma) and the SQL migrations in
[`prisma/migrations`](../prisma/migrations). This page is a map of the 44 tables, not a copy of
them. Generated from the schema at M12.

## Conventions

- **One agency per installation** (spec §0.2). Most tables still carry `agency_id`, and composite
  foreign keys such as `(agency_id, owner_id)` stop a row from pointing into another agency.
- **IDs** are UUIDv7 (time-ordered). **Money** is a `bigint` in minor units with a `char(3)` currency;
  amounts in different currencies are never summed.
- **Optimistic locking:** editable rows have a `version` integer. A stale write is refused with
  `409 CONFLICT_STALE_VERSION`.
- **Frozen history:** sent proposal versions, sent change versions, issued invoices and audit events
  cannot change. Database triggers enforce it, not just the API.
- **Checks in the database:** non-empty names, date order, valid states, non-negative money, and
  similar rules are `CHECK` constraints, so a bug in the API cannot store them.

## Sales: leads to accepted proposals

```mermaid
erDiagram
  AGENCY ||--o{ USER : employs
  AGENCY ||--o{ CONTACT : has
  USER ||--o{ CONTACT : owns
  CLIENT_ORGANIZATION ||--o{ CONTACT : groups
  CLIENT_ORGANIZATION ||--o{ USER : "portal users (CLIENT)"
  PIPELINE ||--|{ PIPELINE_STAGE : has
  CONTACT ||--o{ DEAL : has
  PIPELINE_STAGE ||--o{ DEAL : "is in"
  DEAL ||--o{ PROPOSAL : has
  PROPOSAL ||--|{ PROPOSAL_VERSION : "versions (frozen once sent)"
  PROPOSAL_VERSION ||--o{ PROPOSAL_ITEM : lines
  PROPOSAL_VERSION ||--o{ PROPOSAL_REVIEW : "internal + client decisions"
  SERVICE_ITEM ||--o{ PROPOSAL_ITEM : "priced from"
  DEAL |o--o| PROPOSAL_VERSION : "accepted version"
```

## Delivery: projects, work and client approvals

```mermaid
erDiagram
  DEAL |o--o| PROJECT : "converted to (idempotent)"
  PROPOSAL_VERSION |o--o{ PROJECT : "baseline scope"
  CLIENT_ORGANIZATION ||--o{ PROJECT : "client of"
  USER ||--o{ PROJECT : manages
  PROJECT ||--o{ PROJECT_MEMBER : team
  PROJECT ||--o{ PROJECT_MILESTONE : milestones
  PROJECT ||--o{ HANDOFF_CHECKLIST_ITEM : checklist
  PROJECT ||--o{ TASK : tasks
  TASK ||--o{ TASK_DEPENDENCY : "depends on"
  TASK ||--o{ TIME_ENTRY : time
  PROJECT ||--o{ STORED_FILE : "encrypted files"
  PROJECT ||--o{ DELIVERABLE : deliverables
  DELIVERABLE ||--|{ DELIVERABLE_VERSION : versions
  STORED_FILE ||--o{ DELIVERABLE_VERSION : attached
  DELIVERABLE_VERSION ||--o{ DELIVERABLE_REVIEW : "client decisions"
  PROJECT ||--o{ CHANGE_REQUEST : changes
  CHANGE_REQUEST ||--|{ CHANGE_VERSION : "priced versions"
  CHANGE_VERSION ||--o{ CHANGE_DECISION : "client decisions"
  CHANGE_REQUEST ||--o{ TASK : "adds work"
  PROJECT ||--o{ PROJECT_SHARE : "shared with portal users"
  PROJECT ||--o{ PROJECT_COMMENT : comments
  PROJECT_COMMENT ||--o{ PROJECT_COMMENT_REVISION : "edit history"
```

## Finance

```mermaid
erDiagram
  CLIENT_ORGANIZATION ||--o{ INVOICE : billed
  PROJECT |o--o{ INVOICE : "for"
  INVOICE ||--|{ INVOICE_ITEM : lines
  INVOICE ||--o{ PAYMENT : payments
  PAYMENT |o--o| PAYMENT : "reversed by"
  USER ||--o{ COST_RATE : "internal cost (dated)"
```

Invoice lines can point to a project milestone or an accepted change request (`source`,
`source_id`). Invoice numbers come from a per-agency counter that only advances when an invoice is
issued.

## Identity, audit and operations

| Table                                       | Holds                                                                  |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| `users`, `invitations`                      | Staff and portal users; invitations store only a hash of the token     |
| `sessions`, `password_reset_tokens`         | Hashes only, with idle/absolute expiry; pruned 30 days after they end  |
| `audit_events`                              | Append-only record of security and business events (trigger-protected) |
| `activities`                                | Timelines shown on leads, deals and projects                           |
| `idempotency_records`                       | Replays for "create once" requests (project conversion, invoices, …)   |
| `outbox_jobs`                               | Emails and reminder scans, claimed with `SKIP LOCKED`, retried, buried |
| `notifications`, `notification_preferences` | In-app notifications and each user's channel choices                   |
| `import_runs`                               | CSV imports, so an import can be undone                                |
| `rate_limit_counters`                       | Sign-in and one-time-link limits shared by every instance              |
| `agencies`                                  | Profile, defaults, number counters, and `is_demo` for a demo workspace |
