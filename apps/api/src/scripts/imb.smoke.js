/**
 * IMB Pay end-to-end diagnostic.
 *
 *   npm run imb:smoke -w @lpludo/api -- --amount 1
 *   npm run imb:smoke -w @lpludo/api -- --amount 10 --phone 9876543210
 *
 * Creates a REAL order on the live gateway, prints the hosted checkout URL,
 * then watches that order and reports whether the money reached the wallet.
 * Nothing is paid automatically — open the URL and pay it yourself (₹1 is
 * enough) to watch auto-verification + wallet credit happen for real.
 *
 * If nobody pays within the window the order is cancelled so it does not block
 * the player's next deposit.
 */
import dotenv from "dotenv";

dotenv.config({ path: new URL("../../.env", import.meta.url) });
dotenv.config({ path: new URL("../../../.env", import.meta.url) });

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const amountRupees = Number(arg("amount", "1"));
const phoneArg = arg("phone");
const userArg = arg("user");
const minutes = Number(arg("minutes", "3"));
const pollMs = Math.max(2000, Number(arg("interval", "3000")));

const { User } = await import("../db/models/user.model.js");
const { DepositRequest } = await import("../db/models/depositRequest.model.js");
const { LedgerEntry } = await import("../db/models/ledgerEntry.model.js");
const { connectMongo, disconnectMongo } = await import("../db/connect.js");
const { connectRedis, shutdownRedis, redis } = await import("../db/redis.js");
const { otpStoreInit } = await import("../services/otp.service.js");
const { walletView } = await import("../services/wallet.service.js");
const depositService = await import("../services/deposit.service.js");
const imbpay = await import("../services/imbpay.service.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!imbpay.isGatewayEnabled()) {
    console.error("✖ IMB_API_TOKEN is empty in apps/api/.env — the gateway is disabled.");
    process.exit(1);
  }
  if (!Number.isInteger(amountRupees) || amountRupees < 1) {
    console.error("✖ --amount must be a whole number of rupees (₹1 minimum)");
    process.exit(1);
  }
  console.log(`IMB API: ${process.env.IMB_API_URL || "https://api.imbpay.in"}`);

  await connectMongo();
  await connectRedis();
  otpStoreInit(redis);

  const user = userArg
    ? await User.findById(userArg).select("+phone").lean()
    : phoneArg
      ? await User.findOne({ phone: phoneArg }).select("+phone").lean()
      : await User.findOne({ role: "player", status: "active" }).select("+phone").lean();
  if (!user) {
    console.error("✖ No user found. Pass --phone <player phone> or --user <id>.");
    process.exit(1);
  }
  console.log(`player: ${user.name || "(unnamed)"} ${user.phone || ""} (${user._id})`);

  const before = await walletView(user._id);
  console.log(`wallet before: ₹${(before?.totalPaise || 0) / 100}`);

  const deposit = await depositService.startGatewayDeposit({
    userId: user._id,
    phone: user.phone,
    amountPaise: amountRupees * 100,
  });

  console.log("\n──────────────────────────────────────────────────────────");
  console.log(`order ${deposit.gateway.orderId} for ₹${amountRupees}`);
  console.log("pay here 👉", deposit.gateway.paymentUrl);
  console.log("──────────────────────────────────────────────────────────");
  console.log(`watching for ${minutes} min… (pay now, this credits automatically)\n`);

  const deadline = Date.now() + minutes * 60_000;
  let lastStatus = "pending";

  while (Date.now() < deadline) {
    await sleep(pollMs);
    let row;
    try {
      row = await depositService.reconcileGatewayDeposit(deposit._id, { source: "poll" });
    } catch (err) {
      console.log(`  ! gateway check failed: ${err.message}`);
      continue;
    }
    if (row.gateway.txnStatus && row.gateway.txnStatus !== lastStatus) {
      lastStatus = row.gateway.txnStatus;
      console.log(`  …gateway says ${lastStatus}`);
    }

    if (row.status === "approved") {
      const ledger = await LedgerEntry.findOne({ idempotencyKey: `deposit:${row._id}` }).lean();
      const after = await walletView(user._id);
      console.log("\n✔ PAYMENT VERIFIED — wallet credited automatically");
      console.log(`  utr: ${row.utr}`);
      console.log(`  verified via: ${row.gateway.verifiedSource}`);
      console.log(`  ledger row: ${ledger?._id} (type ${ledger?.type}, idempotency ${ledger?.idempotencyKey})`);
      console.log(`  wallet: ₹${(before?.totalPaise || 0) / 100} → ₹${after.totalPaise / 100}`);
      return;
    }

    if (row.status === "failed") {
      console.log(`\n✖ order closed: ${row.rejectReason}`);
      return;
    }
    if (row.gateway.note) console.log(`  ! ${row.gateway.note}`);
  }

  console.log("\n⏱ nothing was paid within the window — cancelling the order so it does not block the player.");
  const closed = await depositService.cancelGatewayDeposit({ depositId: deposit._id, userId: user._id });
  console.log(`  order is now: ${closed.status} (${closed.rejectReason || "—"})`);
  console.log("  (if it was paid after all, the sweep still credits it within ~60s)");
}

try {
  await main();
} catch (err) {
  console.error("\n✖ smoke failed:", err.message);
  process.exitCode = 1;
} finally {
  await shutdownRedis().catch(() => {});
  await disconnectMongo().catch(() => {});
}
