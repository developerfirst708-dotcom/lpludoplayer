import { z } from "zod";
import { objectIdSchema } from "@lpludo/shared/schemas";

export const depositClaimSchema = z.object({
  amountPaise: z.number({ invalid_type_error: "Amount is required" }).int().min(1000, "Minimum deposit is ₹10"),
  utr: z.string().trim().min(6, "UTR must be at least 6 characters").max(30),
  proofImageKey: z.string().max(200).optional(),
});

/** gateway deposits are whole rupees only (the gateway takes rupees, no paise) */
export const gatewayDepositSchema = z.object({
  amountPaise: z
    .number({ invalid_type_error: "Amount is required" })
    .int()
    .min(1000, "Minimum deposit is ₹10")
    .max(5000000, "Maximum deposit is ₹50,000"),
});

export const withdrawRequestSchema = z.object({
  amountPaise: z
    .number({ invalid_type_error: "Amount is required" })
    .int()
    .min(100000, "Minimum withdrawal is ₹1,000"),
  upiId: z.string().trim().regex(/^[\w.-]{2,64}@[a-zA-Z]{2,32}$/, "Enter a valid UPI ID"),
});

export const KYC_STATUS = ["not_submitted", "pending", "verified", "rejected"];

export const adminUserActionSchema = z.object({
  userId: objectIdSchema,
  action: z.enum(["ban", "unban"]),
  reason: z.string().trim().max(200).optional(),
});

export const adminKycReviewSchema = z.object({
  userId: objectIdSchema,
  action: z.enum(["approve", "reject"]),
  note: z.string().trim().max(200).optional(),
});

export const adminSettingsSchema = z.object({
  depositUpiId: z.string().trim().regex(/^[\w.-]{2,64}@[a-zA-Z]{2,32}$/, "Enter a valid UPI ID").optional(),
  depositUpiName: z.string().trim().max(60).optional(),
  depositMinPaise: z.number().int().min(1000).optional(),
  withdrawalMinPaise: z.number().int().min(100000).optional(),
  /** gateway applies below this amount; manual UPI/UTR at or above it */
  depositGatewayMaxPaise: z.number().int().min(1000).optional(),
  maintenanceMode: z.boolean().optional(),
});

export { validate } from "@lpludo/shared/schemas";