# ClientFlow Milestone M12 Report

**Milestone:** M12 — Commercial/portfolio release. **Branch:** `feat/m12-release`, stacked on M11. **Date:** 2026-10-28.
**Approval:** "Approve M12" (the M12 proposal in the M11 report).

## Status summary

| Status                         | What                                                                                                                                                                                                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IMPLEMENTED + TESTED**       | Demo workspace built through the real API, with a reset that refuses any non-demo database (FR-A08) · demo notice in the app and portal · full E2E suite in Edge, Firefox and WebKit · demo tour of every role in three engines at seven widths plus 200%/400% zoom · dashboard Lighthouse mobile 84–86 (R38) |
| **FIXED (found in M12)**       | Dragging a deal card did nothing in WebKit (custom drag type arrived empty) · the E2E job on PR #111 timed out on CI's empty database (readiness checked tables before migration) · two web tests too tight for a busy machine                                                                                |
| **DOCUMENTED**                 | User guides for each role · case study · release checklist (spec §27) · threat model · limited ASVS map · data model · pilot plan · ADR-066 · risks R39–R42                                                                                                                                                   |
| **NOT RUN**                    | Pilot sessions with real users and a client · screen-reader walkthrough · real Safari / iOS · a hosted demo                                                                                                                                                                                                   |
| **DEFERRED / owner decisions** | Hosting, email provider, retention periods and RPO/RTO, legal review (unchanged from M11) · reset schedule and access for a public demo · whether to start M13 (AI) or a staging-and-pilot milestone first                                                                                                    |

## Scope and IDs

| ID / task          | Result                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| FR-A08 (#112)      | **TESTED.** `npm run demo:reset`; `apps/api/tests/demo.test.ts` (11 tests)                                               |
| Demo notice (#113) | **TESTED.** `apps/web/tests/demo.test.tsx`; visible in every demo screenshot                                             |
| User guides (#114) | **DONE.** `docs/guides/`: each permission claim checked against the permission map and services                          |
| Final QA (#115)    | **TESTED.** Firefox and WebKit full suites; `e2e/demo/tour.spec.ts` in three engines; 56 screenshots                     |
| NFR-03, R38 (#116) | **TESTED, at the edge.** Dashboard mobile 84–86 (median 85) on the demo data                                             |
| Docs (#117)        | **DONE.** Case study, release checklist, pilot plan, threat model, ASVS map, data model                                  |
| NFR-01, NFR-04     | Still **IMPLEMENTING**: automated checks pass in three engines; the human review (pilot, screen reader) has not happened |
| SEC-23             | Still **IMPLEMENTING**: threat model and ASVS map added; legal review is the owner's                                     |

## Implemented files / routes / migrations

- **Migration** `20261030090000_demo_flag`: `agencies.is_demo boolean NOT NULL DEFAULT false` (additive).
- **Demo (API):**
  - `apps/api/src/demo/guard.ts`: `checkDemoTarget`, `checkDatabaseName`, `checkAgencies`;
  - `wipe.ts`: removes stored files by their recorded keys, then truncates every table except `_prisma_migrations`;
  - `client.ts`: a small cookie-jar API client;
  - `seed.ts`: the spec §21 set, created by each fictional person through the API, plus PDFs made with pdfkit;
  - `reset.ts`: wipe, in-process API on 127.0.0.1, seed, then drain the outbox into memory;
  - `apps/api/src/cli/demo-reset.ts`; scripts `demo:reset` (root and API).
- **Config:** `DEMO_MODE` (refuses a sending mail transport); `isDemo` on the session's agency.
- **Web:** `components/DemoNotice.tsx` in `AppShell` and `PortalShell`; deal drag sets `text/plain` as well; Vite puts all icons in one chunk; web test limit 15 s.
- **E2E:** `playwright.demo.config.ts`, `e2e/demo/global-setup.ts` (runs the real `demo:reset`), `e2e/demo/tour.spec.ts`; `E2E_BROWSER` in `playwright.config.ts`, which now ignores `e2e/demo` and waits for liveness, not readiness.
- **Scripts:** `scripts/lighthouse.mjs` (signed-in, repeatable, retries NO_NAVSTART); `npm run demo:tour`.
- **Infra:** local Postgres creates `clientflow_demo`; `.env.example` documents `DEMO_DATABASE_URL`.
- **Docs:** `docs/guides/*` (6), `08_DATABASE_ERD.md`, `11_THREAT_MODEL.md`, `12_ASVS_CHECKLIST.md`, `15_RELEASE_CHECKLIST.md`, `21_PORTFOLIO_CASE_STUDY.md`, `22_PILOT_PLAN.md`, ADR-066, deployment guide (demo section, `DEMO_MODE`), README, risks R38–R42, traceability.

## Evidence

**Demo reset refusals** (run against the real databases):

```
DEMO_MODE unset          → demo:reset refused: DEMO_MODE is not true. A demo reset only runs on a demo deployment.
--confirm clientflow     → demo:reset refused: Confirm with --confirm clientflow_demo (the database this would wipe).
dev database clientflow  → demo:reset refused: Database "clientflow" is not a demo database (its name has no "demo").
```

A workspace without the demo flag is refused in `demo.test.ts` ("This database holds a workspace that is not a demo. Nothing was deleted."). The compiled `node apps/api/dist/cli/demo-reset.js` gives the same refusal.

**Demo contents** (query on `clientflow_demo` after a reset):

```
users by role     | OWNER=1, ADMIN=1, SALES_MANAGER=1, SALES=2, PM=1, MEMBER=2, FINANCE=1, CLIENT=3
client orgs 3 · contacts 20 · deals OPEN=6 WON=3 LOST=1
proposals ACCEPTED=3 IN_REVIEW=1 · proposal versions 5
projects ACTIVE=2 ON_HOLD=1 · tasks 25 + 1 from the accepted change · overdue tasks 5
changes ACCEPTED=1 AWAITING_CLIENT=1 REJECTED=1
deliverables APPROVED, REVISION_REQUESTED, PUBLISHED (awaiting the client), READY (draft)
invoices PAID=1 PARTIALLY_PAID=1 ISSUED=2 (one overdue) DRAFT=1 · payments 2
files 4 · audit events 239 · pending jobs 0 · is_demo true
```

A full reset takes about 27 s and replaces the old demo, including its stored files.

**Browsers and widths:**

| Run                                     | Result                                            |
| --------------------------------------- | ------------------------------------------------- |
| Full E2E suite, Edge (Chromium)         | 60 passed (13.2 min)                              |
| Full E2E suite, Firefox 1555            | 60 passed (19.5 min)                              |
| Full E2E suite, WebKit 2370 (first run) | 2 real failures: deal drag; skip link (see below) |
| Full E2E suite, WebKit, after the fix   | 59 passed, 1 skipped (Tab skips links in WebKit)  |
| Demo tour, Chromium                     | 8 passed                                          |
| Demo tour, Firefox                      | 8 passed                                          |
| Demo tour, WebKit                       | 7 passed, 1 skipped (the same keyboard reason)    |

The tour checks axe (WCAG 2.2 AA rules), no page-level sideways scroll at 360, 390, 768, 1024, 1280, 1440 and 1920 px, and reflow at 640 and 320 CSS px (200% and 400% zoom of 1280 px). The last change before the report (milestone dates in the seed) was re-checked by the Chromium tour only.

**The WebKit drag bug:** a probe page showed `setData('text/deal-id', …)` arriving empty on drop in WebKit, while `text/plain` worked in all three engines. The card now sets both. The drag test passes in Edge, Firefox and WebKit.

**Lighthouse** (`docs/milestones/m12-lighthouse.txt`, demo data, production build, 127.0.0.1):

| Page               | Before (M11 code) | Shipped M12            |
| ------------------ | ----------------- | ---------------------- |
| `/app/dashboard` m | 81 / 78           | 85 / 84 / 85 / 84 / 86 |
| `/app/dashboard` d | —                 | 99 / 91 / 99           |
| `/login` mobile    | 89–90 (same day)  | 88 / 89 / 87           |

Two other changes were measured and **not kept**: preloading the session request (no change), and one chunk for all shared app code (dashboard 85, but sign-in fell to 87–90).

**Screenshots:** `docs/milestones/m12-screenshots/`: dashboard, leads, deals, project, task board, invoices, portal proposals and portal project, each at all seven widths.

## Tests actually run (command, environment, pass/fail)

Windows 11, Node 24.19.0, PostgreSQL 17 in Docker, Edge, Playwright 1.64.1.

| Command                                       | Result                                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `npm run lint` / `typecheck` / `format:check` | pass                                                                                             |
| `npm test` (API on real PostgreSQL)           | 348 passed, 24 files (was 337)                                                                   |
| `npm run test:web`                            | 74 passed, 12 files, twice in a row. Before the timeout change: 1, then 4 typing tests timed out |
| `npm run e2e` (Edge)                          | 60 passed                                                                                        |
| `E2E_BROWSER=firefox npm run e2e`             | 60 passed                                                                                        |
| `E2E_BROWSER=webkit npm run e2e`              | 59 passed, 1 skipped                                                                             |
| `npm run demo:tour` (three engines)           | 23 passed, 1 skipped                                                                             |
| `npm run build`                               | pass                                                                                             |
| `npm audit --omit=dev --audit-level=high`     | 0 vulnerabilities                                                                                |
| gitleaks 8.24.3 (86 commits, new folders)     | no leaks found                                                                                   |
| CI on PR #111 after the readiness fix         | all checks pass, including E2E, Trivy and CodeQL                                                 |

## Authorization and negative testing evidence

- `demo.test.ts` signs in as each of the three client users and checks that each sees exactly their own organization's projects and published invoices, and that every other organization's project answers 404.
- The demo guards are tested both ways (refused and accepted).
- `DEMO_MODE` with a transport that could deliver is refused at startup (tested).
- The permission matrix (155 endpoints × roles) still passes. No endpoint was added: the demo writes through the existing API.

## Open bugs and security risks

| #   | Item                                                                                                                                                                          | Severity       | Owner             |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ----------------- |
| R42 | No real users have tried the product (pilot plan ready)                                                                                                                       | High           | **Project owner** |
| R41 | Real Safari and iOS not tried (WebKit build only)                                                                                                                             | Medium         | Project owner     |
| R40 | A public demo could be abused; needs a reset schedule before hosting                                                                                                          | Medium         | Project owner     |
| R39 | A demo reset against real data (four checks, tested)                                                                                                                          | Low / Critical | Engineering       |
| R38 | Dashboard mobile performance at the edge (84–86)                                                                                                                              | Low            | Engineering       |
| —   | No MFA, no antivirus engine, no error tracking (threat model)                                                                                                                 | Medium–High    | Engineering/owner |
| —   | A `pg` deprecation warning ("client.query() while already executing") appears while seeding; its source is not traced yet. Harmless today, but it must be found before `pg@9` | Low            | Engineering       |

## Not run / blocked, with steps

- **Pilot sessions:** follow `docs/22_PILOT_PLAN.md` (10 tasks, about 40 minutes each, at least 3 agency users and one client).
- **Screen reader:** NVDA on Windows (free) through sign-in, adding a lead, the portal proposal and a deliverable decision; record what is announced.
- **Real Safari/iOS:** the demo tour's journeys by hand on an iPhone and a Mac.
- **Hosted demo:** after hosting is chosen; `node apps/api/dist/cli/demo-reset.js --confirm <db>` on a schedule.

## Next milestone plan / decisions needed

The spec's next milestone is **M13+ — AI** (opt-in summaries and drafts, privacy controls, prompt-injection tests). I recommend **not** starting it yet. AI adds a third-party data flow, and the product has not been tried by a single real user or run on a real host.

**Recommended next step (needs your decisions first): M12.1 — Staging and pilot**

1. Deploy staging plus a demo on the hosting you choose; run the restore drill and the security smoke there.
2. Connect the email provider you choose (SPF, DKIM, DMARC).
3. Run the pilot sessions; fix severity-3 findings.
4. Add MFA for Owners and Admins and an antivirus engine for uploads.

If you prefer, M13 (AI) can start instead, as the spec orders it.

**Decisions needed from you:**

- Hosting and domain; email provider.
- Retention periods and backup schedule (RPO/RTO); a legal review.
- Who takes part in the pilot.
- Whether a public demo should exist, and how visitors get the demo accounts.
- Review the "My role" section of the case study: it is written in your voice.

---

## ملخص للمالك (بالمصري)

- **اللي اتعمل في M12 (نسخة العرض والتوثيق النهائي):**
  - **نسخة ديمو كاملة:**
    - أمر واحد (`npm run demo:reset`) بيبني شركة وهمية فيها فريق كامل (9 موظفين) و3 عملاء، كل عميل ليه حساب في البورتال؛
    - فيها عملاء محتملين وصفقات وعروض أسعار ومشاريع ومهام وطلبات تغيير وملفات وفواتير؛
    - كل ده اتعمل من خلال البرنامج نفسه، يعني نفس الصلاحيات ونفس القواعد بالظبط؛
    - الأمر بيرفض يشتغل على أي قاعدة بيانات حقيقية، وجربنا ده فعلاً؛
    - وكل صفحة في الديمو مكتوب فيها إن البيانات وهمية.
  - **أدلة استخدام** لكل دور: المالك والأدمن، والمبيعات، والمشاريع، والحسابات، والعميل.
  - **اختبار على 3 متصفحات:**
    - كل التستات نجحت على Edge وFirefox وWebKit (المحرك بتاع Safari)؛
    - WebKit طلّع مشكلة حقيقية: سحب الصفقة من عمود لعمود ماكانش بيشتغل، واتصلحت.
  - **السرعة:** الداشبورد على الموبايل بقى 84–86 بدل 78–81، يعني وصل للهدف (85) بالعافية.
  - **مستندات:** دراسة حالة للبورتفوليو بصور حقيقية، وقائمة جاهزية الإطلاق، وتحليل المخاطر الأمنية، وخطة تجربة مع مستخدمين حقيقيين.
  - **وصلحت مشكلة الـ CI** في PR #111، وكل الفحوصات بقت ناجحة.
- **التستات:** 348 للـ API، و74 للواجهة، و60 E2E على كل متصفح، كلهم ناجحين.
- **اللي لسه ماحصلش:**
  - مفيش مستخدم حقيقي جرّب البرنامج لحد دلوقتي؛
  - ماجربناش قارئ الشاشة ولا Safari على آيفون أو ماك حقيقي.
- **محتاج منك:**
  - تختار الاستضافة وشركة الإيميل؛
  - تحدد مدة الاحتفاظ بالبيانات وجدول الباك أب، وتخلي محامي يراجع؛
  - تجيب 3 أشخاص من وكالات وعميل واحد يجربوا البرنامج؛
  - تراجع جزء "دوري" في دراسة الحالة لأنه مكتوب على لسانك؛
  - تقرر: نبدأ M13 (الذكاء الاصطناعي) زي ما الخطة بتقول، ولا الأول نرفع البرنامج على سيرفر تجريبي ونعمل التجربة مع المستخدمين (وده اللي أنا بنصح بيه).
