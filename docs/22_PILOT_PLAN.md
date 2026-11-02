# Pilot plan: testing ClientFlow with real users

Spec §7.6 and §27 ask for tests with **3 to 5 real agency users** and **one person posing as a
client**. Those sessions have **not happened yet**. Recruiting people is the project owner's call.
This plan makes the sessions quick to run and the results comparable.

## Who

| Seat                    | Ideal participant                             | Signs in as (demo)                     |
| ----------------------- | --------------------------------------------- | -------------------------------------- |
| Agency owner or manager | Runs a small agency or studio                 | `owner@…`                              |
| Salesperson             | Handles leads and quotes                      | `sales.b@…`                            |
| Project manager         | Runs client projects                          | `pm@…`                                 |
| Team member or finance  | Designer/developer, or whoever sends invoices | `member.a@…` or `finance@…`            |
| Client                  | Someone who has bought agency services        | `client.2@portal…`, `client.1@portal…` |

## Setup (about 10 minutes)

1. `npm run demo:reset -- --confirm clientflow_demo` (see the deployment guide). Each session starts
   from a fresh demo.
2. Give the participant only their own account. Passwords are in
   `apps/api/.demo-credentials.local.json`; share them in person, never by email or chat.
3. Use the participant's own laptop or phone if possible. At least one session on a phone.
4. Tell them: "We are testing the product, not you. Think aloud. There are no wrong answers."

## Tasks (30–40 minutes, no help unless they are stuck for 2 minutes)

| #   | Seat     | Task                                                                                      | Success looks like                                                 |
| --- | -------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1   | Sales    | "A new lead called you today. Add them and plan the follow-up for Thursday."              | Lead saved with a next-action date                                 |
| 2   | Sales    | "Which of your follow-ups are overdue?"                                                   | Finds Follow-ups; names Youssef Nabil or Tamer                     |
| 3   | Sales    | "Prepare a quote for the law firm website deal and send it for approval."                 | Proposal with lines, submitted                                     |
| 4   | Manager  | "Approve Omar's proposal for Sayed Fashion House."                                        | Finds it waiting; approves                                         |
| 5   | PM       | "What is blocking the Nile Bakery project?"                                               | Finds the blocked task about pickup slots                          |
| 6   | PM       | "The client wants push alerts. Where is that change, and what is its status?"             | Finds CR on Delta, waiting for the client                          |
| 7   | Member   | "Log 1.5 hours on the catalogue import task for yesterday."                               | Time entry saved on the right task                                 |
| 8   | Finance  | "Which client owes money that is overdue? Record a payment of 5,000 USD."                 | Finds Delta's invoice; records a partial payment                   |
| 9   | Client 2 | "Look at the dashboard wireframes the agency sent you. Approve them or ask for a change." | Opens the deliverable and decides; gives a reason if not approving |
| 10  | Client 1 | "How much do you still owe, and when is it due?"                                          | Reads the open balance on the partly paid invoice                  |

## What to record per task

- **Completed?** yes / with help / no.
- **Time** in minutes.
- **Friction:** where they hesitated, misread or clicked the wrong thing (quote their words).
- **Severity:** 1 = cosmetic, 2 = slows them down, 3 = blocks or causes a wrong result.

After the tasks, ask:

1. "What was the most confusing moment?"
2. "What would stop you using this in your agency next month?"
3. "What is missing that you expected to find?"
4. On a scale of 1–5: "How confident would you be that a client cannot see another client's data?"

## Afterwards

- One row per finding in a shared sheet: session, task, quote, severity, proposed change.
- Fix severity-3 findings before any real client data goes in; record each change and re-test it.
- Summarise in the release checklist (`docs/15_RELEASE_CHECKLIST.md`). Do not count sessions that
  did not happen.

## Privacy

The demo holds only fictional data, so participants never see real client information. Note-takers
record no personal data about participants beyond a first name or seat label.
