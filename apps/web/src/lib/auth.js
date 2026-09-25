import { api, setAccessToken } from "./api.js";
import { socket, setSocketToken } from "./socket.js";

/** Single auth store (F7): token in memory, user object, listeners. */
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
    state = { ...state, token: r.accessToken, user: r.user, ready: true };
    socket.connect();
  } catch {
    state = { ...state, token: null, user: null, ready: true };
  }
  emit();
}

export async function sendOtp(phone) {
  return api("/auth/send-otp", { method: "POST", body: { phone } });
}

export async function verifyOtp({ phone, otp, referralCode }) {
  const r = await api("/auth/verify-otp", { method: "POST", body: { phone, otp, referralCode } });
  setAccessToken(r.accessToken);
  setSocketToken(r.accessToken);
  state = { ...state, token: r.accessToken, user: r.user, ready: true };
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
