import { Router } from "express";
import multer from "multer";
import path from "path";
import { asyncH } from "../middleware/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { apiLimiter } from "../middleware/rateLimit.js";
import { uploadFile, readUpload } from "../controllers/upload.controller.js";
import { env } from "../config/env.js";
import { BadRequestError } from "@lpludo/shared";

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

/**
 * Memory storage -> controller validates the FULL buffer (magic bytes, size)
 * BEFORE anything touches the disk (fixes C10: write-then-validate).
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) return cb(new BadRequestError("Only JPEG, PNG or WEBP images are allowed"));
    cb(null, true);
  },
});

const router = Router();

router.use(apiLimiter);

/** POST /uploads — battle screenshots & KYC docs; returns a storage key */
router.post("/", requireAuth, upload.single("file"), asyncH(uploadFile));

/** GET /uploads/:key — PRIVATE, authenticated read (fixes S8 public-uploads) */
router.get("/*", requireAuth, asyncH(readUpload));

export default router;