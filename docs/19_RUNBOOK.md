# Operations runbook and incident response (SEC-22)

> This runbook is for whoever runs ClientFlow. Keep it next to the deployment guide (`docs/17_DEPLOYMENT.md`) and update it after every incident. It makes no promise that ClientFlow is free of vulnerabilities.

## First five minutes (any incident)

1. **Write down** the time, what you saw, and the request ID if there is one (every error screen shows it).
2. **Is the app up?** Open `/health/ready`:
   - `ok`: working.
   - `degraded`: background jobs are late (emails and reminders), the app itself works.
   - `503`: the database is unreachable.
3. **Look at Settings → System status and Background jobs** (Owner/Admin).
4. **Search the logs** for the request ID, or for `"level":50` (error) and `"level":60` (fatal) lines.
5. **Decide whether data may be exposed or lost.** If yes, follow _Security incident_ below.

## Common situations

| Symptom                                   | Likely cause                                          | What to do                                                                                                 |
| ----------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `/health/ready` is 503                    | Database down, wrong `DATABASE_URL`, network          | Check the database service; restart the app after it is back                                               |
| `degraded` / "Background jobs are behind" | Worker stopped, or many emails failing                | Check the logs for worker errors; restart; see failed jobs in Settings; retry them once the cause is fixed |
| Many failed jobs                          | Email provider down or wrong settings                 | Fix the settings, then **Retry** each job (each retry is audited; emails are not sent twice)               |
| Everyone gets "Too many attempts"         | Rate limit hit from one shared IP (office NAT)        | Check `TRUST_PROXY`; wait 15 minutes; limits reset by themselves                                           |
| Files cannot be downloaded                | File volume missing, or a wrong `FILE_ENCRYPTION_KEY` | Never generate a new key: restore the right one from the secret manager                                    |
| App container restarts in a loop          | An uncaught error at start (bad env)                  | Read the first log lines: the app names the variable it refuses                                            |

## Security incident

Examples: a leaked password or key, an unknown admin account, data seen by the wrong client, a suspicious upload.

1. **Contain.**
   - Deactivate the affected accounts (Team → Deactivate; this ends their sessions).
   - Rotate `CSRF_SECRET` (this signs everyone out).
   - Rotate the database password if it may have leaked.
   - Do **not** delete logs or audit events.
2. **Assess.** Use the audit log (`audit_events`, append-only) and the request logs to find what was accessed, when, and by whom. Portal denials are logged as `portal.access_denied`.
3. **Fix** the cause, and add a test that would have caught it.
4. **Inform.** The project owner decides who must be told (affected clients, authorities) and by when, with legal advice (`docs/18_PRIVACY_RETENTION.md`).
5. **Review.** Write a short note: what happened, impact, timeline, what changed. Add the risk to `docs/RISK_REGISTER.md`.

**`FILE_ENCRYPTION_KEY` leaked:**

- Files must be re-encrypted with a new key. There is no tool for this yet (R26).
- Until there is, keep the old key secret and restrict who can reach the file volume.

## Restore after data loss

1. Stop writes: scale the app to zero, or show a maintenance page.
2. Pick the backup to restore:
   - for the latest data, platform point-in-time recovery;
   - otherwise, a `npm run backup` folder.
3. **First restore into a separate database** with `npm run restore` (`docs/17_DEPLOYMENT.md`), and continue only when it reports `RECONCILED`.
4. Point a staging copy of the app at the restored database and check it.
5. Switch production to the restored database and volume, and restart. Check `/health/ready`, sign in, and open a few records and files.
6. Tell the team what period of work was lost (between the backup and the incident).

## Routine

| When          | Task                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------- |
| Every release | Back up, run migrations, deploy, check `/health/ready`                                      |
| Weekly        | Look at Settings → Background jobs (failed) and System status                               |
| Monthly       | Rebuild and redeploy the image (base-image security fixes); review `npm audit` and CI scans |
| Quarterly     | Restore drill into an isolated database; keep the output                                    |
| Yearly        | Review roles, the people with Owner/Admin, and this runbook                                 |
