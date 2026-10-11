// env MUST be set before the app modules are imported (config/env.js parses on import)
process.env.NODE_ENV = "test";
process.env.MONGO_URI = "mongodb://localhost:27018/lpludo_test?replicaSet=rs0";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "test-access-secret-0123456789abcdef0123456789abcdef";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-0123456789abcdef0123456789abc";
process.env.ALLOW_DEV_OTP = "true";
process.env.ADMIN_PHONE = "9999000000";
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

/** minimal PNG (valid magic bytes) for upload tests */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

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
  const d = await request(app).post("/api/payments/deposit").set("Authorization", `Bearer ${token}`)
    .send({ amountPaise, utr, proofImageKey: `seed/deposits/${utr}.png` }); // manual deposit now requires a screenshot
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

  adminToken = (await request(app).post("/api/admin/login").send({ phone: "9999000000", password: "Admin@12345" })).body.accessToken;
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

  const d = await request(app).post("/api/payments/deposit").set("Authorization", `Bearer ${tokens.A}`).send({ amountPaise: 10000, utr: "UTRTEST123456", proofImageKey: "seed/deposits/dup.png" });
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
  assert.equal(joined.body.contest.status, "join_requested"); // join is a request; no money moves yet

  // nothing is locked until the creator accepts
  assert.equal((await walletOf(ids.B)).heldPaise, 0);
  assert.equal((await walletOf(ids.C)).heldPaise, 0);

  const accepted = await request(app).post(`/api/contests/${id}/accept`).set("Authorization", `Bearer ${tokens.B}`);
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal(accepted.body.contest.status, "running");
  // the match started -> BOTH stakes are now locked
  assert.equal((await walletOf(ids.B)).heldPaise, 5000);
  assert.equal((await walletOf(ids.C)).heldPaise, 5000);

  const room = await request(app).post(`/api/contests/${id}/room`).set("Authorization", `Bearer ${tokens.B}`).send({ roomCode: "12345678" });
  assert.equal(room.status, 200, JSON.stringify(room.body));
  assert.equal((await Contest.findById(id)).status, "room_submitted"); // reference: room submit advances the state

  // a room code must be exactly 8 digits (reference rule)
  const badRoom = await request(app).post(`/api/contests/${id}/room`).set("Authorization", `Bearer ${tokens.B}`).send({ roomCode: "ABC" });
  assert.equal(badRoom.status, 422, JSON.stringify(badRoom.body));

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

  // a player cannot report twice (reference rule)
  const dupe = await request(app).post(`/api/contests/${id}/result`).set("Authorization", `Bearer ${tokens.B}`).send({ outcome: "won", screenshotKeys: [`${ids.B}/battle/proof2.png`] });
  assert.equal(dupe.status, 409, JSON.stringify(dupe.body));

  const final = await request(app).post(`/api/contests/${id}/result`).set("Authorization", `Bearer ${tokens.C}`).send({ outcome: "lost" });
  assert.equal(final.body.contest.status, "approved");

  const afterB = (await request(app).get("/api/user/profile").set("Authorization", `Bearer ${tokens.B}`)).body.wallet.totalPaise;
  const afterC = (await request(app).get("/api/user/profile").set("Authorization", `Bearer ${tokens.C}`)).body.wallet.totalPaise;
  // reference economics: both stakes are consumed; the winner is paid the gross
  // prize (9500) into `winnings`, so the winner NETS prize - stake = 4500.
  assert.equal(afterB - beforeB, 4500);
  assert.equal(beforeC - afterC, 5000);
  // prize landed in the winnings bucket
  assert.equal((await walletOf(ids.B)).winningsPaise, 9500);

  // replaying the settle must be a no-op (idempotency)
  const { alreadySettled } = await decideContest({ contestId: id, winnerUserId: (joined.body.contest.players.find(p=>p.seat===1)).userId, settledBy: "admin" });
  assert.equal(alreadySettled, true);

  const recB = await reconcileWallet(ids.B);
  assert.equal(recB.drift, 0);
});

test("creating and cancelling an open battle moves no money (stake locks only on accept)", async () => {
  const before = await walletOf(ids.B);
  const c = await request(app).post("/api/contests").set("Authorization", `Bearer ${tokens.B}`).send({ stake: 5000 });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  assert.equal((await walletOf(ids.B)).heldPaise, 0); // creating holds nothing
  const cancelled = await request(app).post(`/api/contests/${c.body.contest.id}/cancel`).set("Authorization", `Bearer ${tokens.B}`);
  assert.equal(cancelled.status, 200);
  const after = await walletOf(ids.B);
  assert.equal(after.totalPaise, before.totalPaise);
  assert.equal(after.heldPaise, before.heldPaise);
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

test("expiry sweep expires a stale open battle (no stake was ever held)", async () => {
  const before = await walletOf(ids.B);
  // B already has an open ₹50 battle — a second one must use a different amount
  const c = await request(app).post("/api/contests").set("Authorization", `Bearer ${tokens.B}`).send({ stake: 10000 });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  await Contest.updateOne({ _id: c.body.contest.id }, { expiresAt: new Date(Date.now() - 1000) });
  const n = await expireStaleOpenContests();
  assert.equal(n >= 1, true);
  const fresh = await Contest.findById(c.body.contest.id);
  assert.equal(fresh.status, "expired");
  const after = await walletOf(ids.B);
  assert.equal(after.totalPaise, before.totalPaise);
  assert.equal(after.heldPaise, before.heldPaise);
});

test("Adda Ludo guards: duplicate amount, max 2 open, join auto-cancels other open battles", async () => {
  // B still holds one open ₹50 battle from the previous test
  const dup = await request(app).post("/api/contests").set("Authorization", `Bearer ${tokens.B}`).send({ stake: 5000 });
  assert.equal(dup.status, 409); // same amount twice is not allowed

  const second = await request(app).post("/api/contests").set("Authorization", `Bearer ${tokens.B}`).send({ stake: 10000 });
  assert.equal(second.status, 201, JSON.stringify(second.body));

  const third = await request(app).post("/api/contests").set("Authorization", `Bearer ${tokens.B}`).send({ stake: 15000 });
  assert.equal(third.status, 409); // maximum 2 searching battles

  // G joins B's ₹100 battle -> B's other open battle is auto-cancelled (no stake was held)
  const G = await loginPlayer("9999000007");
  await depositAndApprove(G.token, 50000, "UTRG000001");
  const before = await walletOf(ids.B);
  const joined = await request(app).post(`/api/contests/${second.body.contest.id}/join`).set("Authorization", `Bearer ${G.token}`);
  assert.equal(joined.status, 200, JSON.stringify(joined.body));

  const openLeft = await Contest.countDocuments({ "players.userId": ids.B, status: "open" });
  assert.equal(openLeft, 0);
  const after = await walletOf(ids.B);
  assert.equal(after.totalPaise, before.totalPaise); // the cancelled battle held no stake
  assert.equal(after.heldPaise, before.heldPaise);

  // while a battle is pending (join_requested), B cannot start another one (Adda rule)
  const blocked = await request(app).post("/api/contests").set("Authorization", `Bearer ${tokens.B}`).send({ stake: 5000 });
  assert.equal(blocked.status, 409);

  // clean up: cancel the pending battle so B is free for later tests
  const cleanup = await request(app).post(`/api/contests/${second.body.contest.id}/cancel`).set("Authorization", `Bearer ${tokens.B}`);
  assert.equal(cleanup.status, 200, JSON.stringify(cleanup.body));
});

test("referral: 2% of the referred winner's stake, then redeem to wallet", async () => {
  // A's code is applied when E signs up
  const aProfile = (await request(app).get("/api/user/profile").set("Authorization", `Bearer ${tokens.A}`)).body;
  assert.ok(aProfile.referralCode, "A should have a referral code");

  await request(app).post("/api/auth/send-otp").send({ phone: "9999000005" });
  const eOtp = await redis.get("otp:code:9999000005");
  const eRes = await request(app).post("/api/auth/verify-otp").send({ phone: "9999000005", otp: eOtp, referralCode: aProfile.referralCode });
  assert.equal(eRes.status, 200, JSON.stringify(eRes.body));
  const E = eRes.body.accessToken;
  const eId = eRes.body.user.id;

  await depositAndApprove(E, 1000000, "UTRE000001"); // ₹10,000 stake
  const F = await loginPlayer("9999000006");
  await depositAndApprove(F.token, 1000000, "UTRF000001");

  // E (the referred player) wins a ₹10,000 battle
  const created = await request(app).post("/api/contests").set("Authorization", `Bearer ${E}`).send({ stake: 1000000 });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const cid = created.body.contest.id;
  // slab 2: 5% of the stake -> the winner's prize is ₹19,500
  assert.equal(created.body.contest.prize, 1950000);

  const joined = await request(app).post(`/api/contests/${cid}/join`).set("Authorization", `Bearer ${F.token}`);
  assert.equal(joined.status, 200, JSON.stringify(joined.body));
  const accepted = await request(app).post(`/api/contests/${cid}/accept`).set("Authorization", `Bearer ${E}`);
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  await request(app).post(`/api/contests/${cid}/result`).set("Authorization", `Bearer ${E}`).send({ outcome: "won", screenshotKeys: [`${eId}/battle/proof.png`] });
  const settled = await request(app).post(`/api/contests/${cid}/result`).set("Authorization", `Bearer ${F.token}`).send({ outcome: "lost" });
  assert.equal(settled.body.contest.status, "approved");

  // A (the referrer) earned 2% of the ₹10,000 stake = ₹200 referral balance
  const referrals = (await request(app).get("/api/user/referrals").set("Authorization", `Bearer ${tokens.A}`)).body;
  assert.equal(referrals.referralPaise, 20000);
  assert.equal(referrals.totalEarnedPaise, 20000);
  assert.equal(referrals.totalReferred, 1);
  assert.equal(referrals.items[0].earnedPaise, 20000);

  // redeem limits: below ₹200 fails, above the balance fails, exactly ₹200 works
  const tooSmall = await request(app).post("/api/payments/referral/redeem").set("Authorization", `Bearer ${tokens.A}`).send({ amountPaise: 19900 });
  assert.equal(tooSmall.status, 422);
  const tooMuch = await request(app).post("/api/payments/referral/redeem").set("Authorization", `Bearer ${tokens.A}`).send({ amountPaise: 30000 });
  assert.equal(tooMuch.status, 409);

  const walletBefore = (await request(app).get("/api/wallet").set("Authorization", `Bearer ${tokens.A}`)).body;
  const redeem = await request(app).post("/api/payments/referral/redeem").set("Authorization", `Bearer ${tokens.A}`).send({ amountPaise: 20000 });
  assert.equal(redeem.status, 200, JSON.stringify(redeem.body));
  assert.equal(redeem.body.wallet.referralPaise, 0);
  assert.equal(redeem.body.wallet.totalPaise, walletBefore.totalPaise + 20000);

  const rec = await reconcileWallet(ids.A);
  assert.equal(rec.drift, 0);
  assert.equal(rec.referralDrift, 0);
});

test("withdrawal: winnings-only, one pending, kyc gate -> hold -> admin pay -> drift 0", async () => {
  const Cuser = (await import("../src/db/models/user.model.js")).User;
  const cDoc = await Cuser.findOne({ phone: "9999000003" });
  await depositAndApprove(tokens.C, 100000, "UTRC000002"); // ₹1000 to stake with

  // C must WIN to have winnings — only the winnings bucket is withdrawable
  const D = await loginPlayer("9999000010");
  await depositAndApprove(D.token, 50000, "UTRD000001");
  const created = await request(app).post("/api/contests").set("Authorization", `Bearer ${tokens.C}`).send({ stake: 50000 });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const cid = created.body.contest.id;
  assert.equal((await request(app).post(`/api/contests/${cid}/join`).set("Authorization", `Bearer ${D.token}`)).status, 200);
  assert.equal((await request(app).post(`/api/contests/${cid}/accept`).set("Authorization", `Bearer ${tokens.C}`)).status, 200);
  await request(app).post(`/api/contests/${cid}/result`).set("Authorization", `Bearer ${tokens.C}`).send({ outcome: "won", screenshotKeys: [`${ids.C}/battle/proof.png`] });
  const settled = await request(app).post(`/api/contests/${cid}/result`).set("Authorization", `Bearer ${D.token}`).send({ outcome: "lost" });
  assert.equal(settled.body.contest.status, "approved");
  // ₹500 stake: prize = 2×50000 − 5000 = 95000 into winnings
  assert.equal((await walletOf(cDoc._id)).winningsPaise, 95000);

  // KYC is still required
  const denied = await request(app).post("/api/payments/withdraw").set("Authorization", `Bearer ${tokens.C}`).send({ amountPaise: 20000, upiId: "demo@upi" });
  assert.equal(denied.status, 403);

  const kyc = await request(app).post("/api/user/kyc").set("Authorization", `Bearer ${tokens.C}`).send({
    holderName: "Demo C", dob: "1995-05-10", docType: "aadhar", docNumber: "123456789012",
    frontImageKey: `${cDoc._id}/kyc/front.png`, backImageKey: `${cDoc._id}/kyc/back.png`,
  });
  assert.equal(kyc.status, 200, JSON.stringify(kyc.body));
  const kycOk = await request(app).post("/api/admin/kyc/review").set("Authorization", `Bearer ${adminToken}`).send({ userId: ids.C, action: "approve" });
  assert.equal(kycOk.status, 200, JSON.stringify(kycOk.body));

  // can never withdraw more than the winnings bucket
  const tooMuch = await request(app).post("/api/payments/withdraw").set("Authorization", `Bearer ${tokens.C}`).send({ amountPaise: 120000, upiId: "demo@upi" });
  assert.equal(tooMuch.status, 403, JSON.stringify(tooMuch.body));

  const w = await request(app).post("/api/payments/withdraw").set("Authorization", `Bearer ${tokens.C}`).send({ amountPaise: 20000, upiId: "demo@upi" });
  assert.equal(w.status, 201, JSON.stringify(w.body));

  // one pending withdrawal at a time (reference rule)
  const second = await request(app).post("/api/payments/withdraw").set("Authorization", `Bearer ${tokens.C}`).send({ amountPaise: 20000, upiId: "demo@upi" });
  assert.equal(second.status, 409, JSON.stringify(second.body));

  const totalDuringHold = (await walletOf(cDoc._id)).totalPaise;
  const heldDuringHold = (await walletOf(cDoc._id)).heldPaise;
  assert.equal(heldDuringHold, 20000);

  const paid = await request(app).post("/api/admin/withdrawals/review").set("Authorization", `Bearer ${adminToken}`).send({ id: w.body.id, action: "approve", note: "UPIDEMO123" });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));

  const wallet = await walletOf(cDoc._id);
  assert.equal(wallet.totalPaise, totalDuringHold - 20000);
  assert.equal(wallet.heldPaise, 0);
  assert.equal(wallet.totals.withdrawnPaise, 20000);
  const rec = await reconcileWallet(cDoc._id);
  assert.equal(rec.drift, 0);
  assert.equal(rec.heldDrift, 0);
});

test("create + join lock nothing; the creator's accept locks both stakes", async () => {
  const beforeB = await walletOf(ids.B);
  const beforeC = await walletOf(ids.C);

  const created = await request(app).post("/api/contests").set("Authorization", `Bearer ${tokens.B}`).send({ stake: 5000 });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const cid = created.body.contest.id;
  assert.equal(created.body.contest.status, "open");
  assert.equal((await walletOf(ids.B)).heldPaise, beforeB.heldPaise); // create holds nothing

  const joined = await request(app).post(`/api/contests/${cid}/join`).set("Authorization", `Bearer ${tokens.C}`);
  assert.equal(joined.status, 200, JSON.stringify(joined.body));
  assert.equal(joined.body.contest.status, "join_requested");
  assert.equal((await walletOf(ids.B)).heldPaise, beforeB.heldPaise); // join holds nothing either
  assert.equal((await walletOf(ids.C)).heldPaise, beforeC.heldPaise);

  // only the creator may start it
  const notCreator = await request(app).post(`/api/contests/${cid}/accept`).set("Authorization", `Bearer ${tokens.C}`);
  assert.equal(notCreator.status, 403);

  const accepted = await request(app).post(`/api/contests/${cid}/accept`).set("Authorization", `Bearer ${tokens.B}`);
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal(accepted.body.contest.status, "running");
  assert.equal((await walletOf(ids.B)).heldPaise, beforeB.heldPaise + 5000); // BOTH stakes locked
  assert.equal((await walletOf(ids.C)).heldPaise, beforeC.heldPaise + 5000);

  // settle to leave B/C clean and prove the locked stakes release correctly
  await request(app).post(`/api/contests/${cid}/result`).set("Authorization", `Bearer ${tokens.B}`).send({ outcome: "won", screenshotKeys: [`${ids.B}/battle/proof.png`] });
  const done = await request(app).post(`/api/contests/${cid}/result`).set("Authorization", `Bearer ${tokens.C}`).send({ outcome: "lost" });
  assert.equal(done.body.contest.status, "approved");
  const recB = await reconcileWallet(ids.B);
  assert.equal(recB.drift, 0);
  assert.equal(recB.heldDrift, 0);
});

test("a join request the creator ignores times out back to open", async () => {
  const created = await request(app).post("/api/contests").set("Authorization", `Bearer ${tokens.B}`).send({ stake: 5000 });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const cid = created.body.contest.id;
  const joined = await request(app).post(`/api/contests/${cid}/join`).set("Authorization", `Bearer ${tokens.C}`);
  assert.equal(joined.body.contest.status, "join_requested");

  await Contest.updateOne({ _id: cid }, { expiresAt: new Date(Date.now() - 1000) });
  await expireStaleOpenContests();

  const fresh = await Contest.findById(cid);
  assert.equal(fresh.status, "open"); // back to the creator, opponent released
  assert.equal(fresh.players.length, 1);
  assert.equal(fresh.players[0].seat, 1);

  // clean up
  await request(app).post(`/api/contests/${cid}/cancel`).set("Authorization", `Bearer ${tokens.B}`);
});

test("a creator who spent their balance cannot be accepted", async () => {
  const Z = await loginPlayer("9999000008");
  await depositAndApprove(Z.token, 10000, "UTRZ000001"); // exactly ₹100

  const created = await request(app).post("/api/contests").set("Authorization", `Bearer ${Z.token}`).send({ stake: 10000 });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const cid = created.body.contest.id;

  const W = await loginPlayer("9999000009");
  await depositAndApprove(W.token, 10000, "UTRW000001");
  const joined = await request(app).post(`/api/contests/${cid}/join`).set("Authorization", `Bearer ${W.token}`);
  assert.equal(joined.status, 200, JSON.stringify(joined.body));

  // the creator drains their balance before accepting (admin ₹100 penalty)
  const drained = await request(app).post("/api/admin/penalty").set("Authorization", `Bearer ${adminToken}`)
    .send({ userId: Z.id, amountPaise: 10000, note: "test drain" });
  assert.equal(drained.status, 200, JSON.stringify(drained.body));

  const accepted = await request(app).post(`/api/contests/${cid}/accept`).set("Authorization", `Bearer ${Z.token}`);
  assert.equal(accepted.status, 403, JSON.stringify(accepted.body));

  const fresh = await Contest.findById(cid);
  assert.equal(fresh.status, "join_requested"); // unchanged — nothing was locked
  assert.equal(fresh.entryLocked, false);
});

test("manual deposit requires a proof screenshot and uses the reference limits", async () => {
  const noProof = await request(app).post("/api/payments/deposit").set("Authorization", `Bearer ${tokens.B}`)
    .send({ amountPaise: 20000, utr: "UTRNOPROOF1" });
  assert.equal(noProof.status, 422, JSON.stringify(noProof.body));

  const tooSmall = await request(app).post("/api/payments/deposit").set("Authorization", `Bearer ${tokens.B}`)
    .send({ amountPaise: 5000, utr: "UTRTOOSMALL1", proofImageKey: `${ids.B}/deposits/p.png` });
  assert.equal(tooSmall.status, 422, JSON.stringify(tooSmall.body));

  const ok = await request(app).post("/api/payments/deposit").set("Authorization", `Bearer ${tokens.B}`)
    .send({ amountPaise: 20000, utr: "UTRWITHPROOF1", proofImageKey: `${ids.B}/deposits/p.png` });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
});

test("bonus is spent before balance; prizes land in the winnings bucket", async () => {
  const U = await loginPlayer("9999000011");
  const V = await loginPlayer("9999000012");
  await depositAndApprove(V.token, 10000, "UTRV000001");

  const bonus = await request(app).post("/api/admin/bonus").set("Authorization", `Bearer ${adminToken}`)
    .send({ userId: U.id, amountPaise: 10000, note: "test bonus" });
  assert.equal(bonus.status, 200, JSON.stringify(bonus.body));
  const w0 = await walletOf(U.id);
  assert.equal(w0.bonusPaise, 10000);
  assert.equal(w0.totalPaise, 10000);

  const created = await request(app).post("/api/contests").set("Authorization", `Bearer ${U.token}`).send({ stake: 5000 });
  const cid = created.body.contest.id;
  await request(app).post(`/api/contests/${cid}/join`).set("Authorization", `Bearer ${V.token}`);
  await request(app).post(`/api/contests/${cid}/accept`).set("Authorization", `Bearer ${U.token}`);

  // U had NO balance — the stake could only come from the bonus bucket
  const w1 = await walletOf(U.id);
  assert.equal(w1.bonusPaise, 5000);
  assert.equal(w1.heldPaise, 5000);

  await request(app).post(`/api/contests/${cid}/result`).set("Authorization", `Bearer ${U.token}`).send({ outcome: "won", screenshotKeys: [`${U.id}/battle/proof.png`] });
  await request(app).post(`/api/contests/${cid}/result`).set("Authorization", `Bearer ${V.token}`).send({ outcome: "lost" });
  const w2 = await walletOf(U.id);
  assert.equal(w2.winningsPaise, 9500); // prize → winnings
  assert.equal(w2.heldPaise, 0);
});

test("mutual cancel refunds both players immediately", async () => {
  const P = await loginPlayer("9999000013");
  const Q = await loginPlayer("9999000014");
  await depositAndApprove(P.token, 10000, "UTRP000001");
  await depositAndApprove(Q.token, 10000, "UTRQ000001");
  const p0 = await walletOf(P.id);
  const q0 = await walletOf(Q.id);

  const created = await request(app).post("/api/contests").set("Authorization", `Bearer ${P.token}`).send({ stake: 5000 });
  const cid = created.body.contest.id;
  await request(app).post(`/api/contests/${cid}/join`).set("Authorization", `Bearer ${Q.token}`);
  await request(app).post(`/api/contests/${cid}/accept`).set("Authorization", `Bearer ${P.token}`);

  const c1 = await request(app).post(`/api/contests/${cid}/result`).set("Authorization", `Bearer ${P.token}`).send({ outcome: "cancel" });
  assert.equal(c1.body.contest.status, "cancel_requested");
  const c2 = await request(app).post(`/api/contests/${cid}/result`).set("Authorization", `Bearer ${Q.token}`).send({ outcome: "cancel" });
  assert.equal(c2.body.contest.status, "cancelled"); // both cancelled -> refund now

  assert.equal((await walletOf(P.id)).totalPaise, p0.totalPaise);
  assert.equal((await walletOf(Q.id)).totalPaise, q0.totalPaise);
  assert.equal((await walletOf(P.id)).heldPaise, 0);
});

test("creator can decline a join request; the opponent can withdraw", async () => {
  const P = await loginPlayer("9999000015");
  const Q = await loginPlayer("9999000016");
  await depositAndApprove(P.token, 10000, "UTRP000002");
  await depositAndApprove(Q.token, 10000, "UTRQ000002");
  const created = await request(app).post("/api/contests").set("Authorization", `Bearer ${P.token}`).send({ stake: 5000 });
  const cid = created.body.contest.id;

  // opponent withdraws -> back to open with one player
  await request(app).post(`/api/contests/${cid}/join`).set("Authorization", `Bearer ${Q.token}`);
  const wd = await request(app).post(`/api/contests/${cid}/cancel`).set("Authorization", `Bearer ${Q.token}`);
  assert.equal(wd.body.contest.status, "open");
  assert.equal(wd.body.contest.players.length, 1);

  // creator declines -> back to open with one player
  await request(app).post(`/api/contests/${cid}/join`).set("Authorization", `Bearer ${Q.token}`);
  const rej = await request(app).post(`/api/contests/${cid}/reject`).set("Authorization", `Bearer ${P.token}`);
  assert.equal(rej.body.contest.status, "open");
  assert.equal(rej.body.contest.players.length, 1);

  await request(app).post(`/api/contests/${cid}/cancel`).set("Authorization", `Bearer ${P.token}`); // cleanup
});

test("user stats and referral-history endpoints respond", async () => {
  const stats = await request(app).get("/api/user/stats").set("Authorization", `Bearer ${tokens.A}`);
  assert.equal(stats.status, 200, JSON.stringify(stats.body));
  assert.equal(typeof stats.body.totalContests, "number");
  assert.equal(typeof stats.body.wonContests, "number");
  assert.equal(typeof stats.body.totalEarnings, "number");

  const rh = await request(app).get("/api/user/referral-history").set("Authorization", `Bearer ${tokens.A}`);
  assert.equal(rh.status, 200);
  assert.ok(Array.isArray(rh.body.items));
});

test("an unknown referral code is rejected at signup", async () => {
  await request(app).post("/api/auth/send-otp").send({ phone: "9999000017" });
  const code = await redis.get("otp:code:9999000017");
  const res = await request(app).post("/api/auth/verify-otp").send({ phone: "9999000017", otp: code, referralCode: "NOPE123" });
  assert.equal(res.status, 400, JSON.stringify(res.body));
});

test("admin dummy battle shows in the lobby and is removed when joined", async () => {
  const mk = await request(app).post("/api/admin/dummy-contests").set("Authorization", `Bearer ${adminToken}`).send({ stake: 5000, name: "DUMMY1" });
  assert.equal(mk.status, 201, JSON.stringify(mk.body));

  const open = await request(app).get("/api/contests/open").set("Authorization", `Bearer ${tokens.A}`);
  const found = (open.body.items || []).find((c) => String(c.id) === String(mk.body.id));
  assert.ok(found, "dummy should appear in the open list");
  assert.equal(found.players[0].name, "DUMMY1");

  const join = await request(app).post(`/api/contests/${mk.body.id}/join`).set("Authorization", `Bearer ${tokens.A}`);
  assert.equal(join.status, 409, JSON.stringify(join.body));
  assert.equal(await Contest.countDocuments({ _id: mk.body.id }), 0);
});

test("client tracking: add, list, report", async () => {
  const add = await request(app).post("/api/admin/tracked-accounts").set("Authorization", `Bearer ${adminToken}`).send({ phone: "9999000002", note: "watch" });
  assert.equal(add.status, 201, JSON.stringify(add.body));

  const list = await request(app).get("/api/admin/tracked-accounts").set("Authorization", `Bearer ${adminToken}`);
  assert.equal(list.status, 200);
  assert.ok(list.body.items.some((t) => t.phone === "9999000002"));

  const rep = await request(app).get("/api/admin/tracked-accounts/report").set("Authorization", `Bearer ${adminToken}`);
  assert.equal(rep.status, 200);
  const row = rep.body.items.find((t) => t.phone === "9999000002");
  assert.equal(row.registered, true);
});

test("maintenance mode blocks player endpoints but not admin", async () => {
  const on = await request(app).post("/api/admin/settings").set("Authorization", `Bearer ${adminToken}`).send({ maintenanceMode: true });
  assert.equal(on.status, 200, JSON.stringify(on.body));

  const blocked = await request(app).get("/api/contests/open").set("Authorization", `Bearer ${tokens.A}`);
  assert.equal(blocked.status, 503, JSON.stringify(blocked.body));

  const adminOk = await request(app).get("/api/admin/settings").set("Authorization", `Bearer ${adminToken}`);
  assert.equal(adminOk.status, 200);

  const off = await request(app).post("/api/admin/settings").set("Authorization", `Bearer ${adminToken}`).send({ maintenanceMode: false });
  assert.equal(off.status, 200);
});

test("upload: deposit proofs are accepted and admins can read them", async () => {
  const up = await request(app).post("/api/uploads?kind=deposit").set("Authorization", `Bearer ${tokens.B}`)
    .attach("file", PNG, { filename: "proof.png", contentType: "image/png" });
  assert.equal(up.status, 201, JSON.stringify(up.body));
  const key = up.body.key;
  assert.ok(key.startsWith(`${ids.B}/deposit/`), key);

  // owner
  assert.equal((await request(app).get(`/api/files/${key}`).set("Authorization", `Bearer ${tokens.B}`)).status, 200);
  // admin (battle/deposit/KYC proofs are visible to admins)
  assert.equal((await request(app).get(`/api/files/${key}`).set("Authorization", `Bearer ${adminToken}`)).status, 200);
  // another player is refused
  assert.equal((await request(app).get(`/api/files/${key}`).set("Authorization", `Bearer ${tokens.C}`)).status, 403);
});

test("a new login signs the previous device out (one active session)", async () => {
  const phone = "9999000018";
  const first = await loginPlayer(phone);
  assert.equal((await request(app).get("/api/wallet").set("Authorization", `Bearer ${first.token}`)).status, 200);

  await redis.del(`otp:last:${phone}`); // bypass the 60s resend throttle for the test
  const second = await loginPlayer(phone);

  // the first device's token is now revoked
  assert.equal((await request(app).get("/api/wallet").set("Authorization", `Bearer ${first.token}`)).status, 401);
  // the new session works
  assert.equal((await request(app).get("/api/wallet").set("Authorization", `Bearer ${second.token}`)).status, 200);
});
