# Risk Register

| #   | Risk                                                       | Likelihood | Impact           | Mitigation                                                                                       | Owner         |
| --- | ---------------------------------------------------------- | ---------- | ---------------- | ------------------------------------------------------------------------------------------------ | ------------- |
| R1  | Scope too large for 8 h/week                               | High       | High             | Thin vertical slices, milestone gates, public backlog                                            | Project owner |
| R2  | Beautiful UI hides incomplete backend                      | High       | High             | Every milestone has a DB-backed integration test gate                                            | Engineering   |
| R3  | Cross-client data leak (BOLA/IDOR)                         | Medium     | Critical         | Deny by default, per-record policy, negative API tests per role                                  | Engineering   |
| R4  | Lost update / duplicate project or invoice                 | Medium     | High             | `version` optimistic locking, idempotency keys, unique constraints                               | Engineering   |
| R5  | Unsafe file uploads                                        | Medium     | High             | Quarantine + scan before publish (M7); no active content                                         | Engineering   |
| R6  | Unsafe third-party AI handling                             | Medium     | High             | Off by default; consent, scope, human review (M13+)                                              | Project owner |
| R7  | Mixed currencies corrupt KPIs                              | Medium     | High             | Minor units + currency labels; no cross-currency sums without FX                                 | Engineering   |
| R8  | Overpromising legal e-signature / invoicing                | Medium     | High             | "Operational approval" labels; legal review before real use                                      | Project owner |
| R9  | Excessive design iteration                                 | Medium     | Medium           | Fixed tokens (spec §7.2), screen contract per milestone                                          | Engineering   |
| R10 | App does not run on owner's Windows machine                | Medium     | High             | Pinned versions, `docs/16_WINDOWS_SETUP.md`, CI fresh install                                    | Engineering   |
| R11 | Docker Desktop not running / unavailable                   | Medium     | High             | Documented start steps; DB tests marked NOT RUN if unavailable                                   | Project owner |
| R12 | Prisma 7→8 / TypeScript 7 toolchain churn                  | Medium     | Medium           | Pin stable versions, no RC; upgrade via ADR                                                      | Engineering   |
| R13 | In-memory login rate limit bypassed with several instances | Low (now)  | High (at deploy) | Shared store before scaling out (ADR-007)                                                        | Engineering   |
| R14 | Public repo leaks a secret or personal data                | Low        | High             | `.gitignore`, placeholder-only `.env.example`, secret scanning in CI (M11), noreply commit email | Engineering   |
