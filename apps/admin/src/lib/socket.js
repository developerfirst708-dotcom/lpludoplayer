import io from "socket.io-client";

/**
 * ONE socket singleton for the admin panel. The server requires a JWT at the
 * handshake (S3); auth.js sets the token before connecting. Admins automatically
 * join `role:admin`, which is where `admin:refresh` is broadcast (F2).
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
