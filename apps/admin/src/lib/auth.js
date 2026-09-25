import { api, setAccessToken } from "./api.js";
import { socket, setSocketToken } from "./socket.js";

let state = { token: null, user: null, ready: false };
const listeners = new Set();

function emit() {
  listeners.forEach((fn) => fn(state));
}

export function subscribe(fn) {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

export function authState() {
  return state;
}

export async function tryResume() {
  try {
    const r = await api("/auth/refresh", { method: "POST" });
    setAccessToken(r.accessToken);
    setSocketToken(r.accessToken);
    state = { ...state, token: r.accessToken, user: r.admin, ready: true };
    socket.connect();
  } catch {
    state = { ...state, token: null, user: null, ready: true };
  }
  emit();
}

export async function adminLogin(email, password) {
  const r = await api("/admin/login", { method: "POST", body: { email, password } });
  setAccessToken(r.accessToken);
  setSocketToken(r.accessToken);
  state = { ...state, token: r.accessToken, user: r.admin, ready: true };
  socket.connect();
  emit();
  return r;
}

export async function logout() {
  try { await api("/auth/logout", { method: "POST" }); } catch { /* already dead */ }
  setAccessToken(null);
  socket.disconnect();
  state = { token: null, user: null, ready: true };
  emit();
}
