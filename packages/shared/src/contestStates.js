/**
 * Battle (contest) state machine — the reference app mutated `status` freely
 * from ~7 different controllers, which is exactly how money got stuck.
 *
 * Every status change in the API MUST go through transition().
 * terminal states have no outgoing edges.
 */

export const CONTEST_STATES = {
  OPEN: "open",
  JOIN_REQUESTED: "join_requested",
  RUNNING: "running",
  ROOM_SUBMITTED: "room_submitted",
  RESULT_SUBMITTED: "result_submitted",
  CANCEL_REQUESTED: "cancel_requested",
  APPROVED: "approved",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
};

export const TERMINAL_STATES = [CONTEST_STATES.APPROVED, CONTEST_STATES.CANCELLED, CONTEST_STATES.EXPIRED];

export const TRANSITIONS = {
  [CONTEST_STATES.OPEN]: [CONTEST_STATES.JOIN_REQUESTED, CONTEST_STATES.CANCELLED, CONTEST_STATES.EXPIRED],
  [CONTEST_STATES.JOIN_REQUESTED]: [CONTEST_STATES.RUNNING, CONTEST_STATES.OPEN, CONTEST_STATES.CANCELLED],
  [CONTEST_STATES.RUNNING]: [
    CONTEST_STATES.ROOM_SUBMITTED,
    CONTEST_STATES.RESULT_SUBMITTED,
    CONTEST_STATES.CANCEL_REQUESTED,
  ],
  [CONTEST_STATES.ROOM_SUBMITTED]: [CONTEST_STATES.RESULT_SUBMITTED, CONTEST_STATES.CANCEL_REQUESTED],
  [CONTEST_STATES.RESULT_SUBMITTED]: [CONTEST_STATES.APPROVED, CONTEST_STATES.CANCELLED],
  [CONTEST_STATES.CANCEL_REQUESTED]: [CONTEST_STATES.CANCELLED, CONTEST_STATES.APPROVED],
  [CONTEST_STATES.APPROVED]: [],
  [CONTEST_STATES.CANCELLED]: [],
  [CONTEST_STATES.EXPIRED]: [],
};

export class IllegalTransitionError extends Error {
  constructor(from, to) {
    super(`illegal contest transition: ${from} -> ${to}`);
    this.name = "IllegalTransitionError";
    this.from = from;
    this.to = to;
  }
}

export function isTerminal(state) {
  return TERMINAL_STATES.includes(state);
}

export function isTransitionAllowed(from, to) {
  if (from === to) return false;
  return (TRANSITIONS[from] ?? []).includes(to);
}

/**
 * Assert a transition is legal; returns the target state on success.
 * Throws IllegalTransitionError otherwise — callers should map that to 409.
 */
export function transition(from, to, { actor } = {}) {
  if (!isTransitionAllowed(from, to)) throw new IllegalTransitionError(from, to);
  return to;
}

/** Which side of a 1v1 battle must be settled when reaching a terminal state. */
export const SETTLEMENT_BY_STATE = {
  [CONTEST_STATES.APPROVED]: "payout_winner",
  [CONTEST_STATES.CANCELLED]: "refund_both",
  [CONTEST_STATES.EXPIRED]: "refund_creator",
};
