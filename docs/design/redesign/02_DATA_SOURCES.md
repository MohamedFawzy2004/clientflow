# Data sources: every chart, figure and signal

Every number in the redesign comes from data the API already persists, read through existing
endpoints. Each endpoint is scoped on the server to what the signed-in role may read. A sales rep
sees only their own deals, so their charts count only their own deals. The redesign does not
invent, estimate or pad any value.

## Money rule

Amounts are integer minor units, sent as strings. The browser sums them per currency with
`BigInt` and formats them with `formatMoney` from `@clientflow/contracts`. A total never combines
two currencies. A chart with money draws one series or small multiple per currency. `Number()` is
used only to size a bar's width, never to print an amount.

## Dashboard

| Panel                                 | Question it answers                                             | Source                                                                                           | Limits                                                                                                                     |
| ------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Needs your attention                  | What should I act on now?                                       | `GET /api/v1/reminders` and the follow-ups queue                                                 | As the endpoints return them                                                                                               |
| Pipeline (`StageFlow`)                | How many open deals are in each stage, and what are they worth? | `GET /api/v1/deals/board` (default pipeline, open deals)                                         | The board returns at most 100 deals per stage. The panel says so when a stage is cut                                       |
| Won value by month (`MonthlyColumns`) | How much did we win each month?                                 | `GET /api/v1/deals?status=WON&limit=100&page=n`, bucketed by close month in the agency time zone | At most 5 pages (500 deals). If cut, the panel says "Based on the latest 500 won deals: older months may be undercounted." |
| Lead sources (`BarList`)              | Where do leads come from, and how many became clients?          | `GET /api/v1/contacts?limit=1&source=X[&lifecycle=CUSTOMER]`, reading `meta.total`               | 14 count requests (7 sources × 2). Archived contacts are excluded, as on the Leads page                                    |
| Follow-up load (`DayHeat`)            | How busy are the next 14 days?                                  | `GET /api/v1/follow-ups`, next-step times bucketed by agency day                                 | Only what the queue returns (overdue, today, next 7 days). Later days show 0 unless scheduled within the queue's window    |
| Next conversations                    | Who do I talk to next?                                          | `GET /api/v1/follow-ups`                                                                         | First items of each group                                                                                                  |
| Results (sales section)               | How is the pipeline converting?                                 | `GET /api/v1/dashboard/sales` with the owner and period filters (unchanged API)                  | Server-side aggregate                                                                                                      |
| Win rate (`SplitMeter`)               | Won vs lost in the period                                       | Same `dashboard/sales` response                                                                  | Counts only                                                                                                                |
| By owner                              | Who is carrying what?                                           | Same response, `byOwner`                                                                         | Managers and owners only (server-scoped)                                                                                   |
| Delivery                              | What is late or waiting?                                        | `GET /api/v1/dashboard/delivery` (unchanged)                                                     | Server-side aggregate                                                                                                      |

## Pipeline

| Element                                           | Source                                    | Notes                                                                             |
| ------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------- |
| Board columns and stage totals                    | `GET /api/v1/deals/board`                 | Totals are per currency for each stage, one line per currency                     |
| List view                                         | `GET /api/v1/deals` (paged)               | Same filters as the board                                                         |
| Owner filter                                      | `GET /api/v1/sales/assignable-owners`     |                                                                                   |
| Stage move (drag or the "Move … to stage" select) | `POST /api/v1/deals/:id/move` (unchanged) | The board refetches after the move; an error shows a toast and the card stays put |
| Deal drawer                                       | `GET /api/v1/deals/:id`                   | URL: `/app/deals?deal=<id>`                                                       |

### Deal signals (`apps/web/src/lib/deal-signals.ts`)

These are fixed rules, not predictions:

- **Idle days**: whole days since `deal.updatedAt`.
- **No next step**: the deal is open and has no `nextStepAt`.
- **Next step overdue**: `nextStepAt` is in the past.
- **Stalled**: the deal is open, has 14 or more idle days (`STALL_DAYS`), and either has no next
  step or an overdue one.
- **Needs attention**: stalled, or a next step is overdue, or there is no next step. Because a
  stalled deal always has one of the other two, this equals "no next step or an overdue one";
  stalled is the stronger flag shown on the card.

The rule is written next to the filter on the pipeline and in the drawer, so the user can see why
a deal is flagged.

**Known limit.** Any edit resets `updatedAt`, so an edited deal looks fresh even if its stage has
not moved. A stage-entered timestamp is proposed in `03_PROPOSALS.md`.

## Client 360 (`features/leads/client360.ts`)

| Block                                             | Source                                            | Link used                                            | Cap |
| ------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------- | --- |
| Contact, owner, organization, deals               | `GET /api/v1/contacts/:id` (contact with deals)   | Direct                                               |     |
| Proposals                                         | `GET /api/v1/proposals`                           | `proposal.contact.id`                                | 200 |
| Projects                                          | `GET /api/v1/projects`                            | `project.fromDeal.id` is one of this contact's deals | 200 |
| Invoices                                          | `GET /api/v1/invoices`                            | `invoice.project.id` is one of those projects        | 500 |
| Money strip (open, won, proposed, invoiced, paid) | The rows above, summed per currency               |                                                      |     |
| Timeline                                          | `GET /api/v1/contacts/:id` activities (unchanged) |                                                      |     |

A block is hidden when the role lacks the matching read permission (`linkedAccess`). It never
shows more than the dedicated list page would.

## Relationship map (`features/relationships/graph.ts`)

Every link is a persisted foreign key. Nothing is inferred.

| Edge                                                  | Field                                |
| ----------------------------------------------------- | ------------------------------------ |
| contact → owner (person)                              | `contact.owner`                      |
| contact → client organization                         | `contact.clientOrg`                  |
| contact → deal                                        | `deal.contact` (the contact's deals) |
| deal → owner, when different from the contact's owner | `deal.owner`                         |
| deal → proposal                                       | `proposal.deal`                      |
| deal → project                                        | `project.fromDeal`                   |
| project → manager                                     | `project.manager`                    |
| project → invoice                                     | `invoice.project`                    |

- **Node size.** Node size encodes degree: the number of links the node has in this graph. The
  legend says so.
- **Layout.** A radial tree, breadth first from the contact, one ring per step.
- **Kind filters.** These hide a kind and everything that reaches the contact only through it.
- **Focus picker.** `GET /api/v1/contacts?limit=50&q=…`.
- **Caps.** The same proposal, project and invoice caps as the Client 360 apply.

## Finance report

| Element                                                         | Source                                                                                    |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Figures per currency (invoiced, received, outstanding, overdue) | `GET /api/v1/reports/finance` (unchanged), `totals[]`                                     |
| Open balance by days past due                                   | Same response, `aging` buckets. The bar is one hue, light to dark, because age is ordered |
| Invoice rows and CSV                                            | Same response, and the existing export URL                                                |

## Navigation counter

The Follow-ups counter is `counts.overdue + counts.today` from `GET /api/v1/follow-ups`. The pill
turns mint when something is overdue. Its accessible name spells out both numbers.
