/** Cliente HTTP mínimo. Normaliza los errores de NestJS en un mensaje legible. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: string[],
    /** Advertencias que no bloquean pero exigen confirmación explícita (HTTP 409). */
    public warnings?: string[],
    public needsConfirmation = false,
  ) {
    super(message);
  }
}

const ADMIN_KEY_STORAGE = 'votacion.apiKey';

export const auth = {
  get: () => {
    try { return sessionStorage.getItem(ADMIN_KEY_STORAGE); } catch { return null; }
  },
  set: (k: string) => {
    try { sessionStorage.setItem(ADMIN_KEY_STORAGE, k); } catch { /* storage no disponible */ }
  },
  clear: () => {
    try { sessionStorage.removeItem(ADMIN_KEY_STORAGE); } catch { /* storage no disponible */ }
  },
};

async function request<T>(method: string, path: string, body?: unknown, admin = false): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (admin) headers['x-api-key'] = auth.get() ?? '';
  const res = await fetch(`/api${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (!res.ok) {
    if (res.status === 429) throw new ApiError(429, 'Demasiados intentos. Espera un minuto e inténtalo de nuevo.');
    const msg = Array.isArray(data?.message) ? data.message.join('. ') : data?.message ?? 'Error inesperado';
    throw new ApiError(res.status, msg, data?.errors, data?.warnings, Boolean(data?.needsConfirmation));
  }
  return data as T;
}

export const api = {
  get: <T>(p: string, admin = false) => request<T>('GET', p, undefined, admin),
  post: <T>(p: string, body?: unknown, admin = false) => request<T>('POST', p, body ?? {}, admin),
  put: <T>(p: string, body: unknown) => request<T>('PUT', p, body, true),
  patch: <T>(p: string, body: unknown) => request<T>('PATCH', p, body, true),
  /** Sube un archivo (multipart) en el campo "file". */
  async postFile<T>(path: string, file: File, fields: Record<string, string> = {}): Promise<T> {
    const body = new FormData();
    body.append('file', file);
    for (const [k, v] of Object.entries(fields)) body.append(k, v);
    const res = await fetch(`/api${path}`, { method: 'POST', headers: { 'x-api-key': auth.get() ?? '' }, body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = Array.isArray(data?.message) ? data.message.join('. ') : data?.message ?? 'Error inesperado';
      throw new ApiError(res.status, msg, data?.errors, data?.warnings, Boolean(data?.needsConfirmation));
    }
    return data as T;
  },
  /** Descarga un archivo autenticado (CSV, HTML, plantillas). */
  async download(path: string, filename: string) {
    const res = await fetch(`/api${path}`, { headers: { 'x-api-key': auth.get() ?? '' } });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new ApiError(res.status, data.message ?? 'No se pudo descargar');
    }
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); // Safari necesita que la URL siga viva un momento
  },
};
