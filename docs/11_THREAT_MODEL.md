# Threat model (M12)

A working threat model for ClientFlow as built, not a certification. It covers what an attacker
could want, how the design stops it, where the proof is, and what is still open. Review it whenever
a new integration (email provider, payments, AI, webhooks) or hosting is added.

## What we protect

| Asset                                               | Why it matters                                         |
| --------------------------------------------------- | ------------------------------------------------------ |
| Client and lead personal data                       | Privacy; the agency's reputation; legal duties         |
| Proposals, prices, internal notes and margins       | Commercially sensitive, between clients and internally |
| Deliverable files                                   | Client work, often confidential                        |
| Invoices and payment records                        | Money; disputes need a trustworthy history             |
| Approvals (proposal, change, deliverable decisions) | Evidence of what the client agreed to                  |
| Accounts, sessions, invitation and reset links      | Every other asset sits behind them                     |
| Secrets: database URL, CSRF secret, file key        | Full compromise if leaked                              |

## Who might attack

- **Outsider on the internet:** guesses passwords, abuses public endpoints, probes for injection.
- **Client portal user:** tries to see another client's data or to change what was agreed.
- **Insider with a low role:** a salesperson or member reaching beyond their records.
- **Stolen session or device:** someone acting as a real user.
- **Supply chain:** a compromised npm package or base image.

## Trust boundaries

```
Browser ──HTTPS──► Platform proxy ──► API container ──► PostgreSQL
  (staff / client)                     │   └──► Encrypted file volume
                                       └──► Mail transport (dev sink / disabled today)
```

Everything from the browser is untrusted, including the web app's own requests. The API decides
every permission. The database enforces history and integrity rules on its own, in case the API has
a bug.

## Threats and controls (STRIDE)

| Threat                                  | Control                                                                                                                                                                                | Evidence                                                                               |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **S** Password guessing, stuffing       | Argon2id; at least 12 characters plus a strength check; one generic error; per-IP and per-email limits shared in PostgreSQL across restarts and instances                              | `auth.test.ts` (T-AUTH-02, T-SEC-04), `hardening.test.ts`                              |
| **S** Session theft or fixation         | 256-bit random token in an HttpOnly, SameSite, Secure (production) cookie; only its SHA-256 is stored; new token on sign-in; idle 12 h, absolute 7 d; sign-out and deactivation revoke | `auth.test.ts`, `team.test.ts` (T-AUTH-03)                                             |
| **S** Stolen invitation or reset link   | Token in the URL fragment (never sent to servers or logs); hashed at rest; single use; expires; limited per IP and email                                                               | `invitations.test.ts`, `password-reset.test.ts`                                        |
| **T** Cross-site request forgery        | Synchronizer token bound to the session on every change, plus an Origin allowlist; signed pre-session token for sign-in                                                                | `auth.test.ts` (T-SEC-01), `security-smoke.test.ts`                                    |
| **T** Changing what a client agreed to  | Sent proposal and change versions, issued invoices, payments and decisions are frozen by database triggers; a client decision carries the hash of exactly the version shown            | `proposals.test.ts`, `changes.test.ts`, `invoices.test.ts`                             |
| **T** Lost updates and double actions   | Optimistic `version` on every editable row; Idempotency-Key for conversions, invoices and payments                                                                                     | `projects.test.ts`, `invoices.test.ts`                                                 |
| **T** Mass assignment                   | Strict request schemas: unknown fields such as `ownerId`, `agencyId` or `role` are refused                                                                                             | `contacts.test.ts` (T-ACL-03)                                                          |
| **R** "I never approved that"           | Append-only audit events (trigger-protected) with actor, time and request ID; decisions store who, when and the content hash                                                           | `database.test.ts`, audit assertions across suites                                     |
| **I** Cross-client or cross-role access | Declarative permission map plus per-record scope; a record outside your scope answers 404 (indistinguishable from missing); portal users see only their organization                   | `permission-matrix.test.ts` (155 endpoints), `delivery-portal.test.ts`, `demo.test.ts` |
| **I** Internal data leaking to clients  | Serializers list exactly which fields leave the API; internal notes, margins and cost rates never reach portal responses                                                               | `proposals.test.ts`, `invoices.test.ts`                                                |
| **I** Injection (SQL, XSS)              | Parameterized queries only; React escapes output; strict CSP; stored markup is shown as text                                                                                           | `contacts.test.ts` (T-SEC-02, T-SEC-03), E2E                                           |
| **I** Files read by the wrong person    | AES-256-GCM per file, random object names, folder outside the web root; downloads need a short-lived signed link issued after a permission check                                       | `delivery-portal.test.ts`                                                              |
| **I** Secrets in logs or responses      | Log redaction of cookies, tokens and passwords; no stack traces in responses; request IDs instead                                                                                      | `contacts.test.ts` (T-SEC-05)                                                          |
| **I** Compression side channel (BREACH) | Only static web files are compressed, never API JSON                                                                                                                                   | `hardening.test.ts`                                                                    |
| **D** Request floods and huge inputs    | Per-IP API limit; body size limits; page size at most 100; upload size and per-project quota; CSV bodies parsed only after the permission check                                        | `imports.test.ts`, `delivery-portal.test.ts`                                           |
| **D** Background work piling up         | Outbox with retries, backoff and a dead-letter state; readiness reports lag after 15 minutes                                                                                           | `notifications.test.ts`, `hardening.test.ts`                                           |
| **E** Privilege escalation              | Roles change only through Owner/Admin endpoints; the last active Owner cannot be removed; role checked on every request                                                                | `team.test.ts`                                                                         |
| **E** Malicious uploads                 | Extension allowlist, file-signature check, active-content rejection, test-signature detection; files are downloaded, never rendered inline                                             | `delivery-portal.test.ts`                                                              |
| Supply chain                            | Pinned versions and lockfile; `npm audit`; gitleaks; CodeQL; Trivy image gate; npm removed from the runtime image                                                                      | CI on every push (ADR-065)                                                             |
| Accidental data loss                    | Verified backups and isolated restores; the demo reset refuses any non-demo database                                                                                                   | `m11-restore-drill.txt`, `demo.test.ts` (ADR-063, ADR-066)                             |

## Open risks

| Risk                                                  | Why it is open             | Next step                                 |
| ----------------------------------------------------- | -------------------------- | ----------------------------------------- |
| No multi-factor sign-in                               | Not in v1 scope            | Add TOTP for Owner/Admin before wide use  |
| No antivirus engine for uploads (R25)                 | Needs hosting              | ClamAV sidecar or a scanning service      |
| No real email provider (O9)                           | Owner decision             | Choose a provider; add SPF/DKIM/DMARC     |
| HTTPS, cookies and headers not checked on a real host | No staging yet             | Re-run the security smoke against staging |
| No error tracking or alerting                         | No vendor chosen (ADR-064) | Wire the logger to one; test an alert     |
| General API rate limit is per instance                | Deliberate (ADR-062)       | Revisit if more than a few instances run  |
| No external penetration test                          | Not yet commissioned       | Before handling many clients' data        |
| Legal review of privacy and approval wording (SEC-23) | Needs a professional       | Owner to arrange                          |

## Out of scope today

Online payments, e-signatures, AI features and outbound webhooks are not built. Each one needs its
own threat review before it is added.
