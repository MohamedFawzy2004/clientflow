# Proposals: intelligence features, specified but not built

Nothing in this file is implemented. Each proposal is a rule set or a stored fact that the owner
can approve, reject or reorder. None of them uses a model, and none should be called "AI" in the
product. A feature that calls an external model would also need a separate privacy and cost
review, under the owner rule "no new paid services".

The proposals are listed in a suggested order. The first ones make the existing signals more
accurate. The later ones depend on them.

---

## P1. Stage-entered timestamp

**Problem.** The stalled rule uses `deal.updatedAt`. Any edit, such as a renamed title, resets it,
so a deal can sit in "Proposal" for two months and still look fresh.

- **Stories.** As a sales manager, I see how long each deal has been in its current stage. As a
  rep, a deal I only edited still shows as stalled if it has not moved.
- **Data model.**
  - Add `Deal.stageEnteredAt timestamptz NOT NULL`. The migration backfills it from the latest
    `deal.stage_changed` activity, or from `createdAt`.
  - Add a `DealStageHistory(dealId, stageId, enteredAt, leftAt)` table, written in the same
    transaction as the move.
- **API.** `DealSummary` gains `stageEnteredAt`. `GET /api/v1/deals/board` and `/deals` return it.
  There are no new endpoints.
- **Permissions.** Unchanged (the deal's read scope).
- **UI.** The card shows "12 days in Proposal". The stalled rule switches to
  `stageEnteredAt`, and the documentation is updated.
- **Acceptance tests.**
  - Moving a deal sets `stageEnteredAt` to the time of the move.
  - Editing the title does not change it.
  - The backfill gives existing deals the time of their last stage change.
  - A deal 15 days in a stage with no next step is stalled, even if it was edited yesterday.

## P2. Aggregate endpoint for lead sources

**Problem.** The dashboard panel makes 14 count requests.

- **API.** `GET /api/v1/dashboard/lead-sources` → `[{ source, leads, clients }]`, one SQL
  `GROUP BY`, scoped like `/contacts`.
- **Permissions.** `contacts.read.*`.
- **Acceptance tests.**
  - The counts match `/contacts?source=X` totals for each role.
  - Archived contacts are excluded.
  - A rep sees only their own contacts' counts.

## P3. Saved views on the pipeline

- **Stories.** As a manager, I save "Stalled, Karim's deals, EGP" and open it from the
  navigation.
- **Data model.** `SavedView(id, agencyId, userId, page, name, query jsonb, shared boolean,
  createdAt)`. The query holds only whitelisted filter keys.
- **API.** `GET`, `POST`, `PATCH` and `DELETE` on `/api/v1/saved-views?page=deals`. Shared views
  are visible to the agency; private views to their owner only.
- **Permissions.** Anyone with `deals.read.*` can create private views. Shared views need
  `deals.read.all`.
- **Acceptance tests.**
  - Unknown filter keys are rejected with 422.
  - A rep cannot read another rep's private view (404).
  - Opening a view restores the URL filters exactly.

## P4. Rule-based lead score (shown as "Fit", with its reasons)

- **Rule.** Points for facts that are already stored:
  - a company name;
  - an email and a phone;
  - the source (referral and partner score highest);
  - a next step scheduled;
  - an activity in the last 14 days;
  - an open deal.

  The owner sets the weights in settings.
- **Data model.** `AgencyScoringRule(agencyId, factor, points)`. The score is computed on read; it
  is not stored.
- **API.** `ContactSummary.fit: { score, reasons[] }`.
- **UI.** A small "Fit 7/10" chip. Its tooltip lists each reason, such as "+2 referral".
- **Permissions.** Settings are owner and admin only. The score is visible to anyone who can read
  the contact.
- **Acceptance tests.**
  - The weights change the score.
  - The reasons add up to the score.
  - With no rules set, no chip shows.

## P5. Forecast from stage weights (explicitly a weighted sum, not a prediction)

- **Rule.** Each stage has a probability that the owner sets. Weighted pipeline =
  Σ amount × weight, per currency.
- **Data model.** `PipelineStage.weightPct int CHECK 0..100`.
- **API.** `GET /api/v1/dashboard/sales` gains `weighted[]`, per currency.
- **UI.** "Weighted pipeline", with "using your stage weights" and a link to edit them. It is
  never labelled a forecast without the word "weighted".
- **Acceptance tests.**
  - The weighted total equals the hand-computed sum per currency.
  - A stage weight of 0 removes that stage from the total.
  - There is no total across currencies.

## P6. Organization-level 360

- **Problem.** The 360 is per contact. Agencies often have three contacts at one client.
- **API.** `GET /api/v1/client-orgs/:id/summary` → contacts, deals, projects and invoices, plus
  money per currency. The server joins on persisted keys.
- **UI.** `/app/clients/:orgId`, with the same layout as the Client 360. The relationship map can
  be focused on an organization.
- **Permissions.** The intersection of the existing read scopes. A rep sees only their own
  contacts at the organization.
- **Acceptance tests.**
  - The totals equal the sum over the organization's contacts.
  - A rep's view omits other reps' deals.

## P7. Weekly digest (in-app first)

- **Rule.** Every Monday 08:00 agency time, a notification lists:
  - stalled deals;
  - overdue next steps;
  - invoices more than 30 days past due;
  - milestones due this week.
- **Data model.** The existing notifications table. A new type, `weekly_digest`.
- **Delivery.** In-app only. Email is a separate owner decision.
- **Acceptance tests.**
  - The digest content matches the dashboard rules on the same day.
  - It respects notification settings.
  - Only one digest is sent per user per week.

## P8. Relationship map: server-built graph

- **Problem.** The map joins three capped lists in the browser.
- **API.** `GET /api/v1/contacts/:id/graph?depth=3` → `{ nodes, edges }` built from foreign keys
  on the server, with no caps below the record limits.
- **Acceptance tests.**
  - Every edge has a stored key behind it.
  - The result is identical to today's browser graph when under the caps.
  - Read scopes are respected for each node.
