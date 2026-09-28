import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rupeesToPaise, paiseToRupees, formatPaise, sumPaise, splitPaiseEvenly,
  MoneyError,
} from "../src/money.js";
import {
  computePrize, settleSplit, isValidStake, computeReferralCommission,
  COMMISSION_BPS_SLAB_1, COMMISSION_BPS_SLAB_2, REFERRAL_COMMISSION_BPS,
} from "../src/prize.js";
import {
  TRANSITIONS, isTransitionAllowed, transition, isTerminal,
  IllegalTransitionError, SETTLEMENT_BY_STATE, CONTEST_STATES,
} from "../src/contestStates.js";

test("rupees -> paise is exact and integer", () => {
  assert.equal(rupeesToPaise(50), 5000);
  assert.equal(rupeesToPaise("50"), 5000);
  assert.equal(rupeesToPaise("50.5"), 5050);
  assert.equal(rupeesToPaise("0.1"), 10); // floats like 0.1 must not become 10.000000000000002
  assert.equal(rupeesToPaise(1.005), 101); // rounds half up, no float dust
});

test("paise -> rupees round-trips", () => {
  for (const r of [50, 100, 250, 12.5]) {
    assert.equal(paiseToRupees(rupeesToPaise(r)), r);
  }
});

test("formatPaise renders INR display strings (Indian lakh/crore grouping)", () => {
  assert.equal(formatPaise(5000), "₹50");
  assert.equal(formatPaise(5050), "₹50.50");
  assert.equal(formatPaise(123456789, { withSymbol: false }), "12,34,567.89"); // en-IN grouping
});

test("formatPaise renders signed ledger amounts (negatives never throw)", () => {
  assert.equal(formatPaise(-5000), "-₹50");
  assert.equal(formatPaise(-5050), "-₹50.50");
  assert.equal(formatPaise(-123456789, { withSymbol: false }), "-12,34,567.89");
  assert.equal(formatPaise(0), "₹0");
  assert.throws(() => formatPaise(-50.5), MoneyError); // still integers-only
});

test("rejects non-integer / negative money", () => {
  assert.throws(() => paiseToRupees(50.5), MoneyError);
  assert.throws(() => rupeesToPaise("abc"), MoneyError);
  assert.throws(() => rupeesToPaise(NaN), MoneyError);
  assert.throws(() => sumPaise([1, -2]), MoneyError);
});

test("splitPaiseEvenly never loses or invents paise", () => {
  for (const [total, parts] of [[10001, 3], [5000, 7], [999, 4]]) {
    const out = splitPaiseEvenly(total, parts);
    assert.equal(out.length, parts);
    assert.equal(out.reduce((a, b) => a + b, 0), total);
  }
});

test("prize maths: Adda Ludo slab 1 (10% of the stake up to ₹500)", () => {
  const b = computePrize(5000); // ₹50 entry
  assert.equal(b.totalPoolPaise, 10000); // ₹100 pool
  assert.equal(b.commissionPaise, 500); // 10% of the stake = ₹5
  assert.equal(b.prizePaise, 9500); // ₹95 to winner
  assert.equal(b.winAmountPaise, 9500);
  assert.equal(b.commissionBps, COMMISSION_BPS_SLAB_1);

  const mid = computePrize(10000); // ₹100 entry
  assert.equal(mid.commissionPaise, 1000);
  assert.equal(mid.prizePaise, 19000); // ₹190

  const edge = computePrize(50000); // ₹500 entry — still slab 1
  assert.equal(edge.commissionPaise, 5000);
  assert.equal(edge.prizePaise, 95000); // ₹950
});

test("prize maths: Adda Ludo slab 2 (5% of the stake above ₹500)", () => {
  const b = computePrize(55000); // ₹550 entry
  assert.equal(b.commissionPaise, 2750); // 5% of ₹550 = ₹27.50
  assert.equal(b.prizePaise, 107250); // ₹1072.50 → same as floor(pool − platformFee)
  assert.equal(b.commissionBps, COMMISSION_BPS_SLAB_2);

  const k = computePrize(100000); // ₹1,000 entry
  assert.equal(k.commissionPaise, 5000); // ₹50
  assert.equal(k.prizePaise, 195000); // ₹1,950

  const max = computePrize(10000000); // ₹1,00,000 entry
  assert.equal(max.commissionPaise, 500000); // ₹5,000
  assert.equal(max.prizePaise, 19500000); // ₹1,95,000
});

test("settle split sums exactly to the pool for every stake", () => {
  for (const stake of [5000, 10000, 25000, 50000, 55000, 100000, 10000000]) {
    const s = settleSplit(stake);
    assert.ok(s.checksum, `split checksum failed for stake ${stake}`);
  }
});

test("Adda Ludo stake rules: ₹50–₹1,00,000 in ₹50 steps", () => {
  assert.equal(isValidStake(5000), true); // ₹50
  assert.equal(isValidStake(5500), false); // not a multiple of ₹50
  assert.equal(isValidStake(4999), false); // below minimum
  assert.equal(isValidStake(2500), false);
  assert.equal(isValidStake(55000), true); // ₹550 — custom amount
  assert.equal(isValidStake(10000000), true); // ₹1,00,000 — maximum
  assert.equal(isValidStake(10000500), false); // above maximum
  assert.equal(isValidStake(5001), false); // not a multiple of ₹50
  assert.equal(isValidStake("5000"), false); // integers only
});

test("referral commission is 2% of the winner's stake", () => {
  assert.equal(REFERRAL_COMMISSION_BPS, 200);
  assert.equal(computeReferralCommission(5000), 100); // ₹50 -> ₹1
  assert.equal(computeReferralCommission(55000), 1100); // ₹550 -> ₹11
  assert.equal(computeReferralCommission(10000000), 200000); // ₹1,00,000 -> ₹2,000
});

test("only whitelisted state transitions are allowed", () => {
  assert.equal(isTransitionAllowed("open", "join_requested"), true);
  assert.equal(isTransitionAllowed("open", "approved"), false);
  assert.equal(isTransitionAllowed("approved", "open"), false);
  assert.equal(isTransitionAllowed("running", "approved"), false);
  assert.equal(isTransitionAllowed("result_submitted", "approved"), true);
});

test("transition() throws with from/to context on illegal moves", () => {
  assert.throws(() => transition("open", "approved"), IllegalTransitionError);
  const err = new IllegalTransitionError("open", "approved");
  assert.equal(err.from, "open");
  assert.equal(err.to, "approved");
});

test("terminal states have no outgoing edges", () => {
  for (const s of ["approved", "cancelled", "expired"]) {
    assert.ok(isTerminal(s));
    assert.deepEqual(TRANSITIONS[s], []);
    assert.equal(isTransitionAllowed(s, "open"), false);
  }
});

test("settlement direction follows terminal state", () => {
  assert.equal(SETTLEMENT_BY_STATE.approved, "payout_winner");
  assert.equal(SETTLEMENT_BY_STATE.cancelled, "refund_both");
  assert.equal(SETTLEMENT_BY_STATE.expired, "refund_creator");
  assert.ok(CONTEST_STATES.APPROVED);
});
