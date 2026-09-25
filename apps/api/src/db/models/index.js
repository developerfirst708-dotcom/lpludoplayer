import mongoose from "mongoose";

import { User } from "./user.model.js";
import { Wallet } from "./wallet.model.js";
import { Contest } from "./contest.model.js";
import { LedgerEntry } from "./ledgerEntry.model.js";
import { DepositRequest } from "./depositRequest.model.js";
import { WithdrawalRequest } from "./withdrawalRequest.model.js";
import { AuditLog } from "./auditLog.model.js";
import { Settings, getSettings } from "./settings.model.js";

export {
  User,
  Wallet,
  Contest,
  LedgerEntry,
  DepositRequest,
  WithdrawalRequest,
  AuditLog,
  Settings,
  getSettings,
};

export const ALL_MODELS = [User, Wallet, Contest, LedgerEntry, DepositRequest, WithdrawalRequest, AuditLog, Settings];