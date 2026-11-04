# LinkedIn materials

Drafts for the owner to post. Nothing here has been posted. These drafts deliberately avoid claims that cannot be checked: no users, clients, revenue, "production-ready" or certifications.

## Post draft

> I've finished a portfolio project: **ClientFlow**, an operations platform for a small software agency. It covers everything from the first lead to the last invoice, with a client portal where each client sees only their own work.
>
> What I focused on:
> 🔐 Security on the server, not in the UI. A test tries every role against every protected API route, and out-of-scope records answer 404.
> 🧊 Provable approvals. Sent proposal versions, issued invoices and payments are frozen by database triggers.
> 🔁 Safe retries. Converting a deal into a project, creating invoices and recording payments are idempotent, and an invoice cannot be issued twice.
> 🧪 Evidence. Integration tests run on real PostgreSQL, and Playwright runs in Edge, Firefox and WebKit with accessibility checks. A release report lists what passed, what failed and what was not run.
>
> Stack: TypeScript, React 19, Express 5, PostgreSQL 17, Prisma 7, Zod, Playwright, Docker, GitHub Actions.
>
> How it was built: with Claude Code, an AI coding agent, in twelve gated milestones. I wrote the requirements and acceptance rules, reviewed every milestone report, and decided what shipped. The commit history and reports show each step, including the failures.
>
> It is a portfolio project with fictional demo data, not a product in customer use. Code and docs: github.com/MohamedFawzy2004/clientflow
>
> #TypeScript #React #PostgreSQL #WebSecurity #SoftwareEngineering

Attach 2–3 images from `docs/portfolio/screenshots/` (dashboard, portal project at 360 px, task board). Leave the "Demo workspace" banner visible.

## Projects section entry

- **Name:** ClientFlow — agency operations platform (portfolio project)
- **Description (about 600 characters):** A full-stack TypeScript platform that follows an agency's work from lead to invoice: pipeline, versioned proposals, projects, deliverables, change requests and invoice tracking. A client portal isolates each client's data. It has server-side sessions with TOTP for administrators, a permission matrix test across every protected route, database-enforced immutability for approvals and invoices, encrypted and virus-scanned uploads, and tests on real PostgreSQL and in three browser engines. Built with an AI coding agent under milestone gates. Fictional demo data; not in customer use.
- **Skills:** TypeScript, React, Node.js, PostgreSQL, Prisma, Playwright, Docker, Application Security
- **Link:** the GitHub repository (add the public demo only after it is live)
