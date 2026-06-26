// Logo upload (§16.8): raster images only, client-side type/size guard BEFORE
// upload. POST /api/uploads/logo (multipart, field `logo`) -> { logoUrl }. The
// returned app-relative path is stored in theme.logoUrl.
import { useRef, useState } from 'react';
import { UPLOAD_LIMITS } from '@orlanda/shared';
import { ApiError, api } from '../../lib/api';
import { Button, Label, Spinner } from './ui';

const ALLOWED = UPLOAD_LIMITS.logoAllowedExtensions; // ['png','jpg','jpeg','webp']
const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_BYTES = UPLOAD_LIMITS.maxFileBytes;

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

export function LogoUpload({
  logoUrl,
  onUploaded,
  onClear,
}: {
  logoUrl: string | null | undefined;
  onUploaded: (url: string) => void;
  onClear: () => void;
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File): Promise<void> {
    setError(null);
    const ext = extOf(file.name);
    // Raster images only — reject SVG and everything outside the allowlist.
    if (!ALLOWED.includes(ext as (typeof ALLOWED)[number]) || (file.type && !ALLOWED_MIME.includes(file.type))) {
      setError('Images only (PNG, JPG, or WEBP).');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(`Max ${Math.round(MAX_BYTES / (1024 * 1024))} MB.`);
      return;
    }
    const form = new FormData();
    form.append('logo', file);
    setUploading(true);
    try {
      const res = await api.postForm<{ logoUrl: string }>('/api/uploads/logo', form);
      onUploaded(res.logoUrl);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div>
      <Label>Logo</Label>
      <div className="flex items-center gap-3">
        {logoUrl ? (
          <img src={logoUrl} alt="Form logo preview" className="h-12 w-12 rounded border border-slate-200 object-contain" />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded border border-dashed border-slate-300 text-xs text-slate-400">
            None
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={ALLOWED_MIME.join(',')}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
          }}
        />
        <Button size="sm" disabled={uploading} onClick={() => inputRef.current?.click()}>
          {uploading ? <Spinner /> : null}
          {logoUrl ? 'Replace' : 'Upload'}
        </Button>
        {logoUrl ? (
          <Button size="sm" variant="ghost" disabled={uploading} onClick={onClear}>
            Remove
          </Button>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-slate-500">PNG, JPG, or WEBP. SVG not allowed.</p>
      {error ? (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
