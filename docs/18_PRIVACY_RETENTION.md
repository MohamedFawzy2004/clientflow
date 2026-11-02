# Privacy, retention and data requests

> **Status (M11):** this describes what ClientFlow **does today**, and proposes retention periods for the project owner to confirm. It is **not legal advice**, and it does not claim compliance with any law (GDPR, Egypt's Personal Data Protection Law No. 151 of 2020, or others). **Have it reviewed by a lawyer or privacy professional before real client data goes in (SEC-23).**

## What ClientFlow stores

| Data                                                               | Personal data                                                 | Where                                               | Who can see it                                          |
| ------------------------------------------------------------------ | ------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------- |
| Staff and client user accounts                                     | Name, email, role; a password **hash** (Argon2id)             | `users`                                             | Owner/Admin (team); each user sees their own            |
| Contacts (leads, customers)                                        | Name, email, phone, company, notes                            | `contacts`                                          | Sales roles, by ownership (spec §1.1)                   |
| Deals, proposals, projects, tasks, time, change requests, invoices | Names, amounts, free text                                     | their tables                                        | By role and project membership                          |
| Uploaded files                                                     | Whatever the file contains                                    | Encrypted (AES-256-GCM) on the file volume          | Project members; clients only what is published to them |
| Comments, notes, activity timeline                                 | Free text, names                                              | `project_comments`, `activities`                    | As the record they belong to                            |
| Notifications                                                      | Short titles with names                                       | `notifications`                                     | The recipient only                                      |
| Audit log                                                          | User IDs, actions, request IDs; no emails or text             | `audit_events` (append-only)                        | Database operators                                      |
| Sessions, reset links, invitations                                 | Only hashes of tokens                                         | `sessions`, `password_reset_tokens`, `invitations`  | Nobody in the app                                       |
| Background jobs, rate-limit counters, import runs                  | IDs, hashed emails, file hash and counts                      | `outbox_jobs`, `rate_limit_counters`, `import_runs` | Owner/Admin (job health)                                |
| Request logs                                                       | User ID, path, client IP; no bodies, cookies or query strings | Platform log store (stdout)                         | Operators                                               |
| Backups                                                            | Everything above                                              | Platform backups and `npm run backup` folders       | Operators                                               |

ClientFlow **never stores** card numbers or bank logins: the API and the database refuse payment references that look like a card number (SEC-14). Emails are link-only: they never carry record contents (SEC-24). CSV imports keep **no copy of the file**, only its hash and counts.

## Retention: what happens automatically today

| Record                                       | Removed automatically                                         |
| -------------------------------------------- | ------------------------------------------------------------- |
| Finished background jobs                     | 30 days after they finished (failed ones are kept for review) |
| Rate-limit counters                          | When their 15-minute window ends (hourly cleanup)             |
| Ended sessions, expired password-reset links | 30 days after they ended (hourly cleanup, M11)                |
| Everything else                              | **Not removed automatically**                                 |

## Proposed retention periods (owner to decide)

| Data                              | Proposal                                                                                             |
| --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Leads that never became customers | Archive after 24 months without activity; delete on request                                          |
| Customer records, projects, files | Contract period plus the period your accountant or contract requires                                 |
| Invoices and payments             | As long as tax law requires (in Egypt this is commonly several years; confirm with your accountant)  |
| Audit log                         | At least 1 year; never edited                                                                        |
| Request logs                      | 30–90 days in the log store                                                                          |
| Backups                           | 30 days of daily backups; older ones deleted. A deleted record survives in backups until they expire |
| Notifications                     | 12 months                                                                                            |

## Data requests

- **Export (access request):**
  - Contacts and deals can be exported as CSV by Owner, Admin or Sales manager. Invoices can be exported by Finance.
  - The CSV cells are neutralized against formula injection, and each export is audited.
  - A complete export of one person's data across all tables is **not built**. Today it means a database query by an operator.
- **Correction:** every editable record can be corrected in the app, and changes are versioned and audited.
- **Deletion:**
  - The app **archives** records (contacts, deals, services); it does not erase them, so history, invoices and the audit trail stay consistent.
  - An import can be undone by archiving what it created.
  - Uploaded project files can be deleted by their project's managers.
  - **Erasing a person** (a contact, or a former team member) is a manual operator procedure today. It is not a button, because records are linked by design:
    1. Export the person's data first, if they asked for it.
    2. Replace the personal fields with a placeholder (for example "Deleted contact"), clearing email, phone and notes.
    3. Remove their files.
    4. Keep the audit IDs.
    5. Record the request and the date.
    6. Backups still hold the old data until they expire (see above).
- **Who decides:** the project owner, as the controller of the agency's data. Requests should be answered within the time the applicable law sets.

## Consent and lawful basis

ClientFlow does not collect consent records. When contacts are imported or added, the agency is responsible for having a lawful reason to hold them (for example an existing business relationship) and for honouring opt-outs. ClientFlow sends no marketing email.

## Known limitations

- No one-click export or erasure of a single person across all tables.
- Retention periods other than those automated above are not enforced yet.
- Backups keep deleted data until they expire.
- Notification titles are snapshots: they keep a name even after the record is changed (R34).
