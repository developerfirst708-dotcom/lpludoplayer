import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { socket } from "../lib/socket.js";
import { formatPaise, computePrize, rupeesToPaise } from "@lpludo/shared";
import { useToast } from "../components/Toast.jsx";
import { Button, Empty, SectionTitle, Skeleton } from "../components/ui.jsx";

/**
 * Battle lobby — same-to-same as Adda Ludo's battle.jsx, on the new UI:
 *   • create a battle with any amount ₹50 – ₹1,00,000 in multiples of ₹50
 *   • open battles list ("Challenge From" + Entry Fee / Winning + PLAY|Cancel)
 *   • running battles list (Playing For / Prize + VIEW|Pending)
 *   • Adda guards: one active battle, max 2 searching battles, no duplicate amount
 *
 * Endpoints (verified against contest.routes.js):
 *   GET  /contests/open        open battles
 *   GET  /contests/mine        my battles (all statuses)
 *   POST /contests             { stake } — stake is HELD, not spent
 *   POST /contests/:id/join    second seat (both holds land before play)
 *   POST /contests/:id/cancel  refunds the creator's hold
 */

const MAX_SEARCHING_BATTLES = 2;
const MIN_AMOUNT = 50;
const MAX_AMOUNT = 100000;
const AMOUNT_STEP = 50;

const ACTIVE_STATUSES = ["join_requested", "running", "room_submitted", "result_submitted", "cancel_requested"];
const RUNNING_STATUSES = ["join_requested", "running", "room_submitted", "result_submitted", "cancel_requested"];

/**
 * Social-proof "running battles" — the exact list Adda Ludo ships in battle.jsx.
 * They are display-only (isFake → clicking never navigates) and never touch the
 * API. Delete this block to switch the list to real battles only.
 */
const FAKE_PLAYER_NAMES = [
  "rocky", "khatu", "Player 59", "Sohan", "Player 145",
  "Player 156", "Player 167", "Player 178", "Player 189", "Player 190",
  "Player 201", "Player 212", "Player 223", "Player 234", "Player 245",
  "Player 256", "Player 267", "Player 278", "Player 289", "Player 300",
];

const FAKE_OPPONENT_NAMES = [
  "Player 311", "Player 322", "aao koi", "Player 344", "Player 355",
  "Player 366", "Player 377", "Player 388", "Player 399", "Player 410",
  "Player 421", "Player 432", "Player 443", "Player 454", "Player 465",
  "Player 476", "Player 487", "Player 498", "Player 509", "Player 520",
];

const FAKE_BATTLE_AMOUNTS = [
  1000, 2050, 500, 350, 3500, 450, 150, 500, 100, 1450, 350, 2050, 1900, 600, 2000, 200, 100, 2250, 150, 3500, 5500, 950, 50, 1050,
];

const randomFrom = (arr) => arr[Math.floor(Math.random() * arr.length)];
const FAKE_RUNNING_AMOUNTS = FAKE_BATTLE_AMOUNTS.slice(0, 15);

const FAKE_RUNNING_BATTLES = FAKE_RUNNING_AMOUNTS.map((amount, index) => {
  const creatorName = randomFrom(FAKE_PLAYER_NAMES);
  let opponentName = randomFrom(FAKE_OPPONENT_NAMES);

  if (opponentName === creatorName) {
    opponentName = `${opponentName} Jr.`;
  }

  const stakePaise = rupeesToPaise(amount);
  return {
    id: `fake_run_${index + 1}`,
    battleId: `fake_run_${index + 1}`,
    stake: stakePaise,
    prize: computePrize(stakePaise).prizePaise,
    status: "running",
    isFake: true,
    createdBy: { name: creatorName },
    opponent: { name: opponentName },
  };
});

const creatorOf = (c) => c?.players?.find((p) => p.seat === 1) || null;
const opponentOf = (c) => c?.players?.find((p) => p.seat === 2) || null;
const isMine = (c) => Boolean(c?.players?.some((p) => p.isYou));

export default function Play() {
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [betAmount, setBetAmount] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const open = useQuery({
    queryKey: ["contests", "open"],
    queryFn: () => api("/contests/open"),
    refetchInterval: 15_000,
  });
  const mine = useQuery({
    queryKey: ["contests", "mine"],
    queryFn: () => api("/contests/mine"),
    refetchInterval: 15_000,
  });

  // realtime: socket deltas patch the queries instead of refetch storms (P1/F2)
  useEffect(() => {
    if (!socket.connected) socket.connect();
    function resubscribe() {
      socket.emit("subscribe:contests", {}, () => {});
    }
    socket.on("connect", resubscribe);
    socket.on("contest:list-changed", () => {
      qc.invalidateQueries({ queryKey: ["contests"] });
    });
    socket.on("wallet:updated", (view) => qc.setQueryData(["wallet"], view));
    resubscribe();
    return () => {
      socket.off("connect");
      socket.off("contest:list-changed");
      socket.off("wallet:updated");
    };
  }, [qc]);

  const openBattles = open.data?.items || [];
  const myBattles = mine.data?.items || [];

  const mySearchingBattles = useMemo(
    () => myBattles.filter((c) => c.status === "open" && creatorOf(c)?.isYou),
    [myBattles]
  );

  /** the caller's own report on this battle (DTO marks players with isYou) */
  const hasMyReport = (c) => {
    const me = (c.players || []).find((p) => p.isYou);
    return (c.resultReports || []).some((r) => String(r.userId) === String(me?.userId));
  };

  /** Adda rule: an unsubmitted active battle blocks create/join. */
  const myActiveBattle = useMemo(
    () =>
      myBattles.find((c) => {
        if (!ACTIVE_STATUSES.includes(c.status)) return false;
        if (c.status === "result_submitted" || c.status === "cancel_requested") {
          return !hasMyReport(c);
        }
        return true;
      }),
    [myBattles]
  );

  const visibleOpenBattles = useMemo(() => {
    const list = openBattles.filter((c) => c.status === "open");
    for (const c of myBattles) {
      if (c.status === "join_requested" && isMine(c)) list.push(c);
    }
    return [...new Map(list.map((c) => [c.id, c])).values()].sort(
      (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
    );
  }, [openBattles, myBattles]);

  const runningBattles = useMemo(() => {
    const real = myBattles.filter((c) => RUNNING_STATUSES.includes(c.status));

    // the player's own battles (the ones showing VIEW) always go on top
    real.sort((a, b) => {
      const aMine = isMine(a) ? 0 : 1;
      const bMine = isMine(b) ? 0 : 1;
      if (aMine !== bMine) return aMine - bMine;
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });

    return [...real, ...FAKE_RUNNING_BATTLES];
  }, [myBattles]);

  const previewPaise = useMemo(() => {
    const amt = Number(betAmount);
    if (!Number.isFinite(amt) || amt < MIN_AMOUNT || amt > MAX_AMOUNT || amt % AMOUNT_STEP !== 0) return null;
    return { stake: rupeesToPaise(amt), ...computePrize(rupeesToPaise(amt)) };
  }, [betAmount]);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["contests"] });
    qc.invalidateQueries({ queryKey: ["wallet"] });
    qc.invalidateQueries({ queryKey: ["profile"] });
  }

  function reportError(err) {
    const msg = String(err?.message || "Something went wrong");
    if (/insufficient|balance|fund/i.test(msg)) toast.error("Insufficient balance");
    else toast.error(msg);
  }

  function validateAmount() {
    const amt = Number(betAmount);
    if (!amt || amt < MIN_AMOUNT) {
      toast.error(`Min battle ₹${MIN_AMOUNT}`);
      return false;
    }
    if (amt > MAX_AMOUNT) {
      toast.error(`Max battle ₹${MAX_AMOUNT.toLocaleString("en-IN")}`);
      return false;
    }
    if (amt % AMOUNT_STEP !== 0) {
      toast.error(`Amount must be in multiples of ₹${AMOUNT_STEP}`);
      return false;
    }
    return true;
  }

  async function handleCreate() {
    if (!validateAmount()) return;
    if (myActiveBattle) {
      toast.error("You are already in a game");
      return;
    }
    if (mySearchingBattles.length >= MAX_SEARCHING_BATTLES) {
      toast.error(`You can keep only ${MAX_SEARCHING_BATTLES} open battles — cancel one first`);
      return;
    }

    const amt = Number(betAmount);
    const stake = rupeesToPaise(amt);
    if (mySearchingBattles.some((c) => c.stake === stake)) {
      toast.error(`You already have an open battle of ₹${amt}`);
      return;
    }

    try {
      setActionLoading(true);
      await api("/contests", { method: "POST", body: { stake } });
      setBetAmount("");
      toast.success("Battle created — waiting for an opponent");
      invalidate();
    } catch (err) {
      reportError(err);
    } finally {
      setActionLoading(false);
    }
  }

  async function joinMatch(battleId) {
    if (myActiveBattle) {
      toast.error("You are already in a game");
      return;
    }
    try {
      setActionLoading(true);
      await api(`/contests/${battleId}/join`, { method: "POST" });
      invalidate();
      navigate(`/battle/${battleId}`);
    } catch (err) {
      reportError(err);
    } finally {
      setActionLoading(false);
    }
  }

  async function cancelBattle(battleId) {
    try {
      setActionLoading(true);
      await api(`/contests/${battleId}/cancel`, { method: "POST" });
      toast.success("Battle cancelled — stake refunded");
      invalidate();
    } catch (err) {
      reportError(err);
    } finally {
      setActionLoading(false);
    }
  }

  function getOpenAction(c) {
    if (c.status === "open" && creatorOf(c)?.isYou) {
      return (
        <Button variant="danger" className="px-4 py-2 text-xs" disabled={actionLoading} onClick={() => cancelBattle(c.id)}>
          Cancel
        </Button>
      );
    }

    if (c.status === "open") {
      return (
        <Button
          variant="success"
          className="px-4 py-2 text-xs"
          disabled={actionLoading}
          onClick={() => joinMatch(c.id)}
        >
          PLAY
        </Button>
      );
    }

    return (
      <div className="flex items-center gap-1.5">
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-500/30 border-t-brand-500" />
        <p className="text-[10px] font-bold text-slate-500">WAITING</p>
      </div>
    );
  }

  const loading = open.isLoading || mine.isLoading;

  return (
    <div className="flex flex-col gap-4">
      {/* banner — same welcome strip as Adda Ludo's battle screen */}
      <div className="rounded-xl bg-ink px-5 py-3 text-[12px] font-bold leading-snug text-white shadow-card">
        LPLUDO में आपका स्वागत है, सबसे Fast ⏩ विथड्रॉ है, 👉 मात्र 2-3 Min में, 👈 LPLUDO का APP आ गया है;
        आप इसे Download कर सकते हैं। आपका विश्वास बनाये रखे 🙏
      </div>

      <div className="flex justify-center">
        <h2 className="text-base font-black tracking-tight text-ink">Create Battle</h2>
      </div>

      {/* create battle — free amount, Adda rules */}
      <div className="rounded-3xl border border-gray-100 bg-white p-2 shadow-card">
        <div className="flex items-center gap-2 rounded-full bg-white p-2 ring-1 ring-gray-200">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-50 text-base font-black text-slate-700">
            ₹
          </div>

          <input
            type="number"
            inputMode="numeric"
            placeholder="Enter Amount"
            className="min-w-0 flex-1 bg-transparent py-2 text-sm font-semibold text-slate-900 outline-none placeholder:font-normal placeholder:text-slate-400"
            value={betAmount}
            min={MIN_AMOUNT}
            max={MAX_AMOUNT}
            step={AMOUNT_STEP}
            onChange={(e) => setBetAmount(e.target.value)}
          />

          <button
            type="button"
            disabled={actionLoading}
            onClick={handleCreate}
            className="mr-1 shrink-0 rounded-full bg-ink px-4 py-2 text-xs font-extrabold text-white transition-all active:scale-95 disabled:opacity-60"
          >
            {actionLoading ? "…" : "Set"}
          </button>
        </div>

        <p className="px-3 pb-1 pt-2 text-[11px] font-semibold text-slate-500">
          Min ₹{MIN_AMOUNT} · Max ₹{MAX_AMOUNT.toLocaleString("en-IN")} · multiples of ₹{AMOUNT_STEP}
          {previewPaise && (
            <>
              {" · "}
              <span className="font-bold text-brand-600">winner gets {formatPaise(previewPaise.prizePaise)}</span>
            </>
          )}
        </p>
      </div>

      {/* open battles */}
      <div>
        <SectionTitle title="Open Battles" action={<span className="text-[11px] font-bold text-slate-400">⚔️ live</span>} />
        <div className="mt-2 flex flex-col gap-3">
          {loading && <Skeleton className="h-24 w-full" />}
          {!loading && visibleOpenBattles.length === 0 && <Empty title="No Battles Live" hint="Create one above to get started." />}

          {visibleOpenBattles.map((c) => (
            <OpenCard key={c.id} battle={c} action={getOpenAction(c)} />
          ))}
        </div>
      </div>

      <div className="h-[3px] rounded-full bg-gray-200" />

      {/* running battles */}
      <div>
        <SectionTitle title="Running Battles" action={<span className="text-[11px] font-bold text-slate-400">⚔️ live</span>} />
        <div className="mt-2 flex flex-col gap-3">
          {!loading && runningBattles.length === 0 && <Empty title="No Running Battles" />}

          {runningBattles.map((c) => (
            <MatchCard
              key={c.id}
              battle={c}
              onClick={() => {
                if (c.isFake) return;
                navigate(`/battle/${c.id}`);
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Open battle: "Challenge From" band + Entry Fee | action | Winning. */
function OpenCard({ battle, action }) {
  const creator = creatorOf(battle);
  return (
    <article className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-card">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-gray-100 px-3 py-2">
        <h3 className="text-[11px] font-semibold text-gray-600">Challenge From</h3>
        <h3 className="truncate text-[12px] font-black text-slate-900">{creator?.name || "Player"}</h3>
      </div>

      <div className="grid grid-cols-3 items-center gap-2 px-3 py-3">
        <MoneyBlock label="Entry Fee" value={battle.stake} />

        <div className="flex shrink-0 justify-center">{action}</div>

        <MoneyBlock label="Winning" value={battle.prize ?? computePrize(battle.stake).prizePaise} right />
      </div>
    </article>
  );
}

/** Running battle: Playing For | Prize band + two players + VIEW/Pending. */
function MatchCard({ battle, onClick }) {
  if (!battle) return null;

  const status = String(battle.status || "").toLowerCase();
  const isPending = status === "result_submitted" || status === "cancel_requested";
  const mine = !battle.isFake && isMine(battle);

  const creatorName = creatorOf(battle)?.name || battle.createdBy?.name || "Player";
  const opponentName = opponentOf(battle)?.name || battle.opponent?.name || "Opponent";
  const prize = battle.prize ?? computePrize(battle.stake).prizePaise;

  return (
    <article
      onClick={onClick}
      className={`cursor-pointer overflow-hidden rounded-2xl border bg-white shadow-card transition active:scale-[0.99] ${
        isPending ? "border-orange-200" : "border-gray-100"
      }`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-gray-100 px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-gray-600">Playing For</span>
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-300 via-brand-500 to-[#C98509] text-[10px] font-black text-white shadow-sm">
            ₹
          </span>
          <span className="truncate text-xs font-black text-slate-900">{formatPaise(battle.stake, { withSymbol: false })}</span>
        </div>

        <div className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-gray-600">Prize</span>
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-300 via-brand-500 to-[#C98509] text-[10px] font-black text-white shadow-sm">
            ₹
          </span>
          <span className="truncate text-xs font-black text-slate-900">{formatPaise(prize, { withSymbol: false })}</span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 px-8 py-2.5">
        <PlayerAvatar name={creatorName} />

        <div className="flex shrink-0 items-center justify-center">
          {mine ? (
            isPending ? (
              <span className="rounded-full bg-orange-500 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-white shadow-md shadow-orange-500/20">
                Pending
              </span>
            ) : (
              <span className="rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-1 text-[10px] font-black uppercase tracking-wide text-white shadow-md shadow-indigo-500/25">
                VIEW
              </span>
            )
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-ink shadow-inner ring-2 ring-white/60">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4 text-white"
              >
                <polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5" />
                <line x1="13" x2="19" y1="19" y2="13" />
                <line x1="16" x2="20" y1="16" y2="20" />
                <line x1="19" x2="21" y1="21" y2="19" />
                <polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5" />
                <line x1="5" x2="9" y1="14" y2="18" />
                <line x1="7" x2="4" y1="17" y2="20" />
                <line x1="3" x2="5" y1="19" y2="21" />
              </svg>
            </div>
          )}
        </div>

        <PlayerAvatar name={opponentName} />
      </div>
    </article>
  );
}

function PlayerAvatar({ name }) {
  const safeName = String(name || "Player").trim() || "Player";

  return (
    <div className="flex min-w-0 flex-col items-center gap-1">
      <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-indigo-50 shadow ring-2 ring-white">
        <img
          src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(safeName)}`}
          alt={safeName}
          loading="lazy"
          className="h-full w-full object-cover"
        />
      </div>
      <p className="w-full truncate text-center text-[10px] font-bold text-slate-800">{safeName}</p>
    </div>
  );
}

function MoneyBlock({ label, value, right = false }) {
  return (
    <div className={right ? "text-right" : "text-left"}>
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm font-black text-slate-950">{formatPaise(value || 0)}</p>
    </div>
  );
}
