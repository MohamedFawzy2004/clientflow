# Final signature screenshots

These are screenshots of the running app (local redesign demo, real API) with the fictional demo
workspace: Lumen Digital Studio (demo). None of them is a mock-up. Every person, company and
amount is fictional and comes from `npm run demo:reset`, which builds the demo through the real
API.

Captured with Microsoft Edge (Playwright) and reduced motion. The capture script is described in
[FINAL_SIGNATURE_REPORT.md](../FINAL_SIGNATURE_REPORT.md#screenshots). Each screen has:

- `*-viewport.png`: what fits on the screen at that size, without scrolling (the clean shot).
- `*-full.png`: the whole page. In full-page shots the sticky sidebar ends at viewport height, and
  the floating "Create" button on phones appears where the viewport ended. Both are artifacts of
  full-page capture, not layout bugs.

Section shots (Gantt, dependency map, workload, selected node) are viewport-only, scrolled to the
section. Their full page is the parent screen's.

## Index

| #   | Screen                                  | 1440 × 900                                                                                                | 1920 × 1080                                                                                               |
| --- | --------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 01  | Executive dashboard (owner)             | [viewport](1440/01-executive-dashboard-viewport.png) · [full](1440/01-executive-dashboard-full.png)       | [viewport](1920/01-executive-dashboard-viewport.png) · [full](1920/01-executive-dashboard-full.png)       |
| 02  | Relationship map                        | [viewport](1440/02-relationship-map-viewport.png) · [full](1440/02-relationship-map-full.png)             | [viewport](1920/02-relationship-map-viewport.png) · [full](1920/02-relationship-map-full.png)             |
| 03  | Relationship map, selected node         | [viewport](1440/03-relationship-selected-node-viewport.png)                                               | [viewport](1920/03-relationship-selected-node-viewport.png)                                               |
| 04  | Client 360                              | [viewport](1440/04-client-360-viewport.png) · [full](1440/04-client-360-full.png)                         | [viewport](1920/04-client-360-viewport.png) · [full](1920/04-client-360-full.png)                         |
| 05  | Pipeline board                          | [viewport](1440/05-pipeline-viewport.png) · [full](1440/05-pipeline-full.png)                             | [viewport](1920/05-pipeline-viewport.png) · [full](1920/05-pipeline-full.png)                             |
| 06  | Deal detail                             | [viewport](1440/06-deal-detail-viewport.png) · [full](1440/06-deal-detail-full.png)                       | [viewport](1920/06-deal-detail-viewport.png) · [full](1920/06-deal-detail-full.png)                       |
| 07  | Sales analytics (pipeline Insights)     | [viewport](1440/07-sales-analytics-viewport.png) · [full](1440/07-sales-analytics-full.png)               | [viewport](1920/07-sales-analytics-viewport.png) · [full](1920/07-sales-analytics-full.png)               |
| 08  | Proposals                               | [viewport](1440/08-proposals-viewport.png) · [full](1440/08-proposals-full.png)                           | [viewport](1920/08-proposals-viewport.png) · [full](1920/08-proposals-full.png)                           |
| 09  | Project portfolio (delivery)            | [viewport](1440/09-project-portfolio-viewport.png) · [full](1440/09-project-portfolio-full.png)           | [viewport](1920/09-project-portfolio-viewport.png) · [full](1920/09-project-portfolio-full.png)           |
| 10  | Gantt (project plan timeline)           | [viewport](1440/10-gantt-viewport.png)                                                                    | [viewport](1920/10-gantt-viewport.png)                                                                    |
| 11  | Task dependency map                     | [viewport](1440/11-dependency-map-viewport.png)                                                           | [viewport](1920/11-dependency-map-viewport.png)                                                           |
| 12  | Team workload                           | [viewport](1440/12-team-workload-viewport.png)                                                            | [viewport](1920/12-team-workload-viewport.png)                                                            |
| 13  | Financial intelligence (finance report) | [viewport](1440/13-financial-intelligence-viewport.png) · [full](1440/13-financial-intelligence-full.png) | [viewport](1920/13-financial-intelligence-viewport.png) · [full](1920/13-financial-intelligence-full.png) |
| 14  | Invoices                                | [viewport](1440/14-invoices-viewport.png) · [full](1440/14-invoices-full.png)                             | [viewport](1920/14-invoices-viewport.png) · [full](1920/14-invoices-full.png)                             |
| 15  | Client portal home                      | [viewport](1440/15-client-portal-viewport.png) · [full](1440/15-client-portal-full.png)                   | [viewport](1920/15-client-portal-viewport.png) · [full](1920/15-client-portal-full.png)                   |
| 16  | Client portal project                   | [viewport](1440/16-client-portal-project-viewport.png) · [full](1440/16-client-portal-project-full.png)   | [viewport](1920/16-client-portal-project-viewport.png) · [full](1920/16-client-portal-project-full.png)   |
| 17  | Authentication (sign in)                | [viewport](1440/17-authentication-viewport.png)                                                           | [viewport](1920/17-authentication-viewport.png)                                                           |

The full finance report (13, full) also shows the trends per currency and the estimated
profitability block (finance and admins only).

### Phone (390 × 844)

| #   | Screen             | Shots                                                                                                     |
| --- | ------------------ | --------------------------------------------------------------------------------------------------------- |
| 18  | Dashboard          | [viewport](mobile/18-mobile-dashboard-viewport.png) · [full](mobile/18-mobile-dashboard-full.png)         |
| 19  | Pipeline           | [viewport](mobile/19-mobile-pipeline-viewport.png) · [full](mobile/19-mobile-pipeline-full.png)           |
| 20  | Relationship map   | [viewport](mobile/20-mobile-relationship-map-viewport.png)                                                |
| 21  | Client portal home | [viewport](mobile/21-mobile-client-portal-viewport.png) · [full](mobile/21-mobile-client-portal-full.png) |
| 22  | Sign in            | [viewport](mobile/22-mobile-authentication-viewport.png)                                                  |

### Zoom (accessibility reflow)

[`zoom-200/`](zoom-200) and [`zoom-400/`](zoom-400) show the dashboard, relationship map, Client 360,
pipeline Insights, delivery portfolio and portal home as a 1280 px window shows them at 200% and
400% zoom (640 and 320 CSS px). [`report.json`](report.json) lists every page, role and width
checked for horizontal overflow: 196 shots at 360, 390, 768, 1024, 1280, 1440 and 1920 px, plus
9 pages at each zoom level. [`final-report.json`](final-report.json) does the same for the set
above. Every entry is 0 px.

## Before and after

"Before" shots are the v0.13.0 portfolio set in [`docs/portfolio/screenshots/`](../../portfolio/screenshots),
taken on 4 Nov 2026 with the same demo data.

| Screen                                                          | Before (v0.13.0)                                                               | After                                                                                                                                                                              | What changed                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard                                                       | [dashboard-1440](../../portfolio/screenshots/dashboard-1440.png)               | [01 viewport](1440/01-executive-dashboard-viewport.png)                                                                                                                            | Light sidebar with capitalised group labels becomes the forest sidebar with collapsible groups. Seven equal KPI cards become a role-aware position strip: each tile states its rule, compares with the previous period and links to its records. Follow-ups, pipeline flow, results and delivery sit below. |
| Pipeline                                                        | [deals-1440](../../portfolio/screenshots/deals-1440.png)                       | [05 viewport](1440/05-pipeline-viewport.png)                                                                                                                                       | Same drag-and-drop board and rules. It adds stage totals per currency, stall and next-step signals, and a third view (Insights) with funnel, stage ageing and lead sources.                                                                                                                                 |
| Leads / Client 360                                              | [leads-1440](../../portfolio/screenshots/leads-1440.png)                       | [04 viewport](1440/04-client-360-viewport.png)                                                                                                                                     | The lead list stays. The contact page becomes a Client 360: pipeline and won value, a lifecycle strip (added → invoiced), deals, proposals, delivery and billing, contact details and a link into the relationship map.                                                                                     |
| Project                                                         | [project-1440](../../portfolio/screenshots/project-1440.png)                   | [10 Gantt](1440/10-gantt-viewport.png) · [11](1440/11-dependency-map-viewport.png)                                                                                                 | A new Plan tab: milestone timeline with task due dates, and a dependency map drawn only from stored dependencies.                                                                                                                                                                                           |
| Invoices                                                        | [invoices-1440](../../portfolio/screenshots/invoices-1440.png)                 | [14 viewport](1440/14-invoices-viewport.png)                                                                                                                                       | Same records and rules, in the new design system. The finance report adds trends per currency and estimated profitability.                                                                                                                                                                                  |
| Client portal                                                   | [portal-proposals-1440](../../portfolio/screenshots/portal-proposals-1440.png) | [15 viewport](1440/15-client-portal-viewport.png)                                                                                                                                  | A list of proposals becomes a home: what waits on the client, progress per project and what is left to pay.                                                                                                                                                                                                 |
| Client portal project                                           | [portal-project-1440](../../portfolio/screenshots/portal-project-1440.png)     | [16 viewport](1440/16-client-portal-project-viewport.png)                                                                                                                          | Adds a schedule line from start to due date with milestones and today, and correct review wording on decided deliverables.                                                                                                                                                                                  |
| Sign in                                                         | [login-demo-1440](../../portfolio/screenshots/login-demo-1440.png)             | [17 viewport](1440/17-authentication-viewport.png)                                                                                                                                 | New brand panel and palette. The same form, demo accounts note and security behaviour.                                                                                                                                                                                                                      |
| Relationship map, delivery portfolio, sales analytics, workload | none (new in this release)                                                     | [02](1440/02-relationship-map-viewport.png) · [09](1440/09-project-portfolio-viewport.png) · [07](1440/07-sales-analytics-viewport.png) · [12](1440/12-team-workload-viewport.png) | New screens, built on read-only, permission-scoped endpoints (ADR-072).                                                                                                                                                                                                                                     |
