import io from "socket.io-client";

/**
 * ONE socket singleton for the whole app. The server requires a JWT at the
 * handshake (S3); auth.js sets the token before connecting. Rooms are re-joined
 * by the pages on the "connect" event (F2).
 */
export const socket = io("/", {
  path: "/socket.io",
  autoConnect: false,
  withCredentials: true,
});

export function setSocketToken(token) {
  socket.auth = { token };
}