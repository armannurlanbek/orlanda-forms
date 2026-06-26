// Typed fetch wrapper. Always sends cookies (httpOnly JWT). Throws ApiError on
// non-2xx so React Query surfaces errors uniformly.
import type { ApiError as ApiErrorBody } from '@orlanda/shared';

export class ApiError extends Error {
  status: number;
  code?: string;
  fields?: Record<string, string>;
  constructor(status: number, message: string, code?: string, fields?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    ...init,
  });
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => ({}))) as Partial<ApiErrorBody> & Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(res.status, (body.error as string) ?? 'Request failed', body.code, body.fields);
  }
  return body as T;
}

function jsonInit(method: string, data?: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
  };
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) => request<T>(path, jsonInit('POST', data)),
  put: <T>(path: string, data?: unknown) => request<T>(path, jsonInit('PUT', data)),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  // multipart (file uploads) — do NOT set Content-Type; the browser adds the boundary.
  postForm: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', body: form }),
};
