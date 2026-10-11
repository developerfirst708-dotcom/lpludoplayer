import { z } from "zod";
import { objectIdSchema, phoneSchema, stakeSchema } from "@lpludo/shared/schemas";

/** admin dummy (social-proof) battle */
export const adminDummySchema = z.object({
  stake: stakeSchema,
  name: z.string().trim().min(2, "Enter a name").max(40).optional(),
  mobile: z.string().trim().max(15).optional(),
});

/** admin client-tracking entry */
export const trackedAccountSchema = z.object({
  phone: phoneSchema,
  name: z.string().trim().max(40).optional(),
  note: z.string().trim().max(300).optional(),
});

/** admin / agent account management (superadmin only) */
export const adminAccountCreateSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(40),
  phone: phoneSchema,
  email: z.string().trim().email("Enter a valid email").optional().or(z.literal("")),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: z.enum(["admin", "agent"]),
  permissions: z.array(z.string()).default([]),
});

export const adminAccountUpdateSchema = z.object({
  name: z.string().trim().min(2).max(40).optional(),
  phone: phoneSchema.optional(),
  email: z.string().trim().email("Enter a valid email").optional().or(z.literal("")),
  password: z.string().min(8, "Password must be at least 8 characters").optional(),
  role: z.enum(["admin", "agent"]).optional(),
  permissions: z.array(z.string()).optional(),
});

/** admin wallet adjustment — bonus (credit) / penalty (debit) */
export const adminAdjustmentSchema = z
  .object({
    userId: objectIdSchema.optional(),
    phone: phoneSchema.optional(),
    amountPaise: z.number({ invalid_type_error: "Amount is required" }).int().positive("Amount must be greater than 0"),
    note: z.string().trim().max(200).optional(),
  })
  .refine((d) => d.userId || d.phone, { message: "Enter a user id or a mobile number" });

/** manual deposit: a payment screenshot is REQUIRED (reference rule) */
export const depositClaimSchema = z.object({
  amountPaise: z
    .number({ invalid_type_error: "Amount is required" })
    .int()
    .min(10000, "Minimum deposit is ₹100")
    .max(10000000, "Maximum deposit is ₹1,00,000"),
  utr: z.string().trim().min(6, "UTR must be at least 6 characters").max(30),
  proofImageKey: z.string().min(1, "A payment screenshot is required").max(200),
});

/** gateway deposits are whole rupees only (the gateway takes rupees, no paise) */
export const gatewayDepositSchema = z.object({
  amountPaise: z
    .number({ invalid_type_error: "Amount is required" })
    .int()
    .min(1000, "Minimum deposit is ₹10")
    .max(5000000, "Maximum deposit is ₹50,000"),
});

/** withdraw: min ₹200, UPI for small amounts, bank required above ₹2000 (reference rules) */
export const withdrawRequestSchema = z
  .object({
    amountPaise: z.number({ invalid_type_error: "Amount is required" }).int().min(20000, "Minimum withdrawal is ₹200"),
    method: z.enum(["upi", "bank"]).default("upi"),
    upiId: z.string().trim().regex(/^[\w.-]{2,64}@[a-zA-Z]{2,32}$/, "Enter a valid UPI ID").optional(),
    bank: z
      .object({
        accountName: z.string().trim().min(2, "Enter the account holder name").max(80),
        accountNumber: z.string().trim().regex(/^\d{6,20}$/, "Enter a valid account number"),
        ifsc: z.string().trim().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Enter a valid IFSC code"),
      })
      .optional(),
  })
  .superRefine((d, ctx) => {
    if (d.amountPaise > 200000 && d.method !== "bank") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["method"], message: "Withdrawals above ₹2000 must go to a bank account" });
    }
    if (d.method === "bank" && !d.bank) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["bank"], message: "Enter your bank details" });
    }
    if (d.method === "upi" && !d.upiId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["upiId"], message: "Enter your UPI ID" });
    }
  });

/** ad-hoc referral code (account created without one) */
export const referralApplySchema = z.object({
  code: z.string().trim().min(3, "Enter a referral code").max(16),
});

/** redeem referral balance -> playable balance (Adda Ludo limits: ₹200 – ₹10,000) */
export const referralRedeemSchema = z.object({
  amountPaise: z
    .number({ invalid_type_error: "Amount is required" })
    .int()
    .min(20000, "Minimum redeem is ₹200")
    .max(1000000, "Maximum redeem is ₹10,000"),
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
  websiteName: z.string().trim().max(60).optional(),
  depositUpiId: z.string().trim().regex(/^[\w.-]{2,64}@[a-zA-Z]{2,32}$/, "Enter a valid UPI ID").optional(),
  depositUpiName: z.string().trim().max(60).optional(),
  depositMinPaise: z.number().int().min(1000).optional(),
  depositMaxPaise: z.number().int().min(1000).optional(),
  withdrawalMinPaise: z.number().int().min(20000).optional(),
  /** gateway applies below this amount; manual UPI/UTR at or above it */
  depositGatewayMaxPaise: z.number().int().min(1000).optional(),
  maintenanceMode: z.boolean().optional(),
  /** support WhatsApp number, digits with country code (e.g. 919876543210) */
  supportWhatsapp: z
    .string()
    .trim()
    .regex(/^\+?\d{10,15}$/, "Enter the number with country code, digits only")
    .or(z.literal(""))
    .optional(),
});

export { validate } from "@lpludo/shared/schemas";