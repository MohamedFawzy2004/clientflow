# Demo video storyboard (about 2 minutes)

A plan for a short screen recording of the **fictional demo workspace**. Nothing is recorded yet; the owner records it.

**Setup**

- Build the demo with `DEMO_MODE=true npm run demo:reset -- --confirm clientflow_demo`, with `DATABASE_URL` pointing at the demo database. Run it on local staging, or on the public demo once it is deployed.
- Use a 1440 × 900 browser window, with system notifications off.
- Use no real names, emails or client data. The people and companies in the demo are invented.
- Show the "Demo workspace" banner in the first shot, and keep it visible.

**Captions**

- Short, on screen, and in English.
- No claims about customers, revenue or impact. The opening title is the only place that says "portfolio project".

| #   | Time      | Screen                                            | Action                                     | Caption                                                                                                                 |
| --- | --------- | ------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 1   | 0:00–0:08 | Sign-in page, demo panel                          | Pause on "Explore the demo"                | ClientFlow: agency operations, from lead to invoice. A portfolio project with fictional data.                           |
| 2   | 0:08–0:20 | Click **Sales manager**, dashboard                | Pipeline, win rate, "Needs your attention" | One sign-in per role. No passwords are published.                                                                       |
| 3   | 0:20–0:32 | Deals board                                       | Move a deal with the stage menu (keyboard) | Pipeline board, keyboard friendly; totals stay per currency.                                                            |
| 4   | 0:32–0:45 | Proposal with lines and VAT, then version history | Open a sent version                        | Sent versions are frozen in the database, so approvals stay provable.                                                   |
| 5   | 0:45–0:58 | Sign out; **Client**, portal proposal             | Show only this client's items              | The client portal shows one organization's data and nothing else.                                                       |
| 6   | 0:58–1:10 | **Project manager**, project, task board          | Change a task's status                     | A won deal becomes a project in one idempotent step.                                                                    |
| 7   | 1:10–1:22 | Change request                                    | Priced estimate → internal approval        | Extra work needs an accepted change, so scope creep is visible.                                                         |
| 8   | 1:22–1:34 | **Finance**, invoice                              | Issued INV number, partial payment         | Invoices freeze on issue; payments are reversed, never edited.                                                          |
| 9   | 1:34–1:46 | **Owner**, Files, then Team → invite              | "Uploads are off in the demo" / 403 notice | The public demo blocks account and upload actions on the server.                                                        |
| 10  | 1:46–1:58 | Phone width (360 px), portal project              | Scroll                                     | Responsive from 360 px; axe checks in three browser engines.                                                            |
| 11  | 1:58–2:05 | End card                                          | Repository URL                             | Code, tests and decisions: github.com/MohamedFawzy2004/clientflow. Built with an AI coding agent under milestone gates. |

**Do not show**

- browser developer tools with cookies;
- `.env` files;
- the local credentials file;
- any real inbox.
