import io from "socket.io-client";

/**
 * ONE socket singleton for the admin panel. The server requires a JWT at the
 * handshake (S3); auth.js sets the token before connecting. Admins automatically
 * join `role:admin`, which is where `admin:refresh` is broadcast (F2).
 */
export const socket = io("/", {
  path: "/socket.io",
  autoConnect: false,
  withCredentials: true,
});

export function setSocketToken(token) {
  socket.auth = { token };
}
