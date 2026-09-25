/**
 * THE single source of truth for battle economics.
 * The reference app duplicated prize maths in at least 3 places (contest
 * controller, wallet service, admin controller) with inconsistent results.
 *
 * Everything is integer paise.
 */

import { assertPaise } from "./money.js";

/** Platform commission on a battle's entry pool, in basis points (1% = 100bp). */
export const COMMISSION_BPS = 500; // 5%

export const BATTLE_STAKES_Paise = [
  5000, // ₹50
  10000, // ₹100
  25000, // ₹250
  50000, // ₹500
];

/**
 * Compute the full money breakdown for a 1v1 battle.
 *
 * @param {number} entryFeePaise what each player pays to enter
 * @returns {{
 *   entryFeePaise: number, prizePaise: number, commissionPaise: number,
 *   totalPoolPaise: number, winAmountPaise: number
 * }}
 * - totalPool  = 2 × entry (both players)
 * - commission = 5% of pool
 * - prize      = pool − commission  (what the winner receives, credited as a single amount)
 */
export function computePrize(entryFeePaise) {
  assertPaise(entryFeePaise);
  const totalPoolPaise = entryFeePaise * 2;
  const commissionPaise = Math.floor((totalPoolPaise * COMMISSION_BPS) / 10000);
  const prizePaise = totalPoolPaise - commissionPaise;
  return {
    entryFeePaise,
    totalPoolPaise,
    commissionPaise,
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
    get checksum() {
      return b.prizePaise + b.commissionPaise === b.totalPoolPaise;
    },
  };
}

/** Validate a stake chosen by a player against the allowed list. */
export function isValidStake(entryFeePaise) {
  return BATTLE_STAKES_Paise.includes(entryFeePaise);
}
