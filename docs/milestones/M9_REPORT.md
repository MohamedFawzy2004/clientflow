# ClientFlow Milestone M9 Report

**Milestone:** M9 — Invoice tracking · **Date:** 2026-10-27 · **Branch:** `feat/m9-invoices` (stacked on M8 #87 → M7 #79 → M6 #70 → M5 #62 → M4 #52 → M3 #43 → M2 #32 → M1 #22)
**Environments:** Windows 11 (Node 24.19.0, Docker 29.9.2, Postgres 17.6, Edge) and GitHub Actions `ubuntu-latest`.

## Status summary

| Status                                 | What                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IMPLEMENTED + TESTED**               | Invoice drafts with lines from milestones, accepted changes or free text · issuing with an agency-wide number and a frozen snapshot · publishing to the client portal · void with a reason · partial payments that add up exactly, with an idempotency key, no overpayment and reversals · project money (expected / invoiced / received) · cost rates and an estimated margin with its completeness · finance report per currency with aging · CSV export |
| **FAILED (found and fixed during M9)** | 4 UI defects (two screen-reader labels, a misleading margin note, a red zero), one API bug and 4 test mistakes, all fixed and re-run (see _Open bugs_)                                                                                                                                                                                                                                                                                                     |
| **NOT RUN**                            | Screen reader, Firefox/Safari, 200% zoom · deployment (hosting not chosen) · antivirus (still no engine, R25)                                                                                                                                                                                                                                                                                                                                              |
| **DEFERRED**                           | Invoice PDF (FR-F09 is CSV only for now) · payment reminders and in-app notifications (M10) · a manager filter in the report UI (the API has it) · idempotent draft creation (US-18, see O31)                                                                                                                                                                                                                                                              |

ClientFlow **tracks** invoices and payments that someone confirms. It never takes payments, stores card or bank details, or replaces accounting software, and every invoice screen says so.

## Defaults I chose (please confirm)

You did not answer the two questions from the M8 report, so M9 uses these defaults (ADR-057). Each can change later without moving data:

1. **Numbering:** one agency-wide sequence (`INV-0001`, `INV-0002`, …). A number is taken only on issue; drafts have none, and void invoices keep theirs.
2. **Cost rates:** Owner and Admin set them, Finance reads them, nobody else sees them. PMs see the estimated margin of their own projects and the names of people without a rate, never the rates themselves.

## Scope and FR/SEC/NFR IDs

- **Newly fully TESTED:**
  - FR-F01 to FR-F08 and FR-F10, FR-X03 (invoices complete it);
  - US-14, US-23;
  - SEC-14, SEC-15;
  - T-ACL-04, T-ACL-05, T-PAY-01, T-PAY-02.
- **Partial:**
  - FR-F09: the CSV export is tested; the PDF export is deferred;
  - FR-A06: only cost-rate changes are covered; they are validated, dated (so earlier rates stay) and audited;
  - US-18: payments are idempotent, but creating a draft is not (O31).

## Implemented files / API routes / migrations

**Migration** `20261027090000_invoices` (additive; `prisma migrate diff` empty afterwards) adds:

- the counter `agencies.invoice_seq`;
- the tables `invoices`, `invoice_items`, `payments` and `cost_rates`;
- checks:
  - a number exists exactly when an invoice is issued;
  - the status matches the paid amount;
  - the paid amount stays between 0 and the total;
  - void needs a reason and nothing paid;
  - an invoice is published only after it is issued;
  - references cannot hold a card-like number (13 or more digits);
  - a reversal points at a payment;
- triggers:
  - issued content is frozen, void is final, and issued invoices cannot be deleted;
  - lines change only on drafts;
  - payments are append-only.

**API routes** (new in M9):

| Method   | Path                                                      | Access                                                   | Notes                                                    |
| -------- | --------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------- |
| GET      | `/invoices` · `/invoices/:id`                             | Owner, Admin, Finance (all); PM (projects they manage)   | Internal note only for managers                          |
| GET      | `/invoices/options`                                       | Owner, Admin, Finance                                    | Client organizations and their projects                  |
| POST/PUT | `/invoices` · `/invoices/:id/draft`                       | same                                                     | Whole-draft save under `version`                         |
| POST     | `/invoices/:id/issue` · `/publish` · `/void` · `/delete`  | same                                                     | Issue numbers and snapshots; delete only drafts          |
| POST     | `/invoices/:id/payments` · `/payments/:paymentId/reverse` | **Owner, Finance** only                                  | `Idempotency-Key` required; 201, or 200 when replayed    |
| GET      | `/projects/:id/finance`                                   | Owner, Admin, Finance; PM (own projects, estimate scope) | Expected / invoiced / received, cost, margin, billable   |
| GET      | `/reports/finance` · `/exports/invoices.csv`              | Owner, Admin, Finance                                    | Per currency with aging; the CSV is neutralized, audited |
| GET/POST | `/cost-rates` · `/users/:id/cost-rates`                   | read: Owner, Admin, Finance; set: Owner, Admin           | Dated rates, audited                                     |
| GET      | `/portal/invoices` · `/portal/invoices/:id`               | CLIENT of the invoice's organization                     | Published only; otherwise 404 + DENIED                   |

**Key files:**

- API: `apps/api/src/modules/invoices/{service,routes}.ts`, `packages/contracts/src/finance.ts`, and the new permissions in `packages/contracts/src/permissions.ts`.
- Web:
  - `apps/web/src/features/invoices/*` (list, invoice page, finance report, cost rates, project money);
  - `features/portal/PortalInvoices.tsx`;
  - `components/finance/finance-ui.tsx`;
  - a Finance group in the sidebar, and an Invoices tab in the portal.
- Tests: `apps/api/tests/invoices.test.ts`, the matrix in `apps/api/tests/permission-matrix.test.ts`, `apps/web/tests/invoices.test.tsx`, `e2e/m9.spec.ts`. E2E now seeds a Finance user.

## Screenshot / UI review evidence

All in `docs/milestones/m9-screenshots/` at 1440 and 360 px. Each screen also passed the 360px overflow check and axe (no serious or critical WCAG 2.2 AA issues):

- `invoice-draft-*`: a draft with "Milestone: Design approved" EGP 20,000 and "Hosting, two months" 2 × EGP 1,500. It shows a subtotal of EGP 23,000.00, 14% tax of EGP 3,220.00 and a total of EGP 26,220.00, plus the project money card with "No time logged yet".
- `invoice-paid-*`: INV-0001, paid in two payments (EGP 10,000 with reference CIB-TRX-4471, then EGP 16,220), each with who recorded it, the snapshot and project money.
- `project-money-*`: the PM's project overview with expected EGP 50,000, invoiced EGP 23,000, received EGP 26,220 and the estimated margin.
- `portal-invoice-*`: the client's view: lines, totals, terms and the payments received, without references or staff names.
- `finance-report-*`: the EGP totals with aging buckets, and the invoice list.
- `cost-rates-*`: Finance's read-only view of the rate the owner set (EGP 250.00 an hour since 1 Oct 2026).

## Tests actually run (command, environment, pass/fail)

| Command                                       | Windows (local)                                                                                                                                      | GitHub Actions    |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `npm run lint` · `typecheck` · `format:check` | **PASS**                                                                                                                                             | see _CI evidence_ |
| `npm audit` (all and `--omit=dev`)            | **PASS**, 0 vulnerabilities (no dependency changes in M9)                                                                                            | see _CI evidence_ |
| `npm test` (real Postgres)                    | **PASS**, **303 tests** (+12 invoices); role × endpoint matrix **142 endpoints** (+18) × 8 roles + signed out                                        | see _CI evidence_ |
| `npm run test:web`                            | **PASS**, **64 tests** (+5)                                                                                                                          | see _CI evidence_ |
| `npx playwright test` (Edge)                  | **PASS**, **54 tests** (M1 7 + M2 5 + M3 5 + M4 7 + M5 6 + M6 4 + M7 7 + M8 6 + M9 7); M9 also with `CAPTURE_SCREENSHOTS=1`                          | see _CI evidence_ |
| `npm run build`                               | **PASS**; invoice and portal invoice screens are their own chunks                                                                                    | see _CI evidence_ |
| gitleaks (history with `.gitleaks.toml`)      | **PASS**, no leaks. A working-tree scan flags only gitignored local files (`.env`, dev and E2E credentials, mail sink) and allowlisted test fixtures | see _CI evidence_ |

After the full `npm test` run, I added two audit assertions to `invoices.test.ts` and re-ran only that file: **12 of 12 pass**.

## DB-backed user journey demonstrated (E2E, real API + Postgres)

1. **Setup (API):** the owner creates "Delta fleet portal" (EGP 50,000, PM Pat Morgan) with a milestone "Design approved". The owner links it to Delta Logistics, starts it, and shares it with `karim@delta.test`, who signed up through the invitation.
2. **Draft (Finance, UI):** Tarek (Finance) opens **Invoices → New invoice**, picks Delta Logistics, the project and a due date of 15 Dec 2026. In the draft he:
   - adds the milestone from **Add from the project** and prices it at EGP 20,000;
   - adds "Hosting, two months" at 2 × EGP 1,500;
   - sets 14% tax and the payment terms.

   The totals read EGP 23,000.00, 3,220.00 and 26,220.00. He saves.

3. **Issue and publish:** issuing gives `INV-0001`. The editor disappears and the "Billed to" snapshot appears. He then shows the invoice in the client portal.
4. **Payments:**
   - EGP 10,000 (reference CIB-TRX-4471) → "Partly paid", EGP 16,220.00 open;
   - then EGP 16,220 → "Paid", and the payment form goes away.
5. **PM:** Pat reads INV-0001 without a payment form. A direct `POST /payments` from Pat's session returns **403**. Pat's project overview shows the project money and the estimated margin.
6. **Client:** Karim opens **Invoices** in the portal. He sees INV-0001 as Paid, the terms and the two payments. The bank reference and staff names do not appear.
7. **Report:** the finance report shows "Invoiced (1)" and EGP 26,220.00 in EGP. The downloaded CSV contains `INV-0001` and Delta Logistics.
8. **Cost rates:** the owner sets EGP 250/hour for Mina Adel from 1 Oct 2026. Finance sees it and has no **Set rate** button.

The E2E invoices a milestone plus a free-text line. Lines from an accepted change are covered by the API test (they must be accepted changes of the same project, in its currency) and by the web test (the price is filled in from the change).

## Authorization and negative testing evidence

- **Exact math (T-PAY-01, FR-F10):**
  - totals are computed from minor units with tax rounded half up;
  - partial payments of 5,000.00, 0.01 and 10,390.56 land exactly on the total;
  - 10,390.57 is refused (409, "open balance is 10390.56 EGP"), and so is anything after the invoice is paid;
  - the balance never goes negative.
- **Idempotency and races (SEC-15):**
  - the same `Idempotency-Key` with the same body → 200 `replayed` and one payment;
  - the same key with a different body → 409; no key → 422;
  - two people paying the full balance at once → `[201, 409]`;
  - in the UI, a retry after a failed answer reuses the form's key (web test).
- **Payments are history:**
  - reversals add a linked row and reopen the balance; reversing twice changes nothing;
  - direct SQL update or delete of a payment → refused by the trigger;
  - `payment.record` and `payment.reverse` are audited with the actor (FR-F04).
- **Snapshot (FR-F02):**
  - issued content cannot change, by API (409) or SQL (trigger);
  - void needs a reason (422) and no open payments (409);
  - void keeps the number, and void invoices take no payments.
- **Roles (T-PAY-02, FR-F04):**
  - Sales, PM, Member, Admin and Client get 403 on payments;
  - Sales, Member and Client get 403 on every invoice write;
  - the matrix checks for every role that no invoice, line, payment or cost rate changed.
- **Finance sees money, not delivery (T-ACL-04):**
  - Finance gets 403 on contacts, project details, tasks and time;
  - the invoice's internal note is hidden from PMs and clients.
- **Reports (T-ACL-05):**
  - Sales get 403 on the report and the export;
  - totals stay per currency, and the PM's finance view is limited to the projects they manage;
  - CSV cells starting with `=`, `+`, `-` or `@` are neutralized, and each export is audited.
- **Portal (FR-X03, T-ACL-02):**
  - clients see only published invoices of their own organization;
  - another client's invoice, a draft or an unpublished invoice → 404, plus a DENIED audit event.
- **Card numbers (SEC-14):** a reference or note with 13 or more digits is refused (422), and the DB check refuses it too.
- **Cost:**
  - each logged minute uses the rate in effect that day;
  - rates in another currency are left out and reported;
  - completeness is the share of minutes with a usable rate;
  - every rate change is audited.

## Open bugs and security risks (severity and owner)

**Fixed in M9:**

1. **`GET /projects/:id/finance` with a malformed ID** could have matched another project in the raw SQL path (API, Medium). The API now validates the UUID first. Found while writing the matrix.
2. **Screen-reader names** (UI, Low):
   - "Set rate for Mona" was announced as "Set ratefor Mona" after formatting;
   - each line's quantity and price fields had the same label on every line.

   They now have explicit labels such as "Line 2 quantity". The web test caught the first; I found the second while writing the E2E.

3. **"Estimate based on 100% of logged time" with no time logged** (UI, Low). It now says the cost is not known yet. Found in the screenshots.
4. **A red "Overdue EGP 0.00"** in the report (UI, Low): it is red only when something is overdue.
5. **My mistakes in tests:**
   - matrix fixtures needed issued invoices with a status;
   - the agency counter had to match the fixture numbers;
   - the invoice count was off by one;
   - an E2E heading locator was ambiguous.
6. **Tooling:**
   - a shell command waited on input and had to be stopped; I re-ran the change from a script file;
   - a literal BOM in the CSV code was replaced with its escape.

**Open:**

| #   | Issue                                                                    | Severity       | Owner / when                     |
| --- | ------------------------------------------------------------------------ | -------------- | -------------------------------- |
| O1  | Rate limits still in-memory                                              | High at deploy | Engineering, M11                 |
| O9  | No real email provider                                                   | Medium         | **Project owner decision**       |
| O16 | Approvers may approve their own proposals and priced changes             | Low            | **Project owner to confirm**     |
| O18 | Proposal PDF cannot show Arabic text                                     | Medium         | Engineering                      |
| O19 | Image is 831 MB                                                          | Low            | M11                              |
| O22 | Override-won deals have no baseline (R24)                                | Medium         | Project owner (process)          |
| O23 | Test-only fault hook in `AppDeps` (R23)                                  | Low            | Engineering                      |
| O25 | No antivirus engine (R25)                                                | High at deploy | **Project owner** with hosting   |
| O26 | `FILE_ENCRYPTION_KEY` backup (R26)                                       | High at deploy | Project owner, M11 restore drill |
| O27 | Local storage is single-instance (R27)                                   | Medium         | Hosting decision                 |
| O28 | In-app notifications (FR-X09)                                            | Medium         | M10                              |
| O29 | A rejected change cannot be revised; the PM creates a new change request | Low            | Product decision                 |
| O30 | Invoice numbering and cost-rate visibility are defaults (ADR-057)        | Low            | **Project owner to confirm**     |
| O31 | A double-submitted "Create draft" can make two unnumbered drafts (US-18) | Low            | Engineering, M10                 |
| O32 | No invoice PDF; invoices are sent outside ClientFlow (FR-F09 partial)    | Medium         | Product decision                 |
| O33 | Invoices could be mistaken for tax or accounting records (R30)           | Medium         | Project owner                    |

## Not run / blocked tests and exact steps to reproduce

```powershell
npm ci
npm run db:up
npm run db:migrate
npm run lint; npm run typecheck; npm test; npm run test:web; npm run e2e; npm run build
npm run e2e:screenshots   # optional
```

- **By hand:**
  1. As Finance, open **Invoices → New invoice**, pick a client with a project, add a milestone line and save.
  2. Issue it, then show it in the portal.
  3. Record a part payment, then the rest.
  4. As the client, open **Invoices** in the portal.
  5. As the owner, set a cost rate and open the project overview.
- **Screen reader, Firefox/Safari, 200% zoom:** NOT RUN.

## CI evidence

The branch is pushed after all local checks pass (above). The CI result is the check list on the M9 PR, which runs on top of the stacked M8 PR #87 (10 checks passing at the end of M8).

## Requirements traceability updates

`docs/REQUIREMENTS_TRACEABILITY.csv` is updated for 21 IDs (17 TESTED; FR-F09, FR-A06 and US-18 partial). ADR-054 to ADR-057 are added, and the risk register adds R30 to R32. GitHub: issues #88–#94 are closed by the M9 PR. Epic #9 ticks the fully tested IDs, plus those finished in M6–M8 (US-10, US-11, US-12, US-13, US-20, T-ACL-02). FR-F09, FR-A06 and US-18 stay unticked.

## Next milestone plan / decisions needed

**Recommended M10 — Automation and import/export** (needs your approval):

1. **In-app notifications** (FR-X09): change decisions, client comments, deliverable reviews, overdue invoices, with an unread count and per-user read state. Email stays link-only.
2. **Reminders:** an outbox and a scheduled worker for follow-ups, overdue invoices and items waiting for review. Sends are retried and idempotent, with no duplicates after a crash.
3. **Imports:** contacts and deals from CSV, with a preview, row-level errors, duplicate warnings and an audited result.
4. **Fix O31:** idempotent draft creation.

**Decisions needed from you:**

- Confirm or change the M9 defaults: numbering (INV-0001 for the whole agency) and cost rates (set by Owner/Admin, read by Finance).
- Do you need an invoice PDF from ClientFlow, or do you send invoices from your accounting tool?
- **Still open:** antivirus engine, hosting, email provider, self-approval (O16).

---

## ملخص للمالك (بالمصري)

- **اللي اتعمل في M9:** متابعة الفواتير والمدفوعات. البرنامج مبيقبضش فلوس ومبيحفظش بيانات كروت، هو بس بيسجل اللي إنتوا بتأكدوه، وده مكتوب على كل شاشة فواتير.
- **الفاتورة:**
  - الـ Finance بيعمل مسودة ويختار من مراحل المشروع أو التغييرات اللي العميل وافق عليها، أو يكتب بند حر؛
  - الإجمالي والضريبة بيتحسبوا بالقرش بالظبط من غير أي تقريب غلط.
- **الإصدار:**
  - أول ما الفاتورة تتصدر بتاخد رقم (INV-0001)، وبياناتها بتتقفل ومحدش يقدر يعدلها، حتى من قاعدة البيانات؛
  - بعدها تقدر تظهرها للعميل في الـ portal.
- **المدفوعات:**
  - تقدر تسجل دفعات جزئية، والبرنامج بيرفض أي دفعة أكبر من المتبقي؛
  - لو الطلب اتبعت مرتين بالغلط بتتسجل دفعة واحدة بس؛
  - الغلط بيتصلح بعكس الدفعة مع سبب، مش بالمسح، والتاريخ كله بيفضل محفوظ.
- **الصلاحيات:**
  - الدفعات يسجلها الـ Finance والـ Owner بس؛
  - الـ Admin يدير الفواتير من غير الفلوس؛
  - الـ PM يشوف فواتير مشاريعه بس؛
  - العميل يشوف فواتيره المنشورة بس، من غير الملاحظات الداخلية أو أسماء الموظفين.
- **فلوس المشروع:** المتفق عليه، واللي اتفوتر، واللي اتقبض، كل واحد لوحده. والربح مكتوب عليه إنه "تقديري"، وبيوضح نسبة الوقت اللي ليها تكلفة معروفة.
- **التقرير:** إجمالي لكل عملة لوحدها، والمتأخر متقسم حسب عدد أيام التأخير، وتقدر تنزله CSV.
- **التستات:** ٣٠٣ تست للـ API و٦٤ للواجهة و٥٤ في المتصفح، كلهم عدّوا.
- **قرارات خدتها بدالك لأنك مردتش، وتقدر تغيرها:**
  1. الترقيم رقم واحد مستمر للشركة كلها (INV-0001).
  2. تكلفة ساعة الموظف يحددها الـ Owner أو الـ Admin، والـ Finance يشوفها بس، والـ PM يشوف الربح التقديري من غير الأسعار.
- **محتاج منك:**
  - توافق على M10 (الإشعارات والتذكيرات واستيراد البيانات)؛
  - تأكد القرارين اللي فوق؛
  - تقولي محتاج الفاتورة PDF من البرنامج ولا لأ.
