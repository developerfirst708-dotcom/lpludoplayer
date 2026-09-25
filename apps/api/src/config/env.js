import { z } from "zod";

/**
 * Fail-fast env validation. The reference app read process.env directly in 20+
 * places with silent defaults (including `NODE_ENV !== 'production'` master
 * OTPs) — here the process refuses to boot unless the environment is complete
 * and coherent.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(5000),

    MONGO_URI: z
      .string()
      .url()
      .default("mongodb://localhost:27018/lpludo_dev?replicaSet=rs0"),
    REDIS_URL: z.string().default("redis://localhost:6379"),

    JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be >= 32 chars"),
    JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET must be >= 32 chars"),
    JWT_ACCESS_TTL: z.string().default("15m"),
    JWT_REFRESH_TTL: z.string().default("30d"),

    CORS_ORIGINS: z.string().default("http://localhost:5173,http://localhost:5174"),

    ALLOW_DEV_OTP: z
      .string()
      .default("false")
      .transform((v) => ["1", "true", "yes"].includes(v.toLowerCase())),
    DEV_MASTER_OTP: z.string().regex(/^\d*$/, "DEV_MASTER_OTP must be digits").default(""),

    SMS_PROVIDER_KEY: z.string().default(""),

    LOCAL_STORAGE_DIR: z.string().default(".local-storage"),

    // auto-refund SLA (hours) for untouched conflicts
    CONFLICT_REFUND_HOURS: z.coerce.number().int().min(1).max(72).default(12),

    // admin bootstrap (seed script only; no hardcoded credentials in code)
    ADMIN_EMAIL: z.string().email().optional(),
    ADMIN_PASSWORD: z.string().min(8).optional(),
    ADMIN_NAME: z.string().default("Main Admin"),

    /* ---- IMB Pay UPI gateway (hybrid deposits: gateway < threshold, manual >= threshold) ---- */
    IMB_API_URL: z.string().url().default("https://api.imbpay.in"),
    /** empty => gateway disabled and the manual UPI/UTR flow serves every amount */
    IMB_API_TOKEN: z.string().default(""),
    IMB_API_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(15_000),
    /** server-side throttle between status checks for one order (saves IMB credits) */
    IMB_STATUS_MIN_INTERVAL_MS: z.coerce.number().int().min(0).max(120_000).default(10_000),
    /** an unpaid gateway order is marked failed after this long (gateway itself expires at 30 min) */
    IMB_ORDER_GRACE_MIN: z.coerce.number().int().min(5).max(240).default(45),

    /** where the gateway sends the player back after checkout (browser URL) */
    PUBLIC_WEB_URL: z.string().url().default("http://localhost:5173"),
    /** public base URL of THIS api; only used to log the webhook URL to paste into the IMB dashboard */
    PUBLIC_API_URL: z.string().url().or(z.literal("")).default(""),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production") {
      if (env.ALLOW_DEV_OTP) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ALLOW_DEV_OTP"], message: "ALLOW_DEV_OTP cannot be true in production" });
      }
      if (env.DEV_MASTER_OTP) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["DEV_MASTER_OTP"], message: "DEV_MASTER_OTP must be empty in production" });
      }
      if (env.JWT_ACCESS_SECRET.startsWith("replace-me") || env.JWT_REFRESH_SECRET.startsWith("replace-me")) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["JWT_ACCESS_SECRET"], message: "secrets must be changed from the example values" });
      }
    }
  });

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("❌ Invalid environment:\n" + parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n"));
  process.exit(1);
}

export const env = parsed.data;

export const isProd = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";
export const isDev = env.NODE_ENV === "development";

export const corsOrigins = env.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
