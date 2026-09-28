/**
 * THE single source of truth for battle economics.
 * The reference app duplicated prize maths in at least 3 places (contest
 * controller, wallet service, admin controller) with inconsistent results.
 *
 * Everything is integer paise. The rules are same-to-same as Adda Ludo's
 * battle.jsx: any amount from ₹50 to ₹1,00,000 in multiples of ₹50, and a
 * commission slab of 10% of the stake up to ₹500 / 5% of the stake above it
 * (5% / 2.5% per player).
 */

import { assertPaise } from "./money.js";

/** Stake limits — same-to-same as Adda Ludo (₹50 … ₹1,00,000 in ₹50 steps). */
export const MIN_STAKE_PAISE = 5000; // ₹50
export const MAX_STAKE_PAISE = 10000000; // ₹1,00,000
export const STAKE_STEP_PAISE = 5000; // ₹50

/** Commission slabs: basis points OF THE STAKE (1% = 100bp). */
export const COMMISSION_BPS_SLAB_1 = 1000; // 10% of the stake (stake ≤ ₹500)
export const COMMISSION_BPS_SLAB_2 = 500; // 5% of the stake  (stake > ₹500)
export const SLAB_2_ABOVE_PAISE = 50000; // ₹500

/** Lifetime referral commission: 2% of the winner's stake (Adda Ludo rule). */
export const REFERRAL_COMMISSION_BPS = 200; // 2%

/** Commission in basis points of the stake for this entry fee. */
export function commissionBpsFor(entryFeePaise) {
  assertPaise(entryFeePaise);
  return entryFeePaise <= SLAB_2_ABOVE_PAISE ? COMMISSION_BPS_SLAB_1 : COMMISSION_BPS_SLAB_2;
}

/**
 * Compute the full money breakdown for a 1v1 battle.
 *
 * @param {number} entryFeePaise what each player pays to enter
 * @returns {{
 *   entryFeePaise: number, prizePaise: number, commissionPaise: number,
 *   totalPoolPaise: number, winAmountPaise: number, commissionBps: number
 * }}
 * - totalPool  = 2 × entry (both players)
 * - commission = 10% of the stake (entry ≤ ₹500) or 5% of the stake above it
 * - prize      = pool − commission  (what the winner receives, credited as a single amount)
 *
 * The formula is exact integer maths, so the prize the client previews is
 * byte-for-byte the prize the server pays for every valid (multiple of ₹50) stake.
 */
export function computePrize(entryFeePaise) {
  assertPaise(entryFeePaise);
  const totalPoolPaise = entryFeePaise * 2;
  const commissionBps = commissionBpsFor(entryFeePaise);
  const commissionPaise = Math.floor((entryFeePaise * commissionBps) / 10000);
  const prizePaise = totalPoolPaise - commissionPaise;
  return {
    entryFeePaise,
    totalPoolPaise,
    commissionPaise,
    commissionBps,
    prizePaise,
    // explicit alias — "win amount" and "prize" must never diverge
    winAmountPaise: prizePaise,
  };
}

/**
 * What the winner and the house actually receive, as an exact split of the pool.
 * Sum is guaranteed === totalPool (no paise lost or invented).
 */
export function settleSplit(entryFeePaise) {
  const b = computePrize(entryFeePaise);
  return {
    winnerPaise: b.prizePaise,
    housePaise: b.commissionPaise,
    totalPoolPaise: b.totalPoolPaise,
    commissionBps: b.commissionBps,
    get checksum() {
      return b.prizePaise + b.commissionPaise === b.totalPoolPaise;
    },
  };
}

/** Adda Ludo amount rules: ₹50 min, ₹1,00,000 max, multiples of ₹50 only. */
export function isValidStake(entryFeePaise) {
  return (
    Number.isInteger(entryFeePaise) &&
    entryFeePaise >= MIN_STAKE_PAISE &&
    entryFeePaise <= MAX_STAKE_PAISE &&
    entryFeePaise % STAKE_STEP_PAISE === 0
  );
}

/** Lifetime referral commission (2% of the winner's stake), integer paise. */
export function computeReferralCommission(winnerStakePaise) {
  assertPaise(winnerStakePaise);
  return Math.floor((winnerStakePaise * REFERRAL_COMMISSION_BPS) / 10000);
}
