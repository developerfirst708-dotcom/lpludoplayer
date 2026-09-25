import { Router } from "express";
import { asyncH } from "../middleware/errors.js";
import { requireAdmin, requireSuperadmin } from "../middleware/auth.js";
import { apiLimiter, adminLoginLimiter } from "../middleware/rateLimit.js";
import * as adminController from "../controllers/admin.controller.js";

const router = Router();

// ---- public (admin login) ----
router.post("/login", adminLoginLimiter, asyncH(adminController.login));

// ---- everything below requires an admin token ----
router.use(requireAdmin, apiLimiter);

router.get("/dashboard/summary", asyncH(adminController.dashboardSummary));
router.get("/users", asyncH(adminController.listUsers));
router.post("/users/action", asyncH(adminController.userAction));
router.get("/kyc", asyncH(adminController.listKyc));
router.post("/kyc/review", asyncH(adminController.reviewKyc));
router.get("/deposits", asyncH(adminController.listDeposits));
router.post("/deposits/review", asyncH(adminController.reviewDeposit));
router.get("/withdrawals", asyncH(adminController.listWithdrawals));
router.post("/withdrawals/review", asyncH(adminController.reviewWithdrawal));
router.get("/contests", asyncH(adminController.listContests));
router.get("/contests/:id", asyncH(adminController.contestDetail));
router.post("/contests/settle", asyncH(adminController.settleContest));
router.post("/contests/:id/refund", asyncH(adminController.refundContest));
router.post("/contests/:id/force-expire", asyncH(adminController.forceExpire));
router.get("/ledger", asyncH(adminController.listLedgerAll));
router.get("/audit", asyncH(adminController.listAudit));
router.get("/settings", asyncH(adminController.settingsDetail));

// superadmin only
router.post("/settings", requireSuperadmin, asyncH(adminController.updateSettings));

export default router;