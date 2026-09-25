import { ValidationError, NotFoundError, AppError, IllegalTransitionError, WalletError } from "@lpludo/shared";
import { env, isProd } from "../config/env.js";
import { logger } from "../config/logger.js";

/** map known error classes to HTTP responses; unknown -> 500 without internals */
export function errorHandler(err, req, res, _next) {
  // zod validation errors thrown by shared/schemas.validate()
  if (err?.isZodError) err = new ValidationError(err.zodError);
  if (err?.name === "IllegalTransitionError") {
    err = new AppError(err.message, { status: 409, code: "ILLEGAL_STATE" });
  }
  if (err?.name === "WalletError") err = new AppError(err.message, { status: 409, code: "WALLET_ERROR" });
  if (err?.name === "ValidationError") err.status = 422;

  // mongoose duplicate key -> friendly 409
  if (err?.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || "field";
    err = new AppError(`A record with this ${field} already exists`, { status: 409, code: "DUPLICATE" });
  }
  if (err?.name === "CastError") err = new NotFoundError("Record not found");

  const status = err?.status || err?.statusCode || 500;
  const code = err?.code || (status >= 500 ? "INTERNAL_ERROR" : "APP_ERROR");

  if (status >= 500) {
    logger.error({ err, reqId: req.id, path: req.path }, err?.message || "unhandled error");
  }

  res.status(status).json({
    error: { code, message: status >= 500 && isProd ? "Something went wrong" : err?.message || "Error" },
    requestId: req.id,
    ...(err?.expose && err.details ? { details: err.details } : {}),
  });
}

/** 404 for unknown routes */
export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: "NOT_FOUND", message: `No route: ${req.method} ${req.path}` } });
}

/** last-resort async wrapper so thrown errors reach errorHandler */
export const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
