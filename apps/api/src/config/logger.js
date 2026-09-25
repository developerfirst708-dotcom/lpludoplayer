import pino from "pino";
import { env, isTest, isProd } from "./env.js";

export const logger = pino({
  level: isTest ? "silent" : process.env.LOG_LEVEL || (isProd ? "info" : "debug"),
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.otp",
      "*.password",
      "*.token",
      "*.accessToken",
      "*.refreshToken",
    ],
    censor: "[REDACTED]",
  },
  base: { env: env.NODE_ENV },
});

/** child logger bound to a module name */
export const log = (module) => logger.child({ module });
