# Guide: Finance

You bill clients and record what they pay. ClientFlow tracks invoices operationally; it is not
accounting software and does not file taxes.

## Invoices

1. **Invoices → New invoice:** choose the client organization and, optionally, the project. The
   currency follows the project.
2. Add lines: free text, or bill a project milestone or an accepted change request. The project's
   money panel marks what is already invoiced. Set the tax rate and due date.
3. **Issue invoice:** it gets the next number (INV-0001, INV-0002, …) and can no longer be edited.
   Drafts can be deleted; issued invoices can only be voided, with a reason.
4. Publish it to make it visible to the client in their portal.

## Payments

- **Record payment** (Finance and the Owner only) on an issued invoice: amount, date received, method and the bank or receipt
  reference. A card number is refused.
- An invoice is **partly paid** until the full amount arrives, then **paid**. Overpaying is refused.
- A wrong payment is reversed, not deleted, with a reason. The history keeps both entries.
- Pressing the button twice never records two payments.

## Overdue and reports

- Issued invoices past their due date show as **overdue** in the list and on the dashboard.
- **Finance report** shows invoiced, collected and outstanding amounts per currency, and project
  margins from logged time and cost rates.
- **Export CSV** downloads the invoice list.

Amounts are stored in whole minor units (piastres, cents) and never converted between currencies.
