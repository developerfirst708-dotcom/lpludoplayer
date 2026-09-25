import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rupeesToPaise, paiseToRupees, formatPaise, sumPaise, splitPaiseEvenly,
  MoneyError,
} from "../src/money.js";
import { computePrize, settleSplit, isValidStake, COMMISSION_BPS } from "../src/prize.js";
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

test("prize maths: pool, 5% commission, winner amount", () => {
  const b = computePrize(5000); // ₹50 entry
  assert.equal(b.totalPoolPaise, 10000);      // ₹100 pool
  assert.equal(b.commissionPaise, 500);       // ₹5 (5%)
  assert.equal(b.prizePaise, 9500);           // ₹95 to winner
  assert.equal(b.winAmountPaise, 9500);
});

test("settle split sums exactly to the pool for every stake", () => {
  for (const stake of [5000, 10000, 25000, 50000]) {
    const s = settleSplit(stake);
    assert.ok(s.checksum, `split checksum failed for stake ${stake}`);
  }
});

test("commission basis points are respected", () => {
  assert.equal(COMMISSION_BPS, 500);
  const b = computePrize(50000);
  assert.equal(b.commissionPaise, Math.floor(100000 * 0.05));
});

test("stake whitelist", () => {
  assert.equal(isValidStake(5000), true);
  assert.equal(isValidStake(5001), false);
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
