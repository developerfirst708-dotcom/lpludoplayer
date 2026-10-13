/**
 * Wait until the API port accepts connections, then exit 0.
 *
 * `npm run dev` starts the API and both Vite servers together; Vite boots in
 * ~1s while the API still needs to connect Mongo + Redis. Without this, the
 * frontends' first /socket.io and /auth/refresh proxy requests hit a closed
 * port and log "connect ECONNREFUSED 127.0.0.1:5000".
 *
 * Usage: node scripts/dev-wait.mjs [port] [host]
 */
import net from "node:net";

const port = Number(process.argv[2] || 5000);
const host = process.argv[3] || "127.0.0.1";
const deadline = Date.now() + 60_000;

function tryConnect() {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => { socket.destroy(); resolve(false); });
  });
}

while (Date.now() < deadline) {
  if (await tryConnect()) process.exit(0);
  await new Promise((r) => setTimeout(r, 300));
}

console.error(`dev-wait: ${host}:${port} did not open within 60s`);
process.exit(1);
