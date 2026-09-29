import { Router } from "express";
import { asyncH } from "../middleware/errors.js";
import { requireStaff, requireSuperadmin, requirePermission } from "../middleware/auth.js";
import { apiLimiter, adminLoginLimiter } from "../middleware/rateLimit.js";
import * as adminController from "../controllers/admin.controller.js";

const router = Router();

// ---- public (admin login — mobile + password) ----
router.post("/login", adminLoginLimiter, asyncH(adminController.login));

// ---- everything below requires an admin-ish token ----
// An `agent` additionally needs the matching section permission; `admin` and
// `superadmin` pass every requirePermission guard.
router.use(requireStaff, apiLimiter);

router.get("/me", asyncH(adminController.me));
router.get("/dashboard", requirePermission("dashboard"), asyncH(adminController.dashboardStats));

router.get("/users", requirePermission("user"), asyncH(adminController.listUsers));
router.get("/users/:id", requirePermission("user"), asyncH(adminController.userDetail));
router.post("/users/action", requirePermission("user"), asyncH(adminController.userAction));

router.get("/kyc", requirePermission("kyc"), asyncH(adminController.listKyc));
router.post("/kyc/review", requirePermission("kyc"), asyncH(adminController.reviewKyc));

router.get("/deposits", requirePermission("deposit"), asyncH(adminController.listDeposits));
router.post("/deposits/review", requirePermission("deposit"), asyncH(adminController.reviewDeposit));

router.get("/withdrawals", requirePermission("withdraw"), asyncH(adminController.listWithdrawals));
router.post("/withdrawals/review", requirePermission("withdraw"), asyncH(adminController.reviewWithdrawal));

router.get("/contests", requirePermission("matches"), asyncH(adminController.listContests));
router.get("/contests/:id", requirePermission("matches"), asyncH(adminController.contestDetail));
router.post("/contests/settle", requirePermission("matches"), asyncH(adminController.settleContest));
router.post("/contests/:id/refund", requirePermission("matches"), asyncH(adminController.refundContest));
router.post("/contests/:id/force-expire", requirePermission("matches"), asyncH(adminController.forceExpire));

router.get("/ledger", requirePermission("ledger"), asyncH(adminController.listLedgerAll));
router.get("/audit", requirePermission("audit"), asyncH(adminController.listAudit));

router.get("/settings", requirePermission("setting"), asyncH(adminController.settingsDetail));
router.post("/settings", requireSuperadmin, asyncH(adminController.updateSettings));

// bonus / penalty (Section: Settings)
router.post("/bonus", requirePermission("setting"), asyncH(adminController.addBonus));
router.post("/penalty", requirePermission("setting"), asyncH(adminController.addPenalty));
router.get("/settings-report", requirePermission("setting"), asyncH(adminController.settingsReport));

// admin / agent control — superadmin only
router.get("/admin-list", requireSuperadmin, asyncH(adminController.adminList));
router.post("/create-admin", requireSuperadmin, asyncH(adminController.createAdmin));
router.patch("/update/:id", requireSuperadmin, asyncH(adminController.updateAdmin));
router.delete("/delete/:id", requireSuperadmin, asyncH(adminController.deleteAdmin));
router.get("/agent-report", requireSuperadmin, asyncH(adminController.agentReport));

export default router;
