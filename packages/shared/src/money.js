/**
 * All money in the platform is stored and computed as INTEGER PAISE.
 * Floating point rupee maths is the #1 way to silently lose money.
 *
 *   5000 paise === ₹50.00
 *
 * Rule: nothing outside this file may do arithmetic on money amounts
 * without going through these helpers.
 */

export const PAISE_PER_RUPEE = 100;

/** exact decimal-string -> integer paise, round half up on the 3rd decimal */
const DECIMAL_RE = /^(-)?(\d+)(?:\.(\d{1,3}))?$/;

function decimalStringToPaise(raw) {
  const m = DECIMAL_RE.exec(raw);
  if (!m) throw new MoneyError(`bad rupee amount: ${raw}`);
  const [, neg, intPart, fracPart = ""] = m;
  const frac3 = (fracPart + "000").slice(0, 3); // pad to 3 digits
  let paise = Number(intPart) * 100 + Math.floor(Number(frac3) / 10);
  if (Number(frac3) % 10 >= 5) paise += 1; // e.g. 1.005 -> 100.5 -> 101
  if (!Number.isSafeInteger(paise)) throw new MoneyError(`rupee amount out of range: ${raw}`);
  return neg ? -paise : paise;
}

/**
 * Parse a rupee amount of any shape into integer paise. Throws on garbage.
 * Numbers are converted via their decimal string form first, so float
 * multiplication dust (1.005 * 100 === 100.4999…) can never skew a paisa.
 */
export function rupeesToPaise(rupees) {
  if (typeof rupees === "number") {
    if (!Number.isFinite(rupees)) throw new MoneyError("non-finite rupee amount");
    return decimalStringToPaise(String(rupees));
  }
  if (typeof rupees === "string") {
    return decimalStringToPaise(rupees.trim());
  }
  throw new MoneyError("rupee amount must be a number or a decimal string");
}

/** Format integer paise as a rupee number (never a float artifact). */
export function paiseToRupees(paise) {
  assertPaise(paise);
  return Number((paise / PAISE_PER_RUPEE).toFixed(2));
}

/** Display string: 5000 -> "₹50" ; 5050 -> "₹50.50" ; -5000 -> "-₹50"
 *  Ledger rows are signed (negative = money leaving the user), so the display
 *  formatter accepts negative integers even though every money INPUT stays
 *  non-negative (assertPaise). */
export function formatPaise(paise, { withSymbol = true } = {}) {
  if (!Number.isInteger(paise)) throw new MoneyError(`not integer paise: ${paise}`);
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.trunc(abs / PAISE_PER_RUPEE);
  const rest = abs % PAISE_PER_RUPEE;
  const frac = rest ? `.${String(rest).padStart(2, "0")}` : "";
  const symbol = withSymbol ? "₹" : "";
  return `${negative ? "-" : ""}${symbol}${rupees.toLocaleString("en-IN")}${frac}`;
}

export function isPaise(value) {
  return Number.isInteger(value) && value >= 0;
}

export function assertPaise(value) {
  if (!isPaise(value)) throw new MoneyError(`not integer paise: ${value}`);
  return value;
}

/** Total of a list of paise amounts. */
export function sumPaise(amounts) {
  return amounts.reduce((acc, n) => acc + assertPaise(n), 0);
}

/**
 * Split `total` into `parts` integer paise shares whose sum is exactly `total`
 * (remainder goes to the first share). Used for splits that must never drift.
 */
export function splitPaiseEvenly(total, parts) {
  assertPaise(total);
  if (!Number.isInteger(parts) || parts <= 0) throw new MoneyError("parts must be a positive integer");
  const base = Math.floor(total / parts);
  const remainder = total - base * parts;
  const out = Array.from({ length: parts }, () => base);
  for (let i = 0; i < remainder; i += 1) out[i] += 1;
  return out;
}

export class MoneyError extends Error {
  constructor(message) {
    super(message);
    this.name = "MoneyError";
  }
}
