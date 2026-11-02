# Guide: Owner and Admin

You set up the workspace, manage the team and keep an eye on the system. Owners can do everything;
Admins can do the same except record payments and manage Owners.

## First day

1. **Settings → Profile:** name, contact email, phone and address. These appear on proposals,
   invoices and in the client portal. Under **Defaults**, set the currency, time zone and working
   days.
2. **Services:** add what you sell (name, unit, rate, currency). Sales picks from this list when
   writing proposals.
3. **Team → Invite a team member:** enter their email and role. The invitation link is shown to you
   and, when email is set up, emailed to them. It works once and expires.
4. **Cost rates** (in the Finance section): add each person's internal hourly cost. Project finance
   uses it to show margins. Only Owners and Admins can see or change cost rates.

## Roles at a glance

| Role          | Can                                                                                      |
| ------------- | ---------------------------------------------------------------------------------------- |
| Owner         | Everything                                                                               |
| Admin         | Everything except recording payments: team, settings, imports, cost rates, system status |
| Sales manager | All leads and deals, approves proposals, manages client portal access, imports           |
| Sales         | Their own leads, deals and proposals                                                     |
| PM            | Projects they manage: tasks, deliverables, change requests, client sharing               |
| Member        | Projects they are on: their tasks and time                                               |
| Finance       | Invoices, payments and the finance report                                                |
| Client        | Only their own organization's proposals, shared projects and invoices                    |

The server enforces every rule. Hiding a button is never the only protection.

## Team changes

- **Deactivate** someone who leaves: they are signed out everywhere at once and cannot sign in. Their
  work stays, still credited to them. **Reactivate** restores access.
- A workspace always keeps at least one active Owner: the last one cannot be removed or demoted.
- Changing someone's role takes effect on their next request.

## Importing existing data

**Imports** (Owner, Admin, Sales manager) takes a CSV of contacts or deals:

1. Upload the file and check the preview: each column is matched to a field, and problems are listed
   by line number.
2. Confirm. Re-sending the same file does nothing twice.
3. Made a mistake? **Undo import** archives everything that import created.

## System status

**Settings → System status** shows whether the database answers, whether background jobs (emails and
reminders) are running on time, and any jobs that failed. A failed job can be retried from
**Settings → Jobs**.

For backups, restores and incidents, see the [runbook](../19_RUNBOOK.md) and the
[deployment guide](../17_DEPLOYMENT.md).

## Audit trail

Sign-ins, permission changes, approvals, money changes and other key events are recorded with who,
when and from which request. Records cannot be edited or deleted from the app.
