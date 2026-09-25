import { Router } from "express";
import { asyncH } from "../middleware/errors.js";
import { webhookLimiter } from "../middleware/rateLimit.js";
import { imbWebhook } from "../controllers/webhook.controller.js";

/**
 * Public gateway callbacks — mounted OUTSIDE the authenticated /api routers and
 * deliberately outside apiLimiter (that one is keyed per user/IP and would 429
 * a legitimate callback burst). The handler is idempotent and re-verifies every
 * event server-to-server, so a spoofed POST can never move money.
 */
const router = Router();

router.post("/imb", webhookLimiter, asyncH(imbWebhook));

export default router;
