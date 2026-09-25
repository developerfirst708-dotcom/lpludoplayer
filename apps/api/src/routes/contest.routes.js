import { Router } from "express";
import { asyncH } from "../middleware/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { apiLimiter } from "../middleware/rateLimit.js";
import * as contestController from "../controllers/contest.controller.js";
import { validate } from "@lpludo/shared/schemas";
import { paginationSchema } from "@lpludo/shared/schemas";

const router = Router();

router.use(apiLimiter);

router.get("/open", requireAuth, asyncH(contestController.listOpen));
router.get("/mine", requireAuth, asyncH(contestController.listMine));
router.post("/", requireAuth, asyncH(contestController.create));
router.get("/:id", requireAuth, asyncH(contestController.getContest));
router.post("/:id/join", requireAuth, asyncH(contestController.join));
router.post("/:id/room", requireAuth, asyncH(contestController.submitRoom));
router.post("/:id/result", requireAuth, asyncH(contestController.submitResult));
router.post("/:id/cancel", requireAuth, asyncH(contestController.cancel));

export default router;