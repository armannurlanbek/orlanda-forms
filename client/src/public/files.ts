// Client-side file validation for attachment questions (§17.5). Mirrors the
// server's UPLOAD_LIMITS so surveyors get an immediate, specific error before
// any bytes leave the phone. There is NO separate upload endpoint — selected
// File objects ride along in the submit FormData (§13.1).
import { UPLOAD_LIMITS } from '@orlanda/shared';

export interface SelectedFile {
  /** stable id for React keys + remove affordance */
  id: string;
  file: File;
  /** object URL for image preview thumbnails (revoke on remove/unmount) */
  previewUrl: string | null;
}

const IMAGE_MIME = /^image\//;

function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function isImage(file: File): boolean {
  return IMAGE_MIME.test(file.type) || ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(extOf(file.name));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Validate a single candidate File against per-file constraints. Returns an
 * error message (specific, user-facing) or null when acceptable. Submission-wide
 * limits (count, total bytes) are enforced by the caller, which knows the
 * already-selected set.
 */
export function checkFile(file: File): string | null {
  const ext = extOf(file.name);
  if (!UPLOAD_LIMITS.allowedExtensions.includes(ext as (typeof UPLOAD_LIMITS.allowedExtensions)[number])) {
    return 'File type not allowed';
  }
  if (file.size > UPLOAD_LIMITS.maxFileBytes) {
    return `Max ${Math.round(UPLOAD_LIMITS.maxFileBytes / (1024 * 1024))} MB`;
  }
  return null;
}

/** A non-cryptographic id is fine here — only used for React keys/removal. */
export function fileKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `f_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function makeSelectedFile(file: File): SelectedFile {
  return {
    id: fileKey(),
    file,
    previewUrl: isImage(file) ? URL.createObjectURL(file) : null,
  };
}

export const ACCEPT_ATTR = 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt';

export { UPLOAD_LIMITS };
