import { Router } from "express";
import { asyncH } from "../middleware/errors.js";
import { apiLimiter } from "../middleware/rateLimit.js";
import { publicSettings } from "../controllers/settings.controller.js";

const router = Router();

router.get("/public", apiLimiter, asyncH(publicSettings));

export default router;
