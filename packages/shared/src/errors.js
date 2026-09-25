/** Typed application errors the HTTP layer maps to status codes. */
export class AppError extends Error {
  constructor(message, { status = 400, code = "APP_ERROR", details } = {}) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = true;
  }
}

export class BadRequestError extends AppError {
  constructor(message, details) { super(message, { status: 400, code: "BAD_REQUEST", details }); }
}
export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") { super(message, { status: 401, code: "UNAUTHORIZED" }); }
}
export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") { super(message, { status: 403, code: "FORBIDDEN" }); }
}
export class NotFoundError extends AppError {
  constructor(message = "Not found") { super(message, { status: 404, code: "NOT_FOUND" }); }
}
export class ConflictError extends AppError {
  constructor(message, details) { super(message, { status: 409, code: "CONFLICT", details }); }
}
export class ValidationError extends AppError {
  constructor(zodError) {
    const first = zodError?.issues?.[0];
    super(first ? `${first.path.join(".") || "body"}: ${first.message}` : "Validation failed", {
      status: 422,
      code: "VALIDATION_ERROR",
      details: zodError?.issues,
    });
  }
}
export class IdempotencyConflictError extends AppError {
  constructor(key) { super(`idempotency key already used with a different payload: ${key}`, { status: 409, code: "IDEMPOTENCY_CONFLICT" }); }
}
export class WalletError extends AppError {
  constructor(message, details) { super(message, { status: 409, code: "WALLET_ERROR", details }); }
}
export class TooManyRequestsError extends AppError {
  constructor(message = "Too many requests") { super(message, { status: 429, code: "TOO_MANY_REQUESTS" }); }
}
