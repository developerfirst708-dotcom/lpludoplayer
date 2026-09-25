import { Router } from "express";
import { asyncH } from "../middleware/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { sendOtp, verifyOtp, refresh, logout, me } from "../controllers/auth.controller.js";
import { otpLimiter, apiLimiter } from "../middleware/rateLimit.js";

const router = Router();

router.post("/send-otp", otpLimiter, asyncH(sendOtp));
router.post("/verify-otp", otpLimiter, asyncH(verifyOtp));
router.post("/refresh", apiLimiter, asyncH(refresh));
router.post("/logout", apiLimiter, asyncH(logout));
router.get("/me", requireAuth, apiLimiter, asyncH(me));

export default router;