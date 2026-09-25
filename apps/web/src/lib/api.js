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
  } catch { /* non-JSON (should not happen) */ }
  if (!res.ok) {
    throw new ApiError(body?.error?.message || `Request failed (${res.status})`, {
      status: res.status,
      code: body?.error?.code,
      details: body?.details,
    });
  }
  return body;
}

/**
 * Thin fetch wrapper. Access token lives in memory (the refresh cookie is set
 * by the server and marked httpOnly, so JS never touches it — F7).
 */
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

/** multipart upload (battle screenshots / KYC docs) */
export function apiUpload(path, file, kind = "battle") {
  const form = new FormData();
  form.append("file", file);
  return fetch(`/api${path}?kind=${kind}`, {
    method: "POST",
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    body: form,
    credentials: "include",
  }).then(handle);
}