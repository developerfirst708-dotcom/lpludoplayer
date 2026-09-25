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

/**
 * Origin of the API. In production this is the API's own domain
 * (Cloudflare Pages → Settings → Environment variables: VITE_API_URL).
 * Left empty for local dev, where vite.config.js proxies /api to :5000.
 */
const API_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");

export function api(path, { method = "GET", body, headers, ...rest } = {}) {
  return fetch(`${API_BASE}/api${path}`, {
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
  const res = await fetch(`${API_BASE}/api${path}`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Failed to load file (${res.status})`);
  return URL.createObjectURL(await res.blob());
}
