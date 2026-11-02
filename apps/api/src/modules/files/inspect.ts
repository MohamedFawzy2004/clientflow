// Upload checks (SEC-12, FR-X06, FR-X07): size limit, SHA-256, file signature against the
// allowlisted type, active content in text files and the EICAR test signature. This is a basic
// built-in check, NOT an antivirus engine: a real scanner can replace it later (ADR-044).
import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import type { FileExtension } from '@clientflow/contracts';

export class TooLargeError extends Error {
  constructor() {
    super('File too large');
  }
}

const HEAD_BYTES = 16;
const TAIL_KEEP = 128;
const EICAR = 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE';
/** Markers of content a browser could run. Text uploads never contain them (FR-X07). */
const ACTIVE_MARKERS = [
  '<script',
  '<html',
  '<svg',
  '<!doctype html',
  '<iframe',
  '<object',
  '<embed',
];
const TEXT_TYPES: readonly FileExtension[] = ['txt', 'csv', 'md'];
const ZIP_TYPES: readonly FileExtension[] = ['docx', 'xlsx', 'pptx', 'zip'];

export type Finding = { ok: true } | { ok: false; reason: string };

export class ContentInspector {
  private readonly hash = createHash('sha256');
  private size = 0;
  private head = Buffer.alloc(0);
  private tail = '';
  private finding: Finding = { ok: true };
  private readonly utf8: TextDecoder | null;

  constructor(
    private readonly ext: FileExtension,
    private readonly maxBytes: number,
  ) {
    this.utf8 = TEXT_TYPES.includes(ext) ? new TextDecoder('utf-8', { fatal: true }) : null;
  }

  /** Feed the next chunk. Throws TooLargeError once the limit is passed. */
  update(chunk: Buffer) {
    this.size += chunk.length;
    if (this.size > this.maxBytes) throw new TooLargeError();
    this.hash.update(chunk);
    if (this.head.length < HEAD_BYTES) {
      this.head = Buffer.concat([this.head, chunk.subarray(0, HEAD_BYTES - this.head.length)]);
    }
    if (!this.finding.ok) return;
    // Keep the end of the previous chunk so a marker split across two chunks is still found.
    const window = this.tail + chunk.toString('latin1');
    this.tail = window.slice(-TAIL_KEEP);
    if (window.includes(EICAR)) {
      this.finding = { ok: false, reason: 'The file matches a malware test signature.' };
      return;
    }
    if (this.utf8) {
      if (chunk.includes(0)) {
        this.finding = { ok: false, reason: 'This text file contains binary data.' };
        return;
      }
      try {
        this.utf8.decode(chunk, { stream: true });
      } catch {
        this.finding = { ok: false, reason: 'Text files must be UTF-8.' };
        return;
      }
      const lower = window.toLowerCase();
      if (ACTIVE_MARKERS.some((m) => lower.includes(m))) {
        this.finding = {
          ok: false,
          reason: 'Text files cannot contain HTML or scripts. Send a PDF instead.',
        };
      }
    }
  }

  finish(): { size: number; sha256: string; finding: Finding } {
    if (this.finding.ok && this.utf8) {
      try {
        this.utf8.decode();
      } catch {
        this.finding = { ok: false, reason: 'Text files must be UTF-8.' };
      }
    }
    if (this.finding.ok && !matchesSignature(this.ext, this.head)) {
      this.finding = {
        ok: false,
        reason: `The content does not look like a .${this.ext} file. Check the file and try again.`,
      };
    }
    return { size: this.size, sha256: this.hash.digest('hex'), finding: this.finding };
  }
}

function startsWith(head: Buffer, bytes: number[] | string, offset = 0) {
  const b = typeof bytes === 'string' ? Buffer.from(bytes, 'latin1') : Buffer.from(bytes);
  return head.length >= offset + b.length && head.subarray(offset, offset + b.length).equals(b);
}

/** Checks the first bytes against the type the extension claims. */
export function matchesSignature(ext: FileExtension, head: Buffer): boolean {
  if (ZIP_TYPES.includes(ext)) return startsWith(head, [0x50, 0x4b, 0x03, 0x04]);
  if (TEXT_TYPES.includes(ext)) return true; // checked while streaming
  switch (ext) {
    case 'pdf':
      return startsWith(head, '%PDF-');
    case 'png':
      return startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'jpg':
    case 'jpeg':
      return startsWith(head, [0xff, 0xd8, 0xff]);
    case 'gif':
      return startsWith(head, 'GIF87a') || startsWith(head, 'GIF89a');
    case 'webp':
      return startsWith(head, 'RIFF') && startsWith(head, 'WEBP', 8);
    default:
      return false;
  }
}

/**
 * A display name that is safe everywhere: no path parts, control or reserved characters, at most
 * 120 characters before the extension. The name is never used to build a storage path.
 */
export function safeFileName(raw: string, ext: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const stem = base
    .slice(0, base.length - (ext.length + 1))
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}<>:"|?*]/gu, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, 120);
  return `${stem || 'file'}.${ext}`;
}
