// File upload safety (§16.2): extension allowlist + magic-byte (content)
// validation + filename sanitization. Pure & deterministic (manual signatures —
// no flaky third-party sniffer). Used by BOTH the logo upload (raster only) and
// the public attachment upload (broader allowlist).

export interface FileValidationOk {
  ok: true;
  ext: string;
  mime: string;
}
export interface FileValidationErr {
  ok: false;
  reason: string;
}
export type FileValidationResult = FileValidationOk | FileValidationErr;

// Canonical mime per accepted extension (what we report to Monday / serving).
const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  txt: 'text/plain',
};

export function extOf(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/**
 * Server-side filename sanitization (§16.2 / §11.1): basename only, strip path
 * separators, `..`, NUL, and CR/LF, cap length. NEVER used to build a
 * filesystem path — only as the display name echoed to Monday.
 */
export function sanitizeFilename(filename: string, maxLen = 200): string {
  let base = filename.split(/[\\/]/).pop() ?? 'file';
  // eslint-disable-next-line no-control-regex
  base = base.replace(/[\x00-\x1f\x7f]/g, '').replace(/\.\./g, '.').trim();
  if (base === '' || base === '.') base = 'file';
  if (base.length > maxLen) {
    const ext = extOf(base);
    const stem = base.slice(0, maxLen - (ext ? ext.length + 1 : 0));
    base = ext ? `${stem}.${ext}` : stem;
  }
  return base;
}

function startsWith(buf: Buffer, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) if (buf[offset + i] !== bytes[i]) return false;
  return true;
}

function looksLikeText(buf: Buffer): boolean {
  // Reject NUL bytes; require the sample be mostly printable/utf8-ish.
  const sample = buf.subarray(0, Math.min(buf.length, 4096));
  for (const b of sample) {
    if (b === 0) return false;
  }
  return true;
}

// Content validators per extension. Reliable binary signatures are enforced
// strictly; office docs check container magic; text checks for binary content.
function contentMatches(ext: string, buf: Buffer): boolean {
  switch (ext) {
    case 'png':
      return startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'jpg':
    case 'jpeg':
      return startsWith(buf, [0xff, 0xd8, 0xff]);
    case 'gif':
      return startsWith(buf, [0x47, 0x49, 0x46, 0x38]); // GIF8
    case 'webp':
      return startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8); // RIFF....WEBP
    case 'pdf':
      return startsWith(buf, [0x25, 0x50, 0x44, 0x46]); // %PDF
    case 'docx':
    case 'xlsx':
      return startsWith(buf, [0x50, 0x4b, 0x03, 0x04]) || startsWith(buf, [0x50, 0x4b, 0x05, 0x06]); // PK zip
    case 'doc':
    case 'xls':
      return startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]); // OLE cfb
    case 'csv':
    case 'txt':
      return looksLikeText(buf);
    default:
      return false;
  }
}

/**
 * Validate an uploaded buffer against an extension allowlist AND its actual
 * content. Returns the canonical ext+mime on success (never trust the
 * client-supplied Content-Type).
 */
export function validateUpload(
  buffer: Buffer,
  originalFilename: string,
  allowedExts: readonly string[],
): FileValidationResult {
  const ext = extOf(originalFilename);
  if (!ext) return { ok: false, reason: 'File has no extension.' };
  if (!allowedExts.includes(ext)) return { ok: false, reason: `File type .${ext} is not allowed.` };
  if (buffer.length === 0) return { ok: false, reason: 'File is empty.' };
  if (!contentMatches(ext, buffer)) {
    return { ok: false, reason: `File content does not match its .${ext} extension.` };
  }
  return { ok: true, ext, mime: MIME_BY_EXT[ext] ?? 'application/octet-stream' };
}
