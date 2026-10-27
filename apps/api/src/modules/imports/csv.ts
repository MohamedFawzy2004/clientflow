// Reading an uploaded CSV safely (FR-C10). The text is parsed with csv-parse (RFC 4180 quotes,
// CRLF, BOM) and checked against hard limits before any row is looked at.
import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import {
  IMPORT_FIELDS,
  IMPORT_MAX_COLUMNS,
  IMPORT_MAX_ROWS,
  type ImportKind,
} from '@clientflow/contracts';

export interface ParsedCsv {
  headers: string[];
  rows: Array<{ line: number; cells: string[] }>;
  fileErrors: string[];
}

export const MAX_CELL = 5000;

export function sha256(text: string) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Excel saves "CSV" with semicolons in many locales: pick the separator the header uses most. */
function delimiterOf(text: string) {
  const first = text.slice(0, text.search(/\r?\n|$/));
  return (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ',';
}

export function parseCsv(raw: string): ParsedCsv {
  // One line ending everywhere, so line numbers match what an editor shows.
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  // A file saved as UTF-16 or Windows-1256 arrives with replacement characters: say so plainly
  // instead of importing broken names.
  if (text.includes('\uFFFD')) {
    return {
      headers: [],
      rows: [],
      fileErrors: [
        'The file is not UTF-8 text. In Excel choose "CSV UTF-8 (Comma delimited)" and save again.',
      ],
    };
  }
  let records: Array<{ record: string[]; info: { lines: number } }>;
  try {
    records = parse(text, {
      delimiter: delimiterOf(text),
      relax_column_count: true,
      // Hand-made files have quotes inside unquoted cells, e.g. =HYPERLINK("…"): keep them as text.
      relax_quotes: true,
      skip_empty_lines: true,
      info: true,
      max_record_size: MAX_CELL * IMPORT_MAX_COLUMNS,
      // With `info: true` each record comes with its line number; the typings do not say so.
    }) as unknown as typeof records;
  } catch (err) {
    const message = err instanceof Error ? err.message.split('\n')[0] : 'unknown error';
    return { headers: [], rows: [], fileErrors: [`The file could not be read as CSV: ${message}`] };
  }
  const fileErrors: string[] = [];
  const [head, ...body] = records;
  if (!head) return { headers: [], rows: [], fileErrors: ['The file has no header row.'] };
  const headers = head.record.map((h, i) => h.trim() || `Column ${i + 1}`);
  if (headers.length > IMPORT_MAX_COLUMNS) {
    fileErrors.push(
      `The file has ${headers.length} columns. At most ${IMPORT_MAX_COLUMNS} are read.`,
    );
  }
  const seen = new Set<string>();
  for (const h of headers) {
    const key = h.toLowerCase();
    if (seen.has(key)) fileErrors.push(`Two columns are called “${h}”. Rename one of them.`);
    seen.add(key);
  }
  const rows = body
    // Rows of only empty cells (a trailing ";;;" line) are not data.
    .filter((r) => r.record.some((c) => c.trim() !== ''))
    // csv-parse reports the line a record ends on; a quoted cell may span lines.
    .map((r) => ({
      line: r.info.lines - r.record.reduce((n, c) => n + c.split('\n').length - 1, 0),
      cells: r.record,
    }));
  if (rows.length === 0) fileErrors.push('The file has a header row but no data rows.');
  if (rows.length > IMPORT_MAX_ROWS) {
    fileErrors.push(
      `The file has ${rows.length} rows. Import at most ${IMPORT_MAX_ROWS} at a time: split the file.`,
    );
  }
  return { headers, rows, fileErrors };
}

/** Header words that suggest each field (English and Arabic). Compared without case or spaces. */
const ALIASES: Record<string, string[]> = {
  fullName: ['name', 'fullname', 'contactname', 'contact', 'leadname', 'الاسم', 'اسم'],
  email: ['email', 'emailaddress', 'mail', 'البريد', 'البريدالإلكتروني', 'الايميل', 'إيميل'],
  phone: [
    'phone',
    'phonenumber',
    'mobile',
    'tel',
    'telephone',
    'whatsapp',
    'الهاتف',
    'الموبايل',
    'رقم',
  ],
  companyName: ['company', 'companyname', 'organization', 'organisation', 'business', 'الشركة'],
  source: ['source', 'leadsource', 'channel', 'المصدر'],
  lifecycle: ['lifecycle', 'type', 'status', 'leadorcustomer', 'stage'],
  nextActionAt: [
    'nextaction',
    'nextactionat',
    'followup',
    'nextfollowup',
    'followupdate',
    'nextfollowupdate',
  ],
  notes: ['notes', 'note', 'comments', 'description', 'ملاحظات'],
  ownerEmail: ['owner', 'owneremail', 'salesperson', 'assignedto', 'accountowner'],
  title: ['deal', 'dealname', 'title', 'name', 'opportunity'],
  contactEmail: ['contactemail', 'email', 'clientemail', 'customeremail'],
  amount: ['amount', 'value', 'dealvalue', 'price', 'القيمة'],
  currency: ['currency', 'العملة'],
  stage: ['stage', 'pipelinestage', 'dealstage'],
  expectedCloseOn: ['expectedclose', 'closedate', 'expectedclosedate', 'expectedcloseon'],
  nextStep: ['nextstep'],
  nextStepAt: ['nextstepdate', 'nextstepat', 'nextstepon'],
};

const squash = (s: string) => s.toLowerCase().replace(/[\s_\-.:()]/g, '');

export function suggestMapping(kind: ImportKind, headers: string[]) {
  const mapping: Record<string, string | null> = {};
  const used = new Set<string>();
  for (const field of IMPORT_FIELDS[kind]) {
    const aliases = ALIASES[field.key] ?? [];
    const match = headers.find((h) => !used.has(h) && aliases.includes(squash(h)));
    mapping[field.key] = match ?? null;
    if (match) used.add(match);
  }
  return mapping;
}
