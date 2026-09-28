import { Router } from "express";
import { asyncH } from "../middleware/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { apiLimiter } from "../middleware/rateLimit.js";
import { getProfile, updateProfile, submitKyc, getReferrals, applyReferral } from "../controllers/user.controller.js";

const router = Router();

router.use(apiLimiter);
router.get("/profile", requireAuth, asyncH(getProfile));
router.patch("/profile", requireAuth, asyncH(updateProfile));
router.post("/kyc", requireAuth, asyncH(submitKyc));
router.get("/referrals", requireAuth, asyncH(getReferrals));
router.post("/referral", requireAuth, asyncH(applyReferral));

export default router;