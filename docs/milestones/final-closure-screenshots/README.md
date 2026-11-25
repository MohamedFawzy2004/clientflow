# Final closure screenshots

Real captures of running production builds. Nothing here is a mockup, and no image was edited.
Every person, company and amount is fictional demo data.

| Folder              | Build                                                                                            | Server                                       |
| ------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| `after/`            | Closure candidate: production build of `16c3272`. The application code is identical at `9c45661` | `node apps/api/dist/server.js`, demo mode on |
| `before-signature/` | Final signature release as first proposed: `1f18bfc` (PR #151 on GitHub)                         | Same, from a separate checkout               |

- **Captured:** 2026-11-25, both folders in one session, right after a demo reset.
- **Dataset:** `clientflow_redesign_demo`, rebuilt through the real API by the demo seed on
  2026-11-25. Both builds read the same database, so the data is identical.
- **Browser:** Microsoft Edge (Playwright, `channel: 'msedge'`). The phone sizes use Playwright's
  mobile emulation (`isMobile`, `hasTouch`). This is not a real phone, and not Safari.
- **Viewports:** `1440` = 1440 × 900, `1920` = 1920 × 1080, `mobile-360` = 360 × 800,
  `mobile-390` = 390 × 844, `mobile-430` = 430 × 932.
- **Roles:** Owner for every staff screen, a client user for the portal, and signed out for the
  sign-in page.
- **Page overflow:** 0 px on all 168 captures. `capture.json` in each folder records the path and
  the measured horizontal overflow for every image.

## Screens

| File                             | Screen                                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `01-login`                       | Sign-in page in demo mode (viewport)                                                                                            |
| `02-dashboard`                   | Dashboard with the executive strip (full page)                                                                                  |
| `03-relationship-map`            | Relationship map centred on a client                                                                                            |
| `04-relationship-selected-node`  | The same map with a node selected. On phones, `after/` shows the new details sheet at the bottom                                |
| `04b-relationship-list` (phones) | The map's list view                                                                                                             |
| `05-client-360`                  | A client's 360 page                                                                                                             |
| `06-pipeline`                    | Deals board                                                                                                                     |
| `06b-pipeline-list` (phones)     | Deals list view                                                                                                                 |
| `07-sales-insights`              | Deals → Insights                                                                                                                |
| `08-project-portfolio`           | Delivery portfolio                                                                                                              |
| `09-gantt`                       | Project plan timeline (`?view=timeline`). `after/` draws same-day tasks once with a count chip                                  |
| `09b-plan-agenda` (phones)       | Project plan without a view parameter. `after/` opens on the new agenda; `before-signature/` has none, so it shows the timeline |
| `10-dependency-map`              | Task dependencies on the plan                                                                                                   |
| `11-workload`                    | Open work by person                                                                                                             |
| `12-financial-intelligence`      | Finance report                                                                                                                  |
| `13-profitability-waterfall`     | Estimated profitability on the finance report                                                                                   |
| `14-invoices`                    | Invoices list. Both folders use the reset of 2026-11-25, so the corrected invoice dates show in both                            |
| `15-portal`                      | Client portal home                                                                                                              |

Phones get the four extra captures (`04b`, `06b`, `09b`) because their default views differ from
desktop. Desktop folders have 15 images each, phone folders 18.

The capture script is a local tool (Playwright, sign-in from the git-ignored demo credentials
file). It is not part of the repository.
