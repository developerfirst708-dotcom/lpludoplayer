import io from "socket.io-client";

/**
 * ONE socket singleton for the whole app. The server requires a JWT at the
 * handshake (S3); auth.js sets the token before connecting. Rooms are re-joined
 * by the pages on the "connect" event (F2).
 *
 * In production the socket lives on the API's domain (VITE_API_URL); in dev the
 * empty value keeps it same-origin so the Vite proxy forwards /socket.io.
 */
const API_ORIGIN = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");

export const socket = io(API_ORIGIN || "/", {
  path: "/socket.io",
  autoConnect: false,
  withCredentials: true,
});

export function setSocketToken(token) {
  socket.auth = { token };
}