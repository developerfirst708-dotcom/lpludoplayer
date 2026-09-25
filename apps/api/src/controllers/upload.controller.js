import fs from "fs";
import path from "path";
import { env } from "../config/env.js";
import { BadRequestError, NotFoundError, ForbiddenError } from "@lpludo/shared";
import { log } from "../config/logger.js";

const l = log("upload");

const ROOT = path.resolve(env.LOCAL_STORAGE_DIR);

/** LocalDiskStorage adapter — swap for S3/R2 later without touching callers. */
function keyPath(key) {
  if (!/^[a-f0-9]{24}\/[a-z0-9]+\/[A-Za-z0-9._-]+$/.test(key)) {
    throw new BadRequestError("Invalid storage key");
  }
  const p = path.join(ROOT, key);
  if (!p.startsWith(ROOT)) throw new BadRequestError("Invalid storage key");
  return p;
}

/** POST /uploads (multipart, single file) — validated BEFORE any disk write (C10) */
export async function uploadFile(req, res) {
  if (!req.file) throw new BadRequestError("No file uploaded");
  const { buffer, mimetype, originalname, size } = req.file;

  // magic-byte sniff — the declared mime is not trusted
  const isJpeg = buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8;
  const isPng = buffer.length > 8 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  const isWebp = buffer.length > 12 && buffer.toString("ascii", 8, 12) === "WEBP";
  const sniffed = isJpeg ? "image/jpeg" : isPng ? "image/png" : isWebp ? "image/webp" : null;
  if (!sniffed || sniffed !== mimetype) throw new BadRequestError("File content does not match its type");

  const ext = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" }[sniffed];
  const kind = String(req.query.kind || "battle"); // battle | kyc
  if (!["battle", "kyc"].includes(kind)) throw new BadRequestError("Unknown upload kind");

  const userId = req.user.id;
  const key = `${userId}/${kind}/${Date.now().toString(36)}${ext}`;
  const dest = keyPath(key);
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  await fs.promises.writeFile(dest, buffer);

  l.info({ key, bytes: size }, "upload stored");
  res.status(201).json({ key, mime: sniffed, bytes: size });
}

/** GET /uploads/:key — owner or admin only; streams the bytes privately (S8) */
export async function readUpload(req, res) {
  const key = req.params[0];
  const p = keyPath(key);
  const [ownerId] = key.split("/");

  const isOwner = req.user?.id && ownerId === req.user.id;
  const isAdmin = req.user?.role && ["admin", "superadmin"].includes(req.user.role);
  // KYC docs uploaded BEFORE login identity changes hands are still owner-only;
  // the admin app hits the same endpoint with its privileged token.
  if (!isOwner && !isAdmin) throw new ForbiddenError("Not your file");

  let stat;
  try {
    stat = await fs.promises.stat(p);
  } catch {
    throw new NotFoundError("File not found");
  }

  res.setHeader("Content-Type", { ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" }[path.extname(p)] || "application/octet-stream");
  res.setHeader("Content-Length", stat.size);
  res.setHeader("Cache-Control", "private, max-age=3600");
  fs.createReadStream(p).pipe(res);
}