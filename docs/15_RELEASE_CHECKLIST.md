# Release checklist (spec §27), status at M12.1

Each line is **Done** only when a test or a record shows it. **Partial** says what is missing, and
**Not done** names who has to act. This checklist gates putting real client data in, not the
portfolio release.

## Business

| Item                                                         | Status   | Evidence / what is missing                                                             |
| ------------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------- |
| 3–5 agency users validate the workflows and top pain points  | Not done | Pilot plan ready (`22_PILOT_PLAN.md`); recruiting participants is the owner's call     |
| Proposal and approval wording reviewed for the locale        | Not done | Wording says "operational approval, not a signature"; needs a legal review (SEC-23)    |
| Invoice semantics clear (no claim to be accounting software) | Done     | Labels, finance guide and the portal say operational tracking only                     |
| Support process and issue reporting defined                  | Partial  | Request IDs on every error, incident runbook (`19_RUNBOOK.md`); no support channel yet |

## Engineering

| Item                                                     | Status   | Evidence / what is missing                                                                                                        |
| -------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| CI clean and reproducible                                | Done     | Lint, types, audit, PostgreSQL tests, E2E, image build + Trivy, CodeQL, gitleaks on every push                                    |
| Migrations and rollback rehearsed                        | Partial  | Forward migration applied to a restored copy (M11 drill); rollback means restoring a backup; not rehearsed on a host              |
| HTTPS, secure cookies, CSRF and CORS verified in staging | Partial  | `scripts/staging-check.mjs` checks all of them (passes locally on the production build); **run it after the first Render deploy** |
| Database and file storage private, least privilege       | Partial  | `render.yaml`: database reachable only inside the Render account, files on a private encrypted disk; confirm after deploy         |
| Backup **and** restore verified                          | Partial  | Local drill RECONCILED (`m11-restore-drill.txt`); Render drill steps in `17_DEPLOYMENT.md`, waiting for the deploy                |
| No known critical/high exploitable vulnerabilities open  | Done     | `npm audit` 0; Trivy gate passed in CI on the M11 pull request                                                                    |
| Error monitoring and an alert test observed              | Not done | No vendor chosen (ADR-064)                                                                                                        |

## Security and privacy

| Item                                                                    | Status   | Evidence / what is missing                                                                    |
| ----------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------- |
| Permission matrix negative tests all green                              | Done     | `permission-matrix.test.ts`: every role against 169 endpoints (7 added by the security audit) |
| Security audit findings F1–F6, F9, F11–F13, F15–F17 fixed with tests    | Done     | Branch `fix/security-hardening`; audit report and test output in the security review notes    |
| Database roles split: runtime user cannot change the schema (R48)       | Not done | Steps in `19_RUNBOOK.md`; do it when the production database is created                       |
| Backups encrypted at rest (R49)                                         | Not done | Today: plain `pg_dump` and file copies; keep them on an encrypted disk until then             |
| ClamAV limit alerts on, and a large-archive test on staging (R50)       | Not done | `AlertExceedsMax yes` in the scanner's clamd.conf                                             |
| `TRUST_PROXY` confirmed on the host (R51)                               | Not done | Run `scripts/staging-check.mjs` after the first deploy and after any proxy change             |
| Client portal isolation on every route and file                         | Done     | Portal suites (M4, M7–M9) and `demo.test.ts` across three client organizations                |
| Password reset, invitation and session lifecycle tested                 | Done     | `auth`, `invitations`, `password-reset`, `team` suites; E2E M1–M2                             |
| Secret scanning, dependency checks, threat model, ASVS map              | Done     | gitleaks, npm audit, Trivy, CodeQL; `11_THREAT_MODEL.md`; `12_ASVS_CHECKLIST.md` (limited)    |
| Personal data retention, export and deletion: owner assigned and tested | Partial  | `18_PRIVACY_RETENTION.md`, pruning tested; periods and an accountable person await the owner  |
| AI provider access disabled by default                                  | Done     | No AI integration exists                                                                      |

## UI and UX

| Item                                                                 | Status   | Evidence / what is missing                                                                                                                                                                            |
| -------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tested at 360, 390, 768, 1024, 1280, 1440, 1920 px and by keyboard   | Done     | Demo tour at all seven widths plus 200%/400% zoom in Chromium, Firefox and WebKit; full E2E suite in all three engines; screenshots in `milestones/m12-screenshots/`. Real Safari/iOS not tried (R41) |
| Primary workflows demo without narration                             | Not done | Needs the pilot sessions                                                                                                                                                                              |
| Empty, error, loading and slow-network states reviewed               | Partial  | Empty/error/loading states exist and are tested; slow network not tested on purpose                                                                                                                   |
| Contrast, focus, labels, dialogs and screen reader checks documented | Partial  | axe (WCAG 2.2 AA rules) on every main screen, keyboard tests, 200%/400% zoom checks; **no screen-reader session yet**                                                                                 |
| Client portal reviewed by a test user posing as a client             | Not done | Pilot task 9–10                                                                                                                                                                                       |

## Portfolio

| Item                                               | Status | Evidence                                                                               |
| -------------------------------------------------- | ------ | -------------------------------------------------------------------------------------- |
| Live sanitized demo or reproducible local demo     | Done   | `npm run demo:reset` and `npm run demo:tour` (local); no public host yet               |
| README and visual case study with real screenshots | Done   | `README.md`, `21_PORTFOLIO_CASE_STUDY.md`                                              |
| Architecture and data model documented             | Done   | `07_ARCHITECTURE_ADRS.md` (66 ADRs), `08_DATABASE_ERD.md`                              |
| Test results and limitations disclosed truthfully  | Done   | Milestone reports M0–M12                                                               |
| Individual contribution and engineering decisions  | Done   | Case study, "My role" and "Engineering decisions"; the owner should review the wording |

## Before real client data goes in

1. ~~Choose hosting~~ (Render, M12.1). Apply the Blueprint, run the staging check and the restore drill there.
2. ~~Choose an email provider~~ (Resend, M12.1). Verify the domain: SPF, DKIM and DMARC.
3. Decide retention periods, backup schedule and RPO/RTO; name who answers data requests.
4. Legal review of the privacy document and the approval wording.
5. Run at least three pilot sessions and fix every severity-3 finding.
6. ~~Antivirus and two-step sign-in for Owners/Admins~~ (built in M12.1). Keep the ClamAV service running wherever real files are uploaded.
7. Close the open security-audit items: database role split (R48), encrypted backups (R49), ClamAV limits (R50), `TRUST_PROXY` on the host (R51) and a file-key rotation plan (R54).
