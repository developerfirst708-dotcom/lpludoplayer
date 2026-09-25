import { Router } from "express";
import { asyncH } from "../middleware/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { apiLimiter } from "../middleware/rateLimit.js";
import * as paymentController from "../controllers/payment.controller.js";

const router = Router();

router.use(apiLimiter);

// deposits
router.get("/deposit/details", requireAuth, asyncH(paymentController.depositDetails));
router.post("/deposit", requireAuth, asyncH(paymentController.createDeposit));
// instant gateway deposits (amounts below the configured threshold)
router.post("/deposit/gateway", requireAuth, asyncH(paymentController.createGatewayDeposit));
router.get("/deposit/:id", requireAuth, asyncH(paymentController.getDeposit));
router.post("/deposit/:id/cancel", requireAuth, asyncH(paymentController.cancelDeposit));
router.get("/deposits", requireAuth, asyncH(paymentController.myDeposits));

// withdrawals
router.post("/withdraw", requireAuth, asyncH(paymentController.requestWithdraw));
router.get("/withdrawals", requireAuth, asyncH(paymentController.myWithdrawals));

export default router;