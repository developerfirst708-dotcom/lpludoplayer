import { Router } from "express";
import { asyncH } from "../middleware/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { apiLimiter } from "../middleware/rateLimit.js";
import { walletView } from "../services/wallet.service.js";
import { listLedger } from "../services/ledger.service.js";
import { validate } from "@lpludo/shared/schemas";
import { paginationSchema } from "@lpludo/shared/schemas";

const router = Router();

/** GET /wallet — balances + running counters (single source: wallet doc) */
router.get("/", requireAuth, apiLimiter, asyncH(async (req, res) => {
  const view = await walletView(req.user.id);
  res.json(view);
}));

/** GET /wallet/history — paginated ledger rows (never leaks other users') */
router.get("/history", requireAuth, apiLimiter, asyncH(async (req, res) => {
  const { limit } = validate(paginationSchema, req.query);
  const rows = await listLedger(req.user.id, { limit: limit + 1 });
  const hasMore = rows.length > limit;
  res.json({
    items: rows.slice(0, limit).map((r) => ({
      id: r._id, type: r.type, amountPaise: r.amount, heldDeltaPaise: r.heldDelta,
      balanceAfterPaise: r.balanceAfter, note: r.note, refType: r.refType,
      createdAt: r.createdAt,
    })),
    hasMore,
  });
}));

export default router;