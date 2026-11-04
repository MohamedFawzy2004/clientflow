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

| Symptom                                     | Likely cause                                                                                              | What to do                                                                                                                                                                                             |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/health/ready` is 503                      | Database down, wrong `DATABASE_URL`, network                                                              | Check the database service; restart the app after it is back                                                                                                                                           |
| `degraded` / "Background jobs are behind"   | Worker stopped, or many emails failing                                                                    | Check the logs for worker errors; restart; see failed jobs in Settings; retry them once the cause is fixed                                                                                             |
| Many failed jobs                            | Email provider down or wrong settings                                                                     | Fix the settings, then **Retry** each job (each retry is audited; emails are not sent twice)                                                                                                           |
| Everyone gets "Too many attempts"           | Rate limit hit from one shared IP (office NAT)                                                            | Check `TRUST_PROXY`; wait 15 minutes; limits reset by themselves                                                                                                                                       |
| Files cannot be downloaded                  | File volume missing, or a wrong `FILE_ENCRYPTION_KEY`                                                     | Never generate a new key: restore the right one from the secret manager                                                                                                                                |
| App container restarts in a loop            | An uncaught error at start (bad env)                                                                      | Read the first log lines: the app names the variable it refuses                                                                                                                                        |
| Someone lost their phone (two-step sign-in) | Authenticator app gone                                                                                    | They sign in with a recovery code. Without one, an Owner opens **Team → the person → Reset two-step sign-in**. For the last Owner: `node apps/api/dist/cli/reset-mfa.js --email …` in the server shell |
| "Uploads are paused" / scanner unreachable  | ClamAV service down or still loading signatures (a few minutes after a restart)                           | Check the `clientflow-clamav` service; Settings → System status shows when it answers again. Uploads are refused meanwhile, never stored unscanned                                                     |
| Deploy failed in the pre-deploy step        | A migration failed; the previous release keeps running                                                    | Read the step's log (`Migration … failed and was rolled back: …`). Fix the cause, then mark the failed row resolved (below) and deploy again                                                           |
| Emails stop arriving                        | Resend key revoked, domain not verified, or quota                                                         | Resend dashboard → Logs; Settings → Jobs shows failed jobs; retry them once fixed                                                                                                                      |
| "Too many attempts" on the two-step code    | 10 wrong codes or step-up passwords in 15 minutes locked the account's second step                        | The person got an email. Wait 15 minutes. If they did not cause it, treat the password as stolen: reset it and end their sessions (audit rows `mfa.account_locked`, `mfa.check_refused`)               |
| The app refuses to start: MFA or antivirus  | Production needs OWNER and ADMIN in `MFA_REQUIRED_ROLES`, and `CLAMAV_HOST` or `UPLOAD_SCAN=builtin-only` | Fix the variable the log names. Choose `builtin-only` only on purpose, and note it in R25                                                                                                              |
| Owners and admins are signed out often      | Their sessions end after 1 hour idle and 24 hours in total (security audit F5)                            | Expected. Other roles keep 12 hours idle and 7 days                                                                                                                                                    |

### Resolving a failed migration

The migration runner records a failed migration in `_prisma_migrations` and refuses to deploy again until a person has looked at it, as Prisma does (P3009). Each migration runs in one transaction, so a failure leaves the schema as it was. After fixing the cause (usually data that breaks a new constraint), remove the failed row so the runner retries it:

```sql
DELETE FROM "_prisma_migrations" WHERE migration_name = '<name>' AND finished_at IS NULL;
```

Never delete a row whose `finished_at` is set: that migration was applied.

### Stored files without a row, and rows without a file

An upload writes the encrypted object first and its database row second, so a crash between the two leaves an object nothing points to. Such objects only take disk space. The report finds them, and also finds rows whose object is missing (those files cannot be downloaded):

```bash
npm run files:orphans                # report only, changes nothing
npm run files:orphans -- --delete    # also removes orphans older than 24 hours
```

In the server shell, run `node apps/api/dist/cli/files-orphans.js` (add `--delete` to remove). Run it with the `DATABASE_URL` and `FILE_STORAGE_DIR` of the **same** environment. Deletion is refused when the two do not look like a pair: for example, no file rows at all, or more than half the objects without a row (a restored database or another environment's folder). Exit code 1 means some rows have no object: restore that volume from backup, and never delete those rows to make the report clean. Exit code 2 means deletion was refused.

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

**Invitation link shown to the inviter** (audit row `invitation.link_revealed`): the email did not go out, so the inviter was given the link to pass on. If the account was then activated by someone other than the invitee, deactivate it and invite again.

## Before real data: open security work

- **Backups are plain text (R49).** `npm run backup` writes `db.dump` and the files unencrypted. Keep the `backups` folder on an encrypted disk, never in the repo or the image, and delete copies you no longer need.
- **Split the database roles (R48).** Today one user both migrates and runs the app. Create a migration role that owns the schema and a runtime role with only `SELECT, INSERT, UPDATE, DELETE` on the tables and `USAGE` on the sequences, run the pre-deploy migration with the first and the app with the second, then rerun the full test suite and the staging check.
- **ClamAV limits (R50).** In the scanner's `clamd.conf`, set `AlertExceedsMax yes` so files over the scan limits are reported, not passed; then upload a large archive on staging and confirm it is refused.
- **`TRUST_PROXY` (R51).** After the first deploy and after any proxy change, run `scripts/staging-check.mjs` and confirm the client IP it reports is yours, not the proxy's.

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
| Monthly       | `npm run files:orphans` (report); remove old orphans with `--delete` if it lists any        |
| Quarterly     | Restore drill into an isolated database; keep the output                                    |
| Yearly        | Review roles, the people with Owner/Admin, and this runbook                                 |
