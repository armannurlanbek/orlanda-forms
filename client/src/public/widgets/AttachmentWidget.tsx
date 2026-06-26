// Attachment file control (§17.5, mobile-first). Native file input with
// `accept` (images primarily) + `capture="environment"` for direct camera
// capture; supports multiple files; client-side size/type checks happen in the
// parent hook (addFiles) so errors surface immediately. Each file is a row with
// an image thumbnail (object URL) + a remove affordance.
//
// NOTE: there is NO separate upload endpoint — selected files are sent in the
// submit request, so there is no per-file network "progress" here; we show a
// clear "ready to send" state per the available transport (§13.1).
import { useRef } from 'react';
import type { PublicQuestionDTO } from '@orlanda/shared';
import type { FieldIds } from './Field';
import { ACCEPT_ATTR, UPLOAD_LIMITS, formatBytes, type SelectedFile } from '../files';

interface Props {
  question: PublicQuestionDTO;
  ids: FieldIds;
  files: SelectedFile[];
  onAddFiles: (questionId: string, list: FileList | File[]) => void;
  onRemoveFile: (questionId: string, fileId: string) => void;
}

export function AttachmentWidget({
  question: q,
  ids,
  files,
  onAddFiles,
  onRemoveFile,
}: Props): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const atLimit = files.length >= UPLOAD_LIMITS.maxFilesPerSubmission;

  const openPicker = () => inputRef.current?.click();

  return (
    <div>
      {/* Hidden native input; the visible buttons trigger it for big tap targets. */}
      <input
        ref={inputRef}
        id={ids.inputId}
        type="file"
        accept={ACCEPT_ATTR}
        capture="environment"
        multiple
        className="sr-only"
        aria-required={q.required}
        aria-invalid={ids.hasError || undefined}
        aria-describedby={ids.describedBy}
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            onAddFiles(q.id, e.target.files);
          }
          // Reset so selecting the same file again re-fires change.
          e.target.value = '';
        }}
      />

      <button
        type="button"
        onClick={openPicker}
        disabled={atLimit}
        className="flex min-h-tap w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-white px-4 py-4 text-base font-medium text-brand-primary disabled:cursor-not-allowed disabled:opacity-50"
      >
        <CameraIcon />
        {files.length === 0 ? 'Add photo or file' : 'Add another'}
      </button>

      <p className="mt-2 text-xs text-brand-text/60">
        Images and documents up to {Math.round(UPLOAD_LIMITS.maxFileBytes / (1024 * 1024))} MB each,
        max {UPLOAD_LIMITS.maxFilesPerSubmission} files.
      </p>

      {files.length > 0 && (
        <ul className="mt-3 space-y-2">
          {files.map((sf) => (
            <li
              key={sf.id}
              className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-2"
            >
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded bg-slate-100">
                {sf.previewUrl ? (
                  <img src={sf.previewUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <FileIcon />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-brand-text" title={sf.file.name}>
                  {sf.file.name}
                </p>
                <p className="text-xs text-green-700">Ready • {formatBytes(sf.file.size)}</p>
              </div>
              <button
                type="button"
                onClick={() => onRemoveFile(q.id, sf.id)}
                className="flex min-h-tap min-w-tap items-center justify-center rounded-lg text-brand-text/60 hover:text-red-600"
                aria-label={`Remove ${sf.file.name}`}
              >
                <TrashIcon />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CameraIcon(): JSX.Element {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function FileIcon(): JSX.Element {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function TrashIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}
