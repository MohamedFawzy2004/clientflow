# Pilot session checklist

Use with [`../22_PILOT_PLAN.md`](../22_PILOT_PLAN.md). One copy per session. Results go in
[`feedback-sheet.csv`](feedback-sheet.csv), one row per finding.

## Where to run it

- **In person, on your laptop (simplest):** `npm run db:up`, then
  `DEMO_MODE=true npm run demo:reset -- --confirm clientflow_demo` with `DATABASE_URL` pointing at the
  demo database, then `npm run dev`. The participant uses your screen or a second browser window.
- **Remotely:** needs a separate demo deployment (its own service, database and disk with
  `DEMO_MODE=true`), never the staging workspace. Ask before setting one up: it adds cost.

## Before (10 minutes)

- [ ] Fresh demo: run `demo:reset` again, so earlier sessions leave nothing behind.
- [ ] Open `apps/api/.demo-credentials.local.json` and note only the seat's account. Hand the password
      over in person, never by email or chat.
- [ ] Sign in once as that seat to check it works, then sign out.
- [ ] Phone ready for at least one session (open the address on the same network, or use the remote
      demo).
- [ ] Note-taker has the feedback sheet open and knows the severity scale.
- [ ] Read the intro aloud: "We are testing the product, not you. Think aloud. There are no wrong
      answers. I will not help unless you are stuck for two minutes."

## During (30–40 minutes)

- [ ] Give one task at a time, in the plan's words. Do not point at the screen.
- [ ] Start a timer per task. Stop it when they say they are done or give up.
- [ ] Write down exact quotes at moments of hesitation.
- [ ] Note where they looked first, and any wrong click.
- [ ] Mark each task: done / done with help / not done.

## After (10 minutes)

- [ ] Ask the four closing questions in the plan.
- [ ] Thank them. Do not explain the "right" way unless they ask.
- [ ] Within the hour: enter every finding in the sheet with a severity.
- [ ] Reset the demo before the next session.

## Severity

| Level | Meaning                                                           |
| ----- | ----------------------------------------------------------------- |
| 1     | Cosmetic: noticed but did not slow them down                      |
| 2     | Slowed them down or confused them, but they finished              |
| 3     | Blocked the task, or led to a wrong result (fix before real data) |
