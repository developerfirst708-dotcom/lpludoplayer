import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import jwt from "jsonwebtoken";
import { env, corsOrigins } from "../config/env.js";
import { redis, redisSub } from "../db/redis.js";
import { User, Contest } from "../db/models/index.js";
import { log } from "../config/logger.js";

const l = log("realtime");

let io = null;

/**
 * Realtime gateway — JWT handshake auth (S3), per-user + per-contest rooms with
 * a membership check, slim DTOs only, Redis adapter so every instance shares
 * rooms (P12). The client resubscribes on reconnect (F2).
 */
export async function initRealtime(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: corsOrigins, credentials: true },
    maxHttpBufferSize: 1e6,
  });

  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        (socket.handshake.headers?.authorization || "").replace(/^Bearer\s+/i, "");
      if (!token) return next(new Error("unauthorized"));
      const payload = jwt.verify(token, env.JWT_ACCESS_SECRET);
      const user = await User.findById(payload.sub).select("status role tokenVersion");
      if (!user || user.status !== "active" || payload.tv !== user.tokenVersion) {
        return next(new Error("unauthorized"));
      }
      socket.data.userId = String(user._id);
      socket.data.role = user.role;
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });

  await io.adapter(createAdapter(redis, redisSub));

  io.on("connection", (socket) => {
    const userId = socket.data.userId;
    socket.join(`user:${userId}`);
    if (["admin", "superadmin"].includes(socket.data.role)) socket.join("role:admin");

    socket.on("subscribe:contests", (_msg, ack) => {
      socket.join("contests:open");
      ack?.({ ok: true });
    });

    socket.on("unsubscribe", (_msg, ack) => {
      socket.leave("contests:open");
      ack?.({ ok: true });
    });

    socket.on("watch:contest", async ({ contestId } = {}, ack) => {
      try {
        const contest = await Contest.findById(contestId).select("players").lean();
        if (!contest) throw new Error("battle not found");
        const isParticipant = (contest.players || []).some((p) => String(p.userId) === userId);
        const isAdmin = ["admin", "superadmin"].includes(socket.data.role);
        if (isParticipant || isAdmin) socket.join(`contest:${contestId}`);
        ack?.({ ok: true, watching: isParticipant || isAdmin });
      } catch (err) {
        ack?.({ ok: false, error: err.message });
      }
    });
  });

  l.info("realtime gateway ready (redis adapter)");
  return io;
}

export function emitToUser(userId, event, payload) {
  if (io) io.to(`user:${String(userId)}`).emit(event, payload);
}

export function emitWalletUpdate(userId, view) {
  if (io) io.to(`user:${String(userId)}`).emit("wallet:updated", view);
}

/** Slim contest DTO over the wire — never includes room code or phones. */
export function emitContestUpdate(contest) {
  if (!io) return;
  const contestId = String(contest._id ?? contest.id);
  io.to(`contest:${contestId}`).emit("contest:updated", {
    id: contestId,
    status: contest.status,
    stake: contest.stake,
    winnerUserId: contest.winnerUserId ?? null,
  });
  io.to("contests:open").emit("contest:list-changed", { id: contestId, status: contest.status });
}

export function emitAdminRefresh(reason = "data-changed") {
  if (io) io.to("role:admin").emit("admin:refresh", { reason, at: new Date() });
}