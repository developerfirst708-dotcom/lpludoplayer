export class ApiError extends Error {
  constructor(message, { status, code, details }) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function handle(res) {
  let body = null;
  try {
    body = await res.json();
  } catch { /* non-JSON */ }
  if (!res.ok) {
    throw new ApiError(body?.error?.message || `Request failed (${res.status})`, {
      status: res.status,
      code: body?.error?.code,
      details: body?.details,
    });
  }
  return body;
}

let accessToken = null;
export function setAccessToken(token) {
  accessToken = token;
}

export function api(path, { method = "GET", body, headers, ...rest } = {}) {
  return fetch(`/api${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "include",
    ...rest,
  }).then(handle);
}

/**
 * Protected files (result proofs, KYC docs) are served with `requireAuth`, so an
 * <img src> can't reach them — fetch the bytes with the bearer token and hand
 * back an object URL the caller must revoke when done.
 */
export async function apiBlobUrl(path) {
  const res = await fetch(`/api${path}`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Failed to load file (${res.status})`);
  return URL.createObjectURL(await res.blob());
}
