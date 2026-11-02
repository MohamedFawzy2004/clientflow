import PDFDocument from 'pdfkit';
import {
  formatBp,
  formatMoney,
  OPERATIONAL_APPROVAL_NOTICE,
  type ProposalVersionContent,
} from '@clientflow/contracts';

export interface ProposalPdfInput {
  agency: {
    name: string;
    contactEmail: string | null;
    phone: string | null;
    address: string | null;
  };
  clientName: string;
  reference: string;
  content: ProposalVersionContent;
  contentHash: string;
  statusLabel: string;
  sentAt: Date | null;
  acceptance: { by: string; at: Date } | null;
  timeZone: string;
}

// Characters outside Windows-1252 cannot be drawn with the built-in PDF fonts (ADR-033).
const CP1252_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

/** Text safe for the built-in fonts: common punctuation mapped, anything else shown as "?". */
export function pdfText(value: string): string {
  return value
    .replace(/[−‐‑]/g, '-')
    .replace(/·/g, '·')
    .replace(/[\u202f\u2009]/g, ' ')
    .replace(/[^\n]/g, (ch) => {
      const code = ch.codePointAt(0)!;
      if (
        (code >= 0x20 && code <= 0x7e) ||
        (code >= 0xa0 && code <= 0xff) ||
        CP1252_EXTRA.has(ch)
      ) {
        return ch;
      }
      return '?';
    });
}

function when(d: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(d);
}

function dateOnly(iso: string) {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T12:00:00Z`));
}

/**
 * Renders one frozen proposal version (FR-Q06): reference, client, scope, priced lines, totals
 * with their explanation, terms, the dated acceptance if any, and the content hash on every
 * page. Internal notes are not part of the input type, so they cannot appear.
 */
export function renderProposalPdf(input: ProposalPdfInput, options: { compress?: boolean } = {}) {
  const c = input.content;
  const money = (minor: string) => pdfText(formatMoney(minor, c.currency));
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 56, bottom: 64, left: 56, right: 56 },
    bufferPages: true,
    compress: options.compress ?? true,
    info: {
      Title: pdfText(`${input.reference} v${c.versionNo} - ${c.title}`),
      Author: pdfText(input.agency.name),
      Subject: `Proposal ${input.reference} version ${c.versionNo}`,
      Producer: 'ClientFlow',
      Creator: 'ClientFlow',
      // Stable metadata: the document describes the sent version, not the moment of download.
      CreationDate: input.sentAt ?? new Date(0),
    },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (b: Buffer) => chunks.push(b));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const ink = '#10243c';
  const muted = '#53657b';

  doc.fillColor(ink).font('Helvetica-Bold').fontSize(16).text(pdfText(input.agency.name));
  const contact = [input.agency.contactEmail, input.agency.phone, input.agency.address]
    .filter(Boolean)
    .join('  ·  ');
  if (contact) doc.font('Helvetica').fontSize(9).fillColor(muted).text(pdfText(contact));
  doc.moveDown(1.2);

  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor(muted)
    .text(
      pdfText(
        `Proposal ${input.reference} · Version ${c.versionNo} · ${input.statusLabel} · Valid until ${dateOnly(c.expiresOn)}`,
      ),
    );
  doc.moveDown(0.3);
  doc.font('Helvetica-Bold').fontSize(18).fillColor(ink).text(pdfText(c.title));
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor(muted)
    .text(
      pdfText(
        `For ${input.clientName}${input.sentAt ? ` · Sent ${when(input.sentAt, input.timeZone)}` : ''}`,
      ),
    );
  doc.moveDown(1);

  const section = (title: string, body: string | null) => {
    if (!body) return;
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(muted)
      .text(title.toUpperCase(), { characterSpacing: 0.6 });
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(10.5).fillColor(ink).text(pdfText(body), { width });
    doc.moveDown(0.8);
  };
  section('Summary', c.summary);
  section('Included', c.inclusions);
  section('Not included', c.exclusions);
  section('Assumptions', c.assumptions);
  section('Milestones', c.milestones);

  // Price table
  doc.font('Helvetica-Bold').fontSize(9).fillColor(muted).text('PRICE', { characterSpacing: 0.6 });
  doc.moveDown(0.4);
  const cols = {
    item: left,
    qty: left + width * 0.5,
    unit: left + width * 0.66,
    amount: left + width * 0.83,
  };
  const colW = { item: width * 0.48, qty: width * 0.15, unit: width * 0.17, amount: width * 0.17 };
  const row = (cells: [string, string, string, string], bold = false) => {
    const y = doc.y;
    doc
      .font(bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(10)
      .fillColor(ink);
    const h = Math.max(
      doc.heightOfString(cells[0], { width: colW.item }),
      doc.heightOfString(cells[2], { width: colW.unit }),
    );
    if (y + h > doc.page.height - doc.page.margins.bottom) doc.addPage();
    const top = doc.y;
    doc.text(cells[0], cols.item, top, { width: colW.item });
    doc.text(cells[1], cols.qty, top, { width: colW.qty, align: 'right' });
    doc.text(cells[2], cols.unit, top, { width: colW.unit, align: 'right' });
    doc.text(cells[3], cols.amount, top, { width: colW.amount, align: 'right' });
    doc.x = left;
    doc.y = top + h + 6;
    doc
      .moveTo(left, doc.y - 3)
      .lineTo(left + width, doc.y - 3)
      .lineWidth(0.5)
      .strokeColor('#dbe3ec')
      .stroke();
  };
  row(['Item', 'Qty', 'Unit price', 'Amount'], true);
  for (const i of c.items) {
    row([
      pdfText(i.description ? `${i.name}\n${i.description}` : i.name),
      pdfText(`${i.quantity} ${i.unit}`),
      money(i.unitPriceMinor),
      money(i.lineTotalMinor),
    ]);
  }

  // Totals, each step explained (FR-Q03)
  doc.moveDown(0.4);
  const taxable = (BigInt(c.subtotalMinor) - BigInt(c.discountMinor)).toString();
  const total = (label: string, value: string, bold = false) => {
    const top = doc.y;
    doc
      .font(bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(bold ? 12 : 10)
      .fillColor(ink);
    doc.text(pdfText(label), left + width * 0.35, top, { width: width * 0.45, align: 'right' });
    doc.text(value, cols.amount - width * 0.03, top, {
      width: colW.amount + width * 0.03,
      align: 'right',
    });
    doc.x = left;
    doc.moveDown(0.25);
  };
  total('Subtotal', money(c.subtotalMinor));
  if (c.discountBp > 0) total(`Discount ${formatBp(c.discountBp)}%`, `-${money(c.discountMinor)}`);
  total(
    `${c.taxLabel} ${formatBp(c.taxRateBp)}% of ${formatMoney(taxable, c.currency)}`,
    money(c.taxMinor),
  );
  total('Total', money(c.totalMinor), true);
  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor(muted)
    .text(
      pdfText(
        `Prices exclude ${c.taxLabel}. Each amount is rounded to the nearest minor unit (half up).`,
      ),
      left,
      doc.y + 2,
      { width, align: 'right' },
    );
  doc.moveDown(1);

  section('Payment terms', c.paymentTerms);
  section('Terms', c.terms);

  // Acceptance (FR-Q06 "dated acceptance", FR-Q11 wording)
  doc.moveDown(0.4);
  if (input.acceptance) {
    doc
      .font('Helvetica-Bold')
      .fontSize(10.5)
      .fillColor('#13724a')
      .text(
        pdfText(
          `Accepted by ${input.acceptance.by} on ${when(input.acceptance.at, input.timeZone)}`,
        ),
      );
  } else {
    doc
      .font('Helvetica-Bold')
      .fontSize(10.5)
      .fillColor(ink)
      .text(pdfText(`Status: ${input.statusLabel}`));
  }
  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor(muted)
    .text(pdfText(OPERATIONAL_APPROVAL_NOTICE), { width });

  // Footer on every page: what exactly this document is.
  const range = doc.bufferedPageRange();
  for (let p = range.start; p < range.start + range.count; p++) {
    doc.switchToPage(p);
    const bottom = doc.page.height - 40;
    doc.page.margins.bottom = 0;
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(muted)
      .text(
        `${input.reference} v${c.versionNo} · Terms hash (SHA-256) ${input.contentHash} · Page ${p + 1} of ${range.count}`,
        left,
        bottom,
        { width, align: 'center', lineBreak: false },
      );
  }
  doc.end();
  return done;
}
