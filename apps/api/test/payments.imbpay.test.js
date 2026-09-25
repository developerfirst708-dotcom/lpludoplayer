// env MUST be set before the app modules are imported (config/env.js parses on import)
process.env.NODE_ENV = "test";
process.env.MONGO_URI = "mongodb://localhost:27018/lpludo_test_imbpay?replicaSet=rs0";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "test-access-secret-0123456789abcdef0123456789abcdef";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-0123456789abcdef0123456789abc";
process.env.ALLOW_DEV_OTP = "true";
process.env.ADMIN_EMAIL = "admin@lpludo.test";
process.env.ADMIN_PASSWORD = "Admin@12345";
process.env.LOCAL_STORAGE_DIR = ".local-storage-test-imb";
process.env.PUBLIC_WEB_URL = "http://localhost:5173";
process.env.IMB_API_TOKEN = "test-token-0123456789";
process.env.IMB_STATUS_MIN_INTERVAL_MS = "0"; // no throttle inside tests

import http from "node:http";

/* ------------------------------------------------------------------ */
/* Fake IMB Pay server — stands in for https://api.imbpay.in          */
/* ------------------------------------------------------------------ */

const orders = new Map(); // orderId -> { state, amount, utr }
let lastCreateForm = null;
let createMode = "ok"; // ok | refuse

const json = (res, body, status = 200) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
};

const fakeGateway = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    const form = Object.fromEntries(new URLSearchParams(body));

    if (req.url === "/v2/create-order") {
      lastCreateForm = form;
      if (createMode === "refuse") {
        // exactly what the live gateway answers when no merchant is connected
        return json(res, { status: false, message: "Merchant Not Connected ! try again later" });
      }
      if (!orders.has(form.order_id)) {
        orders.set(form.order_id, { state: "PENDING", amount: Number(form.amount), utr: null });
      }
      return json(res, {
        status: true,
        message: "Order Created Successfully",
        result: {
          orderId: form.order_id,
          payment_url: `https://fake-gateway.test/pay/${form.order_id}`,
          paytm_link: `paytmmp://pay?pa=fake@bank&am=${form.amount}`,
          phonepe_link: `phonepe://pay?pa=fake@bank&am=${form.amount}`,
          bhim_link: `upi://pay?pa=fake@bank&am=${form.amount}`,
          check_link: `https://fake-gateway.test/check/${form.order_id}`,
        },
      });
    }

    if (req.url === "/v2/check-order-status") {
      const order = orders.get(form.order_id);
      if (!order) return json(res, { status: "ERROR", message: "Order not found" });
      if (order.state === "COMPLETED") {
        return json(res, {
          status: "COMPLETED",
          message: "Transaction Successfully",
          result: {
            txnStatus: "COMPLETED", resultInfo: "Transaction Success",
            orderId: form.order_id, status: "SUCCESS",
            amount: order.amount, date: "2026-09-25 12:00:00", utr: order.utr,
            customer_mobile: "9999999999", payer_name: "Test Payer",
            payer_vpa: "payer@upi", payer_app: "Google Pay",
          },
        });
      }
      if (order.state === "FAILED") {
        return json(res, {
          status: "FAILED",
          message: "Transaction Failed",
          result: { txnStatus: "FAILED", orderId: form.order_id, status: "FAILED", amount: order.amount },
        });
      }
      return json(res, {
        status: "PENDING",
        message: "Transaction Pending",
        result: { txnStatus: "PENDING", orderId: form.order_id, status: "PENDING", amount: order.amount },
      });
    }

    return json(res, { status: "ERROR", message: "Unknown endpoint" }, 404);
  });
});

await new Promise((resolve) => fakeGateway.listen(0, "127.0.0.1", resolve));
process.env.IMB_API_URL = `http://127.0.0.1:${fakeGateway.address().port}`;

/* ---------------------------- the app ------------------------------- */

const { test, before, after } = await import("node:test");
const assert = (await import("node:assert/strict")).default;
const request = (await import("supertest")).default;

const { app } = await import("../src/app.js");
const { connectMongo, disconnectMongo } = await import("../src/db/connect.js");
const { connectRedis, redis, shutdownRedis } = await import("../src/db/redis.js");
const { otpStoreInit } = await import("../src/services/otp.service.js");
const { applyIndexes } = await import("../src/scripts/db.indexes.js");
const { seed } = await import("../src/scripts/seed.js");
const { reconcileWallet } = await import("../src/services/ledger.service.js");
const { walletView } = await import("../src/services/wallet.service.js");
const { verifyPendingGatewayDeposits } = await import("../src/services/deposit.service.js");
const { DepositRequest } = await import("../src/db/models/depositRequest.model.js");
const { LedgerEntry } = await import("../src/db/models/ledgerEntry.model.js");
const { Settings } = await import("../src/db/models/settings.model.js");

let adminToken;
let counter = 0;

async function loginPlayer(phone) {
  await request(app).post("/api/auth/send-otp").send({ phone });
  const code = await redis.get(`otp:code:${phone}`);
  assert.ok(code, "otp should exist in redis");
  const res = await request(app).post("/api/auth/verify-otp").send({ phone, otp: code });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return { token: res.body.accessToken, id: res.body.user.id, phone };
}

const auth = (t) => ({ Authorization: `Bearer ${t}` });

/** create a gateway order through the API and return the response body */
async function createGatewayDeposit(player, amountPaise) {
  const res = await request(app)
    .post("/api/payments/deposit/gateway")
    .set(auth(player.token))
    .send({ amountPaise });
  return res;
}

/** the gateway's webhook POST (form-encoded, `result` as a JSON string) */
async function webhook(body) {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    form.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  return request(app)
    .post("/api/webhooks/imb")
    .set("Content-Type", "application/x-www-form-urlencoded")
    .send(form.toString());
}

/** pretend the customer actually paid on the checkout page */
function markPaid(orderId, { amountRupees, utr, state = "COMPLETED" } = {}) {
  const order = orders.get(orderId) || {};
  orders.set(orderId, {
    ...order,
    state,
    amount: amountRupees ?? order.amount,
    utr: utr ?? `UTR${Date.now()}${Math.floor(Math.random() * 1000)}`,
  });
}

const { Types } = (await import("mongoose")).default;

/**
 * Age a deposit so the sweep picks it up. `createdAt` is immutable through
 * Mongoose, so this writes through the native driver.
 */
const backdate = (id, minutes) =>
  DepositRequest.collection.updateOne(
    { _id: new Types.ObjectId(String(id)) },
    { $set: { createdAt: new Date(Date.now() - minutes * 60_000) } }
  );

before(async () => {
  await connectMongo();
  await connectRedis();
  otpStoreInit(redis);
  await (await import("mongoose")).default.connection.dropDatabase();
  await applyIndexes(true);
  await seed();

  const res = await request(app).post("/api/admin/login")
    .send({ email: "admin@lpludo.test", password: "Admin@12345" });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  adminToken = res.body.accessToken;
});

after(async () => {
  await new Promise((resolve) => fakeGateway.close(resolve));
  await shutdownRedis();
  await disconnectMongo();
});

/* ------------------------------------------------------------------ */
/* deposit details                                                     */
/* ------------------------------------------------------------------ */

test("deposit details expose the gateway flag and the threshold", async () => {
  const player = await loginPlayer("9000000099");
  const res = await request(app).get("/api/payments/deposit/details").set(auth(player.token));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.gatewayEnabled, true);
  assert.equal(res.body.gatewayThresholdPaise, 500000); // ₹5000 default
  assert.ok(res.body.upiId, "manual UPI id present");
});

/* ------------------------------------------------------------------ */
/* gateway order creation                                             */
/* ------------------------------------------------------------------ */

test("creates a gateway order below the threshold with the right payload", async () => {
  const player = await loginPlayer("9000000101");
  const res = await createGatewayDeposit(player, 10000); // ₹100
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.method, "gateway");
  assert.equal(res.body.status, "pending");
  assert.equal(res.body.amountPaise, 10000);
  assert.match(res.body.paymentUrl, /^https:\/\/fake-gateway\.test\/pay\/LPL/);

  // what the gateway actually received
  assert.equal(lastCreateForm.user_token, "test-token-0123456789");
  assert.equal(lastCreateForm.amount, "100", "amount must be sent in RUPEES");
  assert.equal(lastCreateForm.order_id, `LPL${res.body.id}`);
  assert.equal(lastCreateForm.customer_mobile, player.phone);
  assert.ok(lastCreateForm.redirect_url.includes(`/wallet?deposit=${res.body.id}`));

  const row = await DepositRequest.findById(res.body.id).lean();
  assert.equal(row.method, "gateway");
  assert.equal(row.status, "pending");
  assert.equal(row.gateway.orderId, `LPL${res.body.id}`);
});

test("refuses paise amounts and a second pending deposit", async () => {
  const player = await loginPlayer("9000000102");
  const odd = await createGatewayDeposit(player, 10050); // ₹100.50
  assert.equal(odd.status, 400, JSON.stringify(odd.body));

  const first = await createGatewayDeposit(player, 20000);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const second = await createGatewayDeposit(player, 30000);
  assert.equal(second.status, 409, JSON.stringify(second.body));
});

/* ------------------------------------------------------------------ */
/* webhook: success, replay, spoofing                                 */
/* ------------------------------------------------------------------ */

test("webhook credits the wallet exactly once, even when replayed", async () => {
  const player = await loginPlayer("9000000103");
  const before = await walletView(player.id);

  const created = await createGatewayDeposit(player, 50000); // ₹500
  const orderId = created.body.orderId;
  markPaid(orderId, { amountRupees: 500, utr: "400000000001" });

  const first = await webhook({ status: "SUCCESS", order_id: orderId, message: "Transaction Successfully", result: { txnStatus: "COMPLETED", status: "SUCCESS", amount: 500, utr: "400000000001" } });
  assert.equal(first.status, 200);

  const after = await walletView(player.id);
  assert.equal(after.totalPaise - before.totalPaise, 50000, "wallet credited once");

  // replays (gateway retries) must be no-ops
  for (let i = 0; i < 3; i += 1) {
    const again = await webhook({ status: "SUCCESS", order_id: orderId, result: { txnStatus: "COMPLETED", status: "SUCCESS", amount: 500, utr: "400000000001" } });
    assert.equal(again.status, 200);
  }
  const settled = await walletView(player.id);
  assert.equal(settled.totalPaise, after.totalPaise, "no double credit on replay");

  const rows = await LedgerEntry.find({ idempotencyKey: `deposit:${created.body.id}` }).lean();
  assert.equal(rows.length, 1, "exactly one ledger row");

  const recon = await reconcileWallet(player.id);
  assert.equal(recon.drift, 0, "ledger sum matches wallet total");
  assert.equal(recon.heldDrift, 0);

  const row = await DepositRequest.findById(created.body.id).lean();
  assert.equal(row.status, "approved");
  assert.equal(row.utr, "400000000001");
  assert.ok(row.ledgerEntryId, "ledger pointer stored");
  assert.equal(row.gateway.verifiedSource, "webhook");
});

test("a spoofed webhook cannot credit: the gateway's own answer wins", async () => {
  const player = await loginPlayer("9000000104");
  const before = await walletView(player.id);
  const created = await createGatewayDeposit(player, 50000);
  const orderId = created.body.orderId;

  // gateway still says PENDING, but the POST claims SUCCESS
  const res = await webhook({ status: "SUCCESS", order_id: orderId, result: { txnStatus: "COMPLETED", status: "SUCCESS", amount: 500, utr: "999999999999" } });
  assert.equal(res.status, 200);

  const after = await walletView(player.id);
  assert.equal(after.totalPaise, before.totalPaise, "nothing credited from the payload alone");
  const row = await DepositRequest.findById(created.body.id).lean();
  assert.equal(row.status, "pending");
});

test("webhook for an unknown order is a safe no-op", async () => {
  const res = await webhook({ status: "SUCCESS", order_id: "LPL000000000000000000000000", result: { txnStatus: "COMPLETED", status: "SUCCESS", amount: 1 } });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

/* ------------------------------------------------------------------ */
/* polling path (no webhook at all — local dev / missed callback)     */
/* ------------------------------------------------------------------ */

test("polling GET /payments/deposit/:id credits a paid order without any webhook", async () => {
  const player = await loginPlayer("9000000105");
  const created = await createGatewayDeposit(player, 25000); // ₹250
  const orderId = created.body.orderId;
  markPaid(orderId, { amountRupees: 250, utr: "400000000250" });

  const res = await request(app).get(`/api/payments/deposit/${created.body.id}`).set(auth(player.token));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.status, "approved");
  assert.equal(res.body.utr, "400000000250");

  const recon = await reconcileWallet(player.id);
  assert.equal(recon.drift, 0);
});

test("amount mismatch stays pending for the admin instead of crediting", async () => {
  const player = await loginPlayer("9000000106");
  const before = await walletView(player.id);
  const created = await createGatewayDeposit(player, 30000); // ₹300 claimed
  markPaid(created.body.orderId, { amountRupees: 200, utr: "400000000200" }); // paid ₹200

  const res = await request(app).get(`/api/payments/deposit/${created.body.id}`).set(auth(player.token));
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "pending");
  assert.match(res.body.gatewayNote, /paid ₹200/i);

  const after = await walletView(player.id);
  assert.equal(after.totalPaise, before.totalPaise, "mismatched amount is never auto-credited");

  // and it is visible to the admin with the reason
  const list = await request(app).get("/api/admin/deposits?status=pending&method=gateway").set(auth(adminToken));
  assert.equal(list.status, 200);
  const row = list.body.items.find((d) => String(d.id) === String(created.body.id));
  assert.ok(row, "mismatch row listed for admins");
  assert.match(row.gateway.note, /paid ₹200/i);

  // the admin can still settle it manually
  const review = await request(app).post("/api/admin/deposits/review").set(auth(adminToken))
    .send({ id: created.body.id, action: "approve", note: "verified partial payment" });
  assert.equal(review.status, 200, JSON.stringify(review.body));
  const settled = await DepositRequest.findById(created.body.id).lean();
  assert.equal(settled.status, "approved");
});

/* ------------------------------------------------------------------ */
/* failures, cancellation, sweep                                      */
/* ------------------------------------------------------------------ */

test("a failed payment marks the row failed and frees the pending slot", async () => {
  const player = await loginPlayer("9000000107");
  const created = await createGatewayDeposit(player, 15000);
  markPaid(created.body.orderId, { state: "FAILED", amountRupees: 150 });

  const res = await request(app).get(`/api/payments/deposit/${created.body.id}`).set(auth(player.token));
  assert.equal(res.body.status, "failed");

  const again = await createGatewayDeposit(player, 20000);
  assert.equal(again.status, 201, "a new deposit is possible after a failure");
});

test("cancel closes an unpaid order, but a paid one is credited instead", async () => {
  const player = await loginPlayer("9000000108");
  const unpaid = await createGatewayDeposit(player, 12000);
  const cancelled = await request(app).post(`/api/payments/deposit/${unpaid.body.id}/cancel`).set(auth(player.token));
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  assert.equal(cancelled.body.status, "failed");

  const before = await walletView(player.id);
  const paid = await createGatewayDeposit(player, 18000);
  markPaid(paid.body.orderId, { amountRupees: 180, utr: "400000000180" });
  const second = await request(app).post(`/api/payments/deposit/${paid.body.id}/cancel`).set(auth(player.token));
  assert.equal(second.body.status, "approved", "cancelling a paid order credits it");

  const after = await walletView(player.id);
  assert.equal(after.totalPaise - before.totalPaise, 18000);
});

test("sweep credits a paid order the webhook never delivered", async () => {
  const player = await loginPlayer("9000000109");
  const paid = await createGatewayDeposit(player, 40000);
  markPaid(paid.body.orderId, { amountRupees: 400, utr: "400000000400" });
  await backdate(paid.body.id, 5);

  const before = await walletView(player.id);
  const stats = await verifyPendingGatewayDeposits();
  assert.ok(stats.checked >= 1, JSON.stringify(stats));

  const after = await walletView(player.id);
  assert.equal(after.totalPaise - before.totalPaise, 40000, "the paid order was credited by the sweep");

  const paidRow = await DepositRequest.findById(paid.body.id).lean();
  assert.equal(paidRow.status, "approved");
  assert.equal(paidRow.gateway.verifiedSource, "sweep");

  const recon = await reconcileWallet(player.id);
  assert.equal(recon.drift, 0);
});

test("sweep expires an unpaid order past the grace window", async () => {
  const player = await loginPlayer("9000000110");
  const stale = await createGatewayDeposit(player, 60000);
  await backdate(stale.body.id, 60);
  const before = await walletView(player.id);

  const stats = await verifyPendingGatewayDeposits();
  assert.ok(stats.expired >= 1, JSON.stringify(stats));

  const staleRow = await DepositRequest.findById(stale.body.id).lean();
  assert.equal(staleRow.status, "failed");
  assert.match(staleRow.rejectReason, /expired/i);

  const after = await walletView(player.id);
  assert.equal(after.totalPaise, before.totalPaise, "an unpaid order never credits");

  // the expired order no longer blocks new deposits
  const fresh = await createGatewayDeposit(player, 11000);
  assert.equal(fresh.status, 201, JSON.stringify(fresh.body));
});

/* ------------------------------------------------------------------ */
/* hybrid threshold rules                                             */
/* ------------------------------------------------------------------ */

test("threshold rules: gateway below ₹5000, manual at/above", async () => {
  const player = await loginPlayer("9000000111");

  // gateway refuses ₹5000 (the manual rail owns it)
  const gwAtThreshold = await createGatewayDeposit(player, 500000);
  assert.equal(gwAtThreshold.status, 400, JSON.stringify(gwAtThreshold.body));

  // manual refuses ₹4999 while the gateway is healthy
  const manualBelow = await request(app).post("/api/payments/deposit").set(auth(player.token))
    .send({ amountPaise: 499900, utr: "MANUAL12345" });
  assert.equal(manualBelow.status, 400, JSON.stringify(manualBelow.body));

  // manual accepts ₹5000 exactly
  const manualAt = await request(app).post("/api/payments/deposit").set(auth(player.token))
    .send({ amountPaise: 500000, utr: "MANUAL54321" });
  assert.equal(manualAt.status, 201, JSON.stringify(manualAt.body));

  const row = await DepositRequest.findById(manualAt.body.id).lean();
  assert.equal(row.method, "manual");
});

test("admin can change the threshold and it takes effect immediately", async () => {
  const res = await request(app).post("/api/admin/settings").set(auth(adminToken))
    .send({ depositGatewayMaxPaise: 100000 }); // ₹1000
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.depositGatewayMaxPaise, 100000);

  const player = await loginPlayer("9000000112");
  const above = await createGatewayDeposit(player, 200000); // ₹2000 now manual-only
  assert.equal(above.status, 400, JSON.stringify(above.body));

  const ok = await createGatewayDeposit(player, 90000); // ₹900 still gateway
  assert.equal(ok.status, 201, JSON.stringify(ok.body));

  // restore for other tests
  await request(app).post("/api/admin/settings").set(auth(adminToken)).send({ depositGatewayMaxPaise: 500000 });
});

/* ------------------------------------------------------------------ */
/* gateway outage: manual deposits must take over                     */
/* ------------------------------------------------------------------ */

test("a refusing gateway opens the breaker and the manual rail takes over", async () => {
  await redis.del("imb:gateway_down");
  createMode = "refuse";

  const player = await loginPlayer("9000000113");
  const attempt = await createGatewayDeposit(player, 50000);
  assert.equal(attempt.status, 502, JSON.stringify(attempt.body));
  assert.match(attempt.body.error.message, /Merchant Not Connected/i);

  // the deposit row is parked as failed — never left pending
  const parked = await DepositRequest.findOne({ userId: player.id }).sort({ createdAt: -1 }).lean();
  assert.equal(parked.status, "failed");
  assert.match(parked.gateway.createError, /Merchant Not Connected/i);

  // details now steers players to the manual UPI rail
  const details = await request(app).get("/api/payments/deposit/details").set(auth(player.token));
  assert.equal(details.body.gatewayEnabled, false);
  assert.equal(details.body.gatewayUnavailable, true);

  // …and the manual flow is allowed again for small amounts
  const manual = await request(app).post("/api/payments/deposit").set(auth(player.token))
    .send({ amountPaise: 50000, utr: "MANUAL99999" });
  assert.equal(manual.status, 201, JSON.stringify(manual.body));

  const blocked = await createGatewayDeposit(player, 50000);
  assert.equal(blocked.status, 409, JSON.stringify(blocked.body));
  assert.match(blocked.body.error.message, /temporarily unavailable/i);

  // recover
  createMode = "ok";
  await redis.del("imb:gateway_down");
});

/* ------------------------------------------------------------------ */
/* settings + admin visibility                                        */
/* ------------------------------------------------------------------ */

test("settings expose the gateway limit", async () => {
  const res = await request(app).get("/api/admin/settings").set(auth(adminToken));
  assert.equal(res.status, 200);
  assert.equal(res.body.depositGatewayMaxPaise, 500000);
});

test("admin deposit list marks the rail and its verification source", async () => {
  const res = await request(app).get("/api/admin/deposits?method=gateway").set(auth(adminToken));
  assert.equal(res.status, 200);
  assert.ok(res.body.items.length > 0);
  for (const item of res.body.items) {
    assert.equal(item.method, "gateway");
    assert.ok(item.gateway, "gateway trail is exposed to admins");
  }
  const approved = res.body.items.find((d) => d.status === "approved");
  assert.ok(approved?.gateway.verifiedSource, "verified rows carry their source");
});
