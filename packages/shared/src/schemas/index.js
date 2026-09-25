/**
 * zod schemas shared by client (form validation) and server (request validation).
 * One definition = no drift between what the UI checks and what the API trusts.
 */
import { z } from "zod";
import { BATTLE_STAKES_Paise } from "../prize.js";

/** 10-digit Indian mobile, stored without +91. */
export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, "").replace(/^\+?91(?=\d{10}$)/, ""))
  .pipe(z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number"));

export const sendOtpSchema = z.object({ phone: phoneSchema });

/**
 * First login creates the player — no `name` is collected anymore: the server
 * assigns a unique 5-letter handle automatically (see auth.service.js).
 */
export const verifyOtpSchema = z.object({
  phone: phoneSchema,
  otp: z.string().trim().regex(/^\d{6}$/, "OTP must be 6 digits"),
  referralCode: z.string().trim().max(16).optional(),
});

/** Auto-generated player handle: exactly 5 letters, no digits, no look-alikes. */
export const PLAYER_NAME_LENGTH = 5;
export const PLAYER_NAME_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
export const playerNameSchema = z
  .string()
  .trim()
  .length(PLAYER_NAME_LENGTH, `Name must be exactly ${PLAYER_NAME_LENGTH} letters`)
  .regex(new RegExp(`^[${PLAYER_NAME_ALPHABET}]+$`, "i"), "Name must contain only letters");

export const stakeSchema = z
  .number({ invalid_type_error: "Stake is required" })
  .int()
  .refine((v) => BATTLE_STAKES_Paise.includes(v), "Unknown stake amount");

export const createContestSchema = z.object({ stake: stakeSchema });

export const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");

export const submitRoomSchema = z.object({
  contestId: objectIdSchema,
  roomCode: z.string().trim().min(4).max(20),
});

export const submitResultSchema = z.object({
  contestId: objectIdSchema,
  outcome: z.enum(["won", "lost", "cancel"]),
  screenshotKeys: z.array(z.string().min(1).max(200)).max(4).default([]),
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(40).optional(),
  avatarUrl: z.string().url().max(300).optional(),
  payoutUpi: z.string().trim().regex(/^[\w.-]{2,64}@[a-zA-Z]{2,32}$/, "Enter a valid UPI ID").optional(),
});

export const withdrawRequestSchema = z.object({
  amountPaise: z.number({ invalid_type_error: "Amount is required" }).int().min(100000, "Minimum withdrawal is ₹1,000"),
  upiId: z.string().trim().regex(/^[\w.-]{2,64}@[a-zA-Z]{2,32}$/, "Enter a valid UPI ID"),
});

export const kycSubmitSchema = z.object({
  holderName: z.string().trim().min(2).max(60),
  upiId: z.string().trim().regex(/^[\w.-]{2,64}@[a-zA-Z]{2,32}$/, "Enter a valid UPI ID"),
  frontImageKey: z.string().min(1).max(200),
  backImageKey: z.string().min(1).max(200),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const adminSettleSchema = z.object({
  contestId: objectIdSchema,
  winnerUserId: objectIdSchema,
  note: z.string().trim().max(300).optional(),
});

export const adminReviewSchema = z.object({
  id: objectIdSchema,
  action: z.enum(["approve", "reject"]),
  note: z.string().trim().max(300).optional(),
});

export const adminLoginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

/** helper used by routes: validate(req.body, schema) -> parsed data or ValidationError */
export function validate(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const err = new Error("validation");
    err.isZodError = true;
    err.zodError = result.error;
    throw err;
  }
  return result.data;
}
