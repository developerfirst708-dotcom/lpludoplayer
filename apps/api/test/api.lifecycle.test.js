// env MUST be set before the app modules are imported (config/env.js parses on import)
process.env.NODE_ENV = "test";
process.env.MONGO_URI = "mongodb://localhost:27018/lpludo_test?replicaSet=rs0";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "test-access-secret-0123456789abcdef0123456789abcdef";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-0123456789abcdef0123456789abc";
process.env.ALLOW_DEV_OTP = "true";
process.env.ADMIN_EMAIL = "admin@lpludo.test";
process.env.ADMIN_PASSWORD = "Admin@12345";
process.env.LOCAL_STORAGE_DIR = ".local-storage-test";

const { test, before, after } = await import("node:test");
const assert = (await import("node:assert/strict")).default;
const request = (await import("supertest")).default;

const { app } = await import("../src/app.js");
const { connectMongo, disconnectMongo, withTransaction } = await import("../src/db/connect.js");
const { connectRedis, redis, shutdownRedis } = await import("../src/db/redis.js");
const { otpStoreInit } = await import("../src/services/otp.service.js");
const { applyIndexes } = await import("../src/scripts/db.indexes.js");
const { seed } = await import("../src/scripts/seed.js");
const { reconcileWallet } = await import("../src/services/ledger.service.js");
const { expireStaleOpenContests } = await import("../src/services/contest.service.js");
const { decideContest } = await import("../src/services/contest.service.js");
const { Contest } = await import("../src/db/models/contest.model.js");
const { Wallet } = await import("../src/db/models/wallet.model.js");

let adminToken;
const tokens = {};
const ids = {};

/**
 * Players no longer choose a name at signup — the API assigns a unique
 * 5-letter handle (see auth.service.js). The `name` field is dropped here.
 */
async function loginPlayer(phone) {
  await request(app).post("/api/auth/send-otp").send({ phone });
  const code = await redis.get(`otp:code:${phone}`);
  assert.ok(code, "otp should exist in redis");
  const res = await request(app).post("/api/auth/verify-otp").send({ phone, otp: code });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return { token: res.body.accessToken, id: res.body.user.id };
}

async function depositAndApprove(token, amountPaise, utr) {
  const d = await request(app).post("/api/payments/deposit").set("Authorization", `Bearer ${token}`).send({ amountPaise, utr });
  assert.equal(d.status, 201, JSON.stringify(d.body));
  const r = await request(app).post("/api/admin/deposits/review").set("Authorization", `Bearer ${adminToken}`).send({ id: d.body.id, action: "approve" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
}

async function walletOf(userId) {
  return Wallet.findOne({ userId }).lean();
}

before(async () => {
  await connectMongo();
  await connectRedis();
  otpStoreInit(redis);
  await redis.flushdb(); // clear otp / rate-limit counters from previous runs
  const mongoose = (await import("mongoose")).default;
  await mongoose.connection.dropDatabase();
  await applyIndexes(true);
  await seed();
  const { getSettings } = await import("../src/db/models/settings.model.js");
  const s = await getSettings();
  if (!s.depositUpiId) { s.depositUpiId = "lpludo@upi"; await s.save(); }

  adminToken = (await request(app).post("/api/admin/login").send({ email: "admin@lpludo.test", password: "Admin@12345" })).body.accessToken;
  assert.ok(adminToken, "admin login failed");
  for (const [key, phone] of [["A", "9999000001"], ["B", "9999000002"], ["C", "9999000003"]]) {
    const r = await loginPlayer(phone);
    tokens[key] = r.token;
    ids[key] = r.id;
  }
});

after(async () => {
  await shutdownRedis();
  await disconnectMongo();
});

test("health reports mongo + redis", async () => {
  const res = await request(app).get("/health");
  assert.equal(res.status, 200);
  assert.equal(res.body.mongo, true);
  assert.equal(res.body.redis, true);
});

test("deposit approve credits wallet; replay is rejected (C4/C8)", async () => {
  const A = (await request(app).get("/api/user/profile").set("Authorization", `Bearer ${tokens.A}`)).body;
  await depositAndApprove(tokens.A, 50000, "UTRTEST123456");
  const A2 = (await request(app).get("/api/user/profile").set("Authorization", `Bearer ${tokens.A}`)).body;
  assert.equal(A2.wallet.totalPaise, A.wallet.totalPaise + 50000);

  const d = await request(app).post("/api/payments/deposit").set("Authorization", `Bearer ${tokens.A}`).send({ amountPaise: 10000, utr: "UTRTEST123456" });
  assert.equal(d.status, 409); // duplicate UTR
});

test("battle lifecycle: create -> join -> results -> auto-settle exactly once", async () => {
  await depositAndApprove(tokens.B, 50000, "UTRB000001");
  await depositAndApprove(tokens.C, 50000, "UTRC000001");
  const beforeB = (await request(app).get("/api/user/profile").set("Authorization", `Bearer ${tokens.B}`)).body.wallet.totalPaise;
  const beforeC = (await request(app).get("/api/user/profile").set("Authorization", `Bearer ${tokens.C}`)).body.wallet.totalPaise;

  const created = await request(app).post("/api/contests").set("Authorization", `Bearer ${tokens.B}`).send({ stake: 5000 });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.contest.id;

  const joined = await request(app).post(`/api/contests/${id}/join`).set("Authorization", `Bearer ${tokens.C}`);
  assert.equal(joined.status, 200, JSON.stringify(joined.body));
  assert.equal(joined.body.contest.status, "running");

  await request(app).post(`/api/contests/${id}/room`).set("Authorization", `Bearer ${tokens.B}`).send({ roomCode: "ROOM99" });

  // a win claim MUST carry a proof screenshot (adda-ludo rule)
  const noProof = await request(app).post(`/api/contests/${id}/result`).set("Authorization", `Bearer ${tokens.B}`).send({ outcome: "won" });
  assert.equal(noProof.status, 400, JSON.stringify(noProof.body));

  // and the key must belong to the caller's own uploads
  const stolenProof = await request(app).post(`/api/contests/${id}/result`).set("Authorization", `Bearer ${tokens.B}`)
    .send({ outcome: "won", screenshotKeys: [`${ids.C}/battle/other.png`] });
  assert.equal(stolenProof.status, 400, JSON.stringify(stolenProof.body));

  const withProof = await request(app).post(`/api/contests/${id}/result`).set("Authorization", `Bearer ${tokens.B}`)
    .send({ outcome: "won", screenshotKeys: [`${ids.B}/battle/proof.png`] });
  assert.equal(withProof.status, 200, JSON.stringify(withProof.body));
  assert.equal(withProof.body.contest.resultReports?.[0]?.screenshots?.[0], `${ids.B}/battle/proof.png`);

  const final = await request(app).post(`/api/contests/${id}/result`).set("Authorization", `Bearer ${tokens.C}`).send({ outcome: "lost" });
  assert.equal(final.body.contest.status, "approved");

  const afterB = (await request(app).get("/api/user/profile").set("Authorization", `Bearer ${tokens.B}`)).body.wallet.totalPaise;
  const afterC = (await request(app).get("/api/user/profile").set("Authorization", `Bearer ${tokens.C}`)).body.wallet.totalPaise;
  // winner: stake back + 9500 prize (5% commission on the 10k pool)
  assert.equal(afterB - beforeB, 9500);
  assert.equal(beforeC - afterC, 5000);

  // replaying the settle must be a no-op (idempotency)
  const { alreadySettled } = await decideContest({ contestId: id, winnerUserId: (joined.body.contest.players.find(p=>p.seat===1)).userId, settledBy: "admin" });
  assert.equal(alreadySettled, true);

  const recB = await reconcileWallet(ids.B);
  assert.equal(recB.drift, 0);
});

test("cancel refunds the creator's hold", async () => {
  const before = (await request(app).get("/api/user/profile").set("Authorization", `Bearer ${tokens.B}`)).body.wallet.totalPaise;
  const c = await request(app).post("/api/contests").set("Authorization", `Bearer ${tokens.B}`).send({ stake: 5000 });
  const cancelled = await request(app).post(`/api/contests/${c.body.contest.id}/cancel`).set("Authorization", `Bearer ${tokens.B}`);
  assert.equal(cancelled.status, 200);
  const after = (await request(app).get("/api/user/profile").set("Authorization", `Bearer ${tokens.B}`)).body.wallet.totalPaise;
  assert.equal(after, before);
});

test("insufficient balance cannot join and leaves the battle intact", async () => {
  const D = (await loginPlayer("9999000004")).token; // no money
  const c = await request(app).post("/api/contests").set("Authorization", `Bearer ${tokens.B}`).send({ stake: 5000 });
  const res = await request(app).post(`/api/contests/${c.body.contest.id}/join`).set("Authorization", `Bearer ${D}`);
  assert.equal(res.status, 403);
  const fresh = await Contest.findById(c.body.contest.id);
  assert.equal(fresh.status, "open");
  assert.equal(fresh.players.length, 1);
});

test("expiry sweep refunds the creator of a stale open battle", async () => {
  const before = (await request(app).get("/api/user/profile").set("Authorization", `Bearer ${tokens.B}`)).body.wallet.totalPaise;
  const c = await request(app).post("/api/contests").set("Authorization", `Bearer ${tokens.B}`).send({ stake: 5000 });
  await Contest.updateOne({ _id: c.body.contest.id }, { expiresAt: new Date(Date.now() - 1000) });
  const n = await expireStaleOpenContests();
  assert.equal(n >= 1, true);
  const after = (await request(app).get("/api/user/profile").set("Authorization", `Bearer ${tokens.B}`)).body.wallet.totalPaise;
  assert.equal(after, before);
});

test("withdrawal: kyc gate -> hold -> admin pay -> ledger drift 0", async () => {
  const Cuser = (await import("../src/db/models/user.model.js")).User;
  const cDoc = await Cuser.findOne({ phone: "9999000003" });
  await depositAndApprove(tokens.C, 100000, "UTRC000002"); // ₹1000 extra so the ₹1000 minimum is reachable

  const denied = await request(app).post("/api/payments/withdraw").set("Authorization", `Bearer ${tokens.C}`).send({ amountPaise: 100000, upiId: "demo@upi" });
  assert.equal(denied.status, 403); // kyc required

  const kyc = await request(app).post("/api/user/kyc").set("Authorization", `Bearer ${tokens.C}`).send({
    holderName: "Demo C", upiId: "demo@upi",
    frontImageKey: `${cDoc._id}/kyc/front.png`, backImageKey: `${cDoc._id}/kyc/back.png`,
  });
  assert.equal(kyc.status, 200, JSON.stringify(kyc.body));

  // admin verifies the KYC before any payout can happen
  const kycOk = await request(app).post("/api/admin/kyc/review").set("Authorization", `Bearer ${adminToken}`).send({
    userId: ids.C, action: "approve",
  });
  assert.equal(kycOk.status, 200, JSON.stringify(kycOk.body));

  const w = await request(app).post("/api/payments/withdraw").set("Authorization", `Bearer ${tokens.C}`).send({ amountPaise: 100000, upiId: "demo@upi" });
  assert.equal(w.status, 201, JSON.stringify(w.body));

  const totalDuringHold = (await walletOf(cDoc._id)).totalPaise;
  const heldDuringHold = (await walletOf(cDoc._id)).heldPaise;
  assert.equal(heldDuringHold, 100000);

  const paid = await request(app).post("/api/admin/withdrawals/review").set("Authorization", `Bearer ${adminToken}`).send({ id: w.body.id, action: "approve", note: "UPIDEMO123" });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));

  const wallet = await walletOf(cDoc._id);
  assert.equal(wallet.totalPaise, totalDuringHold - 100000);
  assert.equal(wallet.heldPaise, 0);
  assert.equal(wallet.totals.withdrawnPaise, 100000);
  const rec = await reconcileWallet(cDoc._id);
  assert.equal(rec.drift, 0);
  assert.equal(rec.heldDrift, 0);
});
