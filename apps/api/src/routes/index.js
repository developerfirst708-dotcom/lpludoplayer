import { Router } from "express";

import authRoutes from "./auth.routes.js";
import userRoutes from "./user.routes.js";
import walletRoutes from "./wallet.routes.js";
import contestRoutes from "./contest.routes.js";
import paymentRoutes from "./payment.routes.js";
import webhookRoutes from "./webhook.routes.js";
import uploadRoutes from "./upload.routes.js";
import adminRoutes from "./admin.routes.js";

const api = Router();

api.use("/auth", authRoutes);
api.use("/user", userRoutes);
api.use("/wallet", walletRoutes);
api.use("/contests", contestRoutes);
api.use("/payments", paymentRoutes);
api.use("/webhooks", webhookRoutes); // public payment-gateway callbacks
api.use("/uploads", uploadRoutes);
api.use("/files", uploadRoutes); // authenticated read of stored objects
api.use("/admin", adminRoutes);

export default api;