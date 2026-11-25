# Redesign inventory: ClientFlow, Relationship & Revenue Intelligence

Branch `feat/revenue-intelligence-ui`. This file lists what the redesign delivers and how complete
each piece is.

- **Implemented**: shipped on this branch and covered by tests or screenshots.
- **Partial**: shipped, with a stated gap.
- **Proposed**: specified only, in [03_PROPOSALS.md](03_PROPOSALS.md). Nothing was built.

Every figure on every screen comes from data the API already stores. The redesign added no
backend endpoints, no migrations and no new dependencies. It shows no fabricated numbers. Nothing
is labelled "AI": every signal is a fixed rule, documented in
[02_DATA_SOURCES.md](02_DATA_SOURCES.md).

## Identity and shell

| Item                                                                               | State       | Where                                                                                         |
| ---------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------- |
| Tokens: forest, jade, mint, violet, warm neutral and ivory, adjusted for AA        | Implemented | `apps/web/src/styles/index.css`                                                               |
| Brand mark and wordmark                                                            | Implemented | `components/ui/brand.tsx`                                                                     |
| Grouped navigation: Overview, Relationships, Revenue, Delivery, Finance, Workspace | Implemented | `app/nav.ts`, `app/AppShell.tsx`                                                              |
| Live follow-up counter in the navigation                                           | Implemented | Overdue plus due today, from `counts` in `/api/v1/follow-ups`. Mint when something is overdue |
| Command palette (Ctrl K / ⌘ K): pages and lead search                              | Implemented | `app/CommandPalette.tsx`                                                                      |
| Quick create: add a lead, start a deal, import leads; filtered by permission       | Implemented | `AppShell.tsx` (dialogs load on first open)                                                   |
| Phone layout: top bar and a drawer with the same groups                            | Implemented | `AppShell.tsx`                                                                                |
| A tab title for every page                                                         | Implemented | `DocumentTitle` in `components/ui/page.tsx`                                                   |
| Reduced motion: every transition and animation turned off                          | Implemented | `index.css` (`prefers-reduced-motion`)                                                        |

## Screens

| Screen                                                       | State                 | Notes                                                                                                                                                                                                                                             |
| ------------------------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard command center                                     | Implemented           | Greeting, "Needs your attention", pipeline stage flow, won value by month (one chart per currency), lead sources with client conversion, follow-up load heat strip, next conversations, then the role sections (sales results, delivery, finance) |
| Pipeline board                                               | Implemented           | Kanban with drag-and-drop and a keyboard "Move to stage" select. Per-currency totals per stage. Stalled and no-next-step signals. Filters: owner, signal, search. URL-synced deal drawer                                                          |
| Pipeline list                                                | Implemented           | Table view with the same filters and signals                                                                                                                                                                                                      |
| Deal drawer                                                  | Implemented           | `/app/deals?deal=<id>`: stage, value, next step, signals, links. Closes with Esc                                                                                                                                                                  |
| Deal page                                                    | Implemented (restyle) | The existing workflow kept, in the new type and panels                                                                                                                                                                                            |
| Client 360 (lead page)                                       | Implemented           | Header with relationship facts, money per currency (open, won, proposed, invoiced, paid), deals, proposals, projects and invoices, timeline and composer, "Open relationship map"                                                                 |
| Relationship map                                             | Implemented           | `/app/relationships?focus=<contactId>`, from persisted foreign keys only. Node size is degree. Kind filters, focus and expand, a link to each record, an accessible list view (the default on phones)                                             |
| Leads list                                                   | Implemented (restyle) |                                                                                                                                                                                                                                                   |
| Follow-ups                                                   | Implemented (restyle) | Overdue, due today, next 7 days, no next step                                                                                                                                                                                                     |
| Proposals, projects, invoices lists                          | Implemented (restyle) | Shared page header and panels                                                                                                                                                                                                                     |
| Project page                                                 | Implemented (restyle) | History scrolls inside its card (it reached 40 entries in the demo)                                                                                                                                                                               |
| Finance report                                               | Implemented           | Per-currency figures and an open-balance-by-age bar with a labelled legend                                                                                                                                                                        |
| Team, settings, notifications, services, cost rates, imports | Implemented (restyle) | Shared header, titles and states                                                                                                                                                                                                                  |
| Sign-in and auth pages                                       | Implemented (restyle) | Forest brand panel, demo role picker                                                                                                                                                                                                              |
| Client portal                                                | Implemented (restyle) | Same tokens, without the internal navigation                                                                                                                                                                                                      |

## Charts (reusable, `components/charts/charts.tsx`)

| Chart                                                                  | State       | Accessible form                         |
| ---------------------------------------------------------------------- | ----------- | --------------------------------------- |
| `StageFlow`: open deals per stage, one bar per currency                | Implemented | A real table (stage, count, value)      |
| `MonthlyColumns`: won value per month, one small multiple per currency | Implemented | A table with the month, value and count |
| `BarList`: ranked bars with an optional darker part                    | Implemented | A table                                 |
| `SplitMeter`: won vs lost                                              | Implemented | Both counts shown as text               |
| `DayHeat`: follow-ups per day                                          | Implemented | An ordered list with each day's count   |
| Aging bar (finance report)                                             | Implemented | A `dl` with every bucket and its amount |

## Intelligence (rules, not AI)

| Signal                                                                                             | State       | Rule                                                                                   |
| -------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------- |
| Stalled deal                                                                                       | Implemented | Open, 14 or more days since the last update, and either no next step or an overdue one |
| Needs attention                                                                                    | Implemented | Stalled, or an overdue next step, or no next step                                      |
| Follow-up load                                                                                     | Implemented | Count of scheduled next steps per agency day                                           |
| Lead score, win likelihood, forecast, saved views, stage-entered timestamps, org-level 360, digest | Proposed    | See `03_PROPOSALS.md`                                                                  |

## Known gaps (partial)

- **Lead sources chart.** It makes 14 small count requests (7 sources × all/clients). An aggregate
  endpoint is proposed.
- **Won by month.** It reads at most 5 pages × 100 won deals. If there are more, the panel says
  "Based on the latest 500 won deals: older months may be undercounted."
- **Relationship map.** Labels can still overlap when one deal has many children. Use the list
  view, or filter by kind.
- **Stalled rule.** It measures idle time from `updatedAt`, not from the date the deal entered its
  stage. No stage-entered timestamp is stored yet (proposed).
- **Full-page screenshots.** The desktop navigation is `position: fixed`, so it ends at the first
  screen height in the gallery images. In a browser it stays visible.
