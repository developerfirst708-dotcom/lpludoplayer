import { verifyAccessToken } from "../services/auth.service.js";
import { UnauthorizedError, ForbiddenError } from "@lpludo/shared";
import { User } from "../db/models/user.model.js";
import { env } from "../config/env.js";

/** 401 if no valid access token. Attaches `req.user`. */
export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) throw new UnauthorizedError();
    const payload = verifyAccessToken(header.slice(7));

    // tokenVersion is select:false (PII-style protection) — it MUST be fetched
    // explicitly or every request would compare against `undefined`
    const user = await User.findById(payload.sub).select("+tokenVersion +phone");
    if (!user) throw new UnauthorizedError();
    if (user.status === "banned") throw new ForbiddenError("This account is banned");
    // token-version check — an invalidated session (password change/ban) dies here
    if (payload.tv !== user.tokenVersion) throw new UnauthorizedError("Session revoked, please log in again");

    req.user = { id: user._id.toString(), role: user.role, doc: user };
    return next();
  } catch (err) {
    next(err);
  }
}

/** Optional auth — attaches req.user when a valid token is present. */
export async function maybeAuth(req, _res, next) {
  try {
    const header = req.headers.authorization || "";
    if (header.startsWith("Bearer ")) {
      const payload = verifyAccessToken(header.slice(7));
      const user = await User.findById(payload.sub).select("+tokenVersion +phone");
      if (user && user.status === "active" && payload.tv === user.tokenVersion) {
        req.user = { id: user._id.toString(), role: user.role, doc: user };
      }
    }
  } catch {
    /* anonymous is fine here */
  }
  next();
}

export const requireAdmin = requireRole(["admin", "superadmin"]);
export const requireSuperadmin = requireRole(["superadmin"]);

function requireRole(roles) {
  return (req, res, next) => {
    requireAuth(req, res, (err) => {
      if (err) return next(err);
      if (!roles.includes(req.user.role)) return next(new ForbiddenError("Admin access required"));
      next();
    });
  };
}
