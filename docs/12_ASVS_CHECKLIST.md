# OWASP ASVS: limited self-assessment (M12)

A self-assessment against selected **OWASP ASVS 4.0.3** requirements (mostly Level 1, with some
Level 2). It is **not an audit or a certification**. "Met" means the control exists and an
automated test or recorded evidence shows it; "Partial" and "Not met" are stated plainly.

| ASVS            | Requirement (short)                                    | Status      | How / evidence                                                                       |
| --------------- | ------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------ |
| V2.1.1          | Passwords of at least 12 characters                    | Met         | Shared password schema; `auth.test.ts`                                               |
| V2.1.2          | Passwords of 64+ characters allowed                    | Met         | Up to 128 characters                                                                 |
| V2.1.7          | Breached or common passwords refused                   | Partial     | Strength estimator plus a common-password list; no breach-corpus lookup              |
| V2.2.1          | Anti-automation on authentication                      | Met         | Per-IP and per-email limits shared in PostgreSQL; `hardening.test.ts`                |
| V2.4.1          | Passwords stored with an approved slow hash            | Met         | Argon2id                                                                             |
| V2.5.x          | Secure account recovery                                | Met         | Single-use, expiring, hashed reset tokens; no hint of whether an account exists      |
| V2.8 / V2.7     | Multi-factor authentication                            | **Not met** | Not built (see the threat model's open risks)                                        |
| V3.2.1          | New session token on authentication                    | Met         | `auth.test.ts`                                                                       |
| V3.2.2          | Session tokens with at least 64 bits of entropy        | Met         | 256-bit random tokens; only the hash is stored                                       |
| V3.3.1          | Logout invalidates the session                         | Met         | T-AUTH-03                                                                            |
| V3.3.2          | Idle and absolute timeouts                             | Met         | 12 h idle, 7 d absolute                                                              |
| V3.4.1–V3.4.3   | Cookies: Secure, HttpOnly, SameSite                    | Met         | Secure in production; HttpOnly and SameSite always                                   |
| V4.1.1, V4.1.3  | Access control enforced on the server, least privilege | Met         | Permission map plus record scope; `permission-matrix.test.ts`                        |
| V4.2.1          | Protection against IDOR                                | Met         | Out-of-scope records answer 404; portal isolation tests, `demo.test.ts`              |
| V4.2.2          | Anti-CSRF                                              | Met         | Session-bound token plus Origin check; T-SEC-01 (`auth.test.ts`)                     |
| V4.3.1          | Admin interfaces need suitable protection              | Partial     | Role-gated; no MFA for Owner/Admin yet                                               |
| V5.1.3          | Input validated with allowlists                        | Met         | Strict Zod schemas on every body and query                                           |
| V5.2.x / V5.3.3 | Output encoding against XSS                            | Met         | React escaping, CSP; T-SEC-03                                                        |
| V5.3.4          | Parameterized queries                                  | Met         | Prisma; raw SQL is tagged-template only; T-SEC-02                                    |
| V7.1.1, V7.1.2  | No credentials or session tokens in logs               | Met         | Logger redaction; T-SEC-05 (`contacts.test.ts`)                                      |
| V7.2.1          | Authentication decisions logged                        | Met         | Audit events for sign-in success and failure                                         |
| V7.3.3          | Logs protected from modification                       | Partial     | Audit table is append-only by trigger; request logs depend on the host               |
| V7.4.1          | Generic error messages with an ID                      | Met         | Error envelope with request ID, no stack                                             |
| V8.1.x          | Sensitive data not cached                              | Met         | `Cache-Control: no-store` on API responses                                           |
| V8.3.1          | Sensitive data not in the URL                          | Met         | One-time tokens travel in the URL fragment; downloads use short-lived signed links   |
| V8.3.4          | Data retention defined                                 | Partial     | `docs/18`; periods await the owner                                                   |
| V9.1.1          | TLS for all connections                                | Partial     | Enforced by configuration (https origins in production); not yet seen on a real host |
| V10.3.2         | No unexpected third-party code at run time             | Met         | No CDN scripts; strict CSP; pinned dependencies                                      |
| V12.1.1         | File size limits                                       | Met         | Per file and per project                                                             |
| V12.2.1         | File type checked by content                           | Met         | Signature check against the extension                                                |
| V12.4.1         | Uploaded files stored outside the web root             | Met         | Encrypted volume, never served statically                                            |
| V12.4.2         | Uploads scanned for malware                            | **Not met** | Built-in checks only; no antivirus engine (R25)                                      |
| V13.1.3         | API URLs do not expose sensitive data                  | Met         | IDs only in paths                                                                    |
| V13.2.1         | Unused HTTP methods refused                            | Met         | Routes declare their methods; others 404                                             |
| V14.2.1         | Components up to date, no known vulnerabilities        | Met         | `npm audit` 0; Trivy gate in CI                                                      |
| V14.3.2         | No debug mode in production                            | Met         | Production config refuses test overrides and the dev mail sink                       |
| V14.4.x         | Security headers (CSP, nosniff, frame-ancestors, HSTS) | Met         | Helmet; HSTS in production; checked in `security-smoke.test.ts`                      |
| V14.5.3         | CORS restricted                                        | Met         | Same-origin app; explicit allowlist only                                             |

## Not assessed

Chapters V1 (architecture), V6 (stored cryptography beyond the file store), V11 (business logic in
depth) and Level 3 requirements were not assessed one by one. Business rules (money, approvals,
idempotency) are covered by their own tests instead.
