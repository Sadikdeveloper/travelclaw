export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  if (response.status === 204) return undefined as T;
  const body = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
    message?: string;
  };
  if (!response.ok) {
    const message = body.error?.message || body.message || response.statusText;
    throw new ApiError(message, response.status);
  }
  return body as T;
}
