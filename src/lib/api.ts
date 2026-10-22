// Calls to the registry server. Sends the session cookie (same origin) and the CSRF token on every change.
export class ApiError extends Error {
  status: number;
  code: string;
  field?: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, field?: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.field = field;
    this.details = details;
  }
}

let csrf = '';
let onSignedOut: (() => void) | null = null;

export function setCsrf(token: string) {
  csrf = token;
}

/** Called when the server says the session has ended (expired, password changed elsewhere, account disabled). */
export function onSessionEnded(fn: () => void) {
  onSignedOut = fn;
}

export async function api<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(method !== 'GET' && csrf ? { 'X-CSRF-Token': csrf } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'OFFLINE', 'No connection to the registry server. Check the network and try again.');
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* empty or non-JSON body */
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: { field?: string } } } | null)?.error;
    if (res.status === 401 && path !== '/api/auth/login' && path !== '/api/auth/me') onSignedOut?.();
    throw new ApiError(res.status, err?.code ?? 'HTTP_' + res.status, err?.message ?? `The server answered ${res.status}.`, err?.details?.field, err?.details);
  }
  const d = data as { csrf?: string } | null;
  if (d?.csrf) csrf = d.csrf;
  return data as T;
}
