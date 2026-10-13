import { useEffect, useMemo, useState, useCallback } from "react";
import api, { getData, getError } from "../api.js";
import socket from "../socket.js";

const MAX_SEARCHING_BATTLES = 2;

const calculatePrizeAmount = (amount) => {
  const amt = parseInt(amount, 10);
  if (isNaN(amt)) return 0;

  const totalPool = amt * 2;
  let platformFee = 0;

  if (amt >= 50 && amt <= 500) {
    platformFee = amt * 0.1;
  } else if (amt > 500 && amt <= 100000) {
    platformFee = amt * 0.05;
  }

  return Math.floor(totalPool - platformFee);
};

const getCreatorId = (battle) =>
  String(battle?.createdBy?._id || battle?.createdBy?.id || battle?.createdBy || "");

const getOpponentId = (battle) =>
  String(battle?.opponent?._id || battle?.opponent?.id || battle?.opponent || "");

const Battle = ({ setActiveTab }) => {
  const [betAmount, setBetAmount] = useState("");
  const [openBattles, setOpenBattles] = useState([]);
  const [myBattles, setMyBattles] = useState([]);
  const [actionLoading, setActionLoading] = useState(false);

  const token = localStorage.getItem("token");

  const myId = useMemo(() => {
    try {
      const user = JSON.parse(localStorage.getItem("user") || "{}");
      if (user?._id || user?.id) return String(user._id || user.id);

      const jwt = localStorage.getItem("token");
      if (!jwt) return "";

      const payload = JSON.parse(atob(jwt.split(".")[1] || ""));
      return String(payload?._id || payload?.id || payload?.userId || payload?.user || "");
    } catch {
      return "";
    }
  }, []);

  const calculatePrize = useCallback((amount) => calculatePrizeAmount(amount), []);

  const hasMyResult = useCallback(
    (battle) =>
      Array.isArray(battle?.results)
        ? battle.results.some((item) => String(item?.user?._id || item?.user || "") === myId)
        : false,
    [myId]
  );

  const mapContest = (c) => ({
    ...c,
    battleId: c.contestId,
    amount: c.entryFee,
    createdBy: c.createdBy,
    opponent: c.opponent,
  });

  const fetchBattles = useCallback(async () => {
    if (!token) return;

    try {
      const openRes = await api.get("/contests/open");
      const openData = getData(openRes);
      setOpenBattles(Array.isArray(openData?.contests) ? openData.contests.map(mapContest) : []);

      const myRes = await api.get("/contests/my-contests");
      const myData = getData(myRes);
      setMyBattles(Array.isArray(myData?.contests) ? myData.contests.map(mapContest) : []);
    } catch (err) {
      console.log("Fetch error:", getError(err));
    }
  }, [token]);

  useEffect(() => {
    if (!token) {
      setActiveTab?.("Login");
      return;
    }

    if (!socket.connected) {
      socket.connect();
    }
    socket.emit("join-open-contests");

    const handleContestUpdate = () => {
      void fetchBattles();
    };

    queueMicrotask(handleContestUpdate);
    socket.on("contest-created", handleContestUpdate);
    socket.on("contest-updated", handleContestUpdate);
    socket.on("contest-deleted", handleContestUpdate);
    const refreshInterval = setInterval(handleContestUpdate, 5000);

    return () => {
      clearInterval(refreshInterval);
      socket.off("contest-created", handleContestUpdate);
      socket.off("contest-updated", handleContestUpdate);
      socket.off("contest-deleted", handleContestUpdate);
    };
  }, [token, myId, fetchBattles, setActiveTab]);

  const allBattles = useMemo(() => {
    const map = new Map();
    for (const battle of [...openBattles, ...myBattles]) {
      if (!battle?.battleId) continue;
      map.set(battle.battleId, battle);
    }
    return Array.from(map.values());
  }, [openBattles, myBattles]);

  const mySearchingBattles = useMemo(() => {
    const list = [];
    for (const battle of myBattles) {
      const status = String(battle?.status || "").toLowerCase();
      if (status === "open" && getCreatorId(battle) === myId) {
        list.push(battle);
      }
    }
    return list;
  }, [myBattles, myId]);

  const myActiveBattle = useMemo(() => {
    const activeStatuses = new Set([
      "join_requested",
      "running",
      "room_submitted",
      "result_submitted",
      "cancel_requested",
    ]);

    for (const battle of myBattles) {
      const status = String(battle?.status || "").toLowerCase();
      if (!activeStatuses.has(status)) continue;

      if (status === "result_submitted" || status === "cancel_requested") {
        if (!hasMyResult(battle)) return battle;
      } else {
        return battle;
      }
    }
    return null;
  }, [myBattles, hasMyResult]);

  const visibleOpenBattles = useMemo(() => {
    const list = [];
    for (const battle of allBattles) {
      const status = String(battle?.status || "").toLowerCase();
      const isCreator = getCreatorId(battle) === myId;
      const isOpponent = getOpponentId(battle) === myId;

      if (status === "open" || (status === "join_requested" && (isCreator || isOpponent))) {
        list.push(battle);
      }
    }
    list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    return list;
  }, [allBattles, myId]);

  const runningBattles = useMemo(() => {
    const realRunningAndPendingBattles = [];
    for (const battle of allBattles) {
      const status = String(battle?.status || "").toLowerCase();
      if (
        status === "running" ||
        status === "room_submitted" ||
        status === "result_submitted" ||
        status === "cancel_requested"
      ) {
        realRunningAndPendingBattles.push(battle);
      }
    }

    realRunningAndPendingBattles.sort((a, b) => {
      const aMine = getCreatorId(a) === myId || getOpponentId(a) === myId;
      const bMine = getCreatorId(b) === myId || getOpponentId(b) === myId;
      if (aMine !== bMine) return aMine ? -1 : 1;
      return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
    });

    return realRunningAndPendingBattles;
  }, [allBattles, myId]);

  const validateAmount = () => {
    const amt = Number(betAmount);
    if (!amt || amt < 50) {
      alert("Min battle ₹50 ");
      return false;
    }
    if (amt > 100000) {
      alert("Max battle ₹100000");
      return false;
    }
    if (amt % 50 !== 0) {
      alert("Amount in Multiple ₹50 ");
      return false;
    }
    return true;
  };

  const handleCreate = async () => {
    if (!validateAmount()) return;
    if (myActiveBattle) {
      alert("You already in game ");
      return;
    }
    if (mySearchingBattles.length >= MAX_SEARCHING_BATTLES) {
      alert("set only 2 battle ");
      return;
    }

    const amt = Number(betAmount);
    const isSameAmountByMe = mySearchingBattles.some((battle) => Number(battle.amount) === amt);
    if (isSameAmountByMe) {
      alert("no same amount");
      return;
    }

    try {
      setActionLoading(true);
      await api.post("/contests/create", { amount: amt });
      setBetAmount("");
      fetchBattles();
    } catch (err) {
      const errMsg = getError(err).toLowerCase();
      if (errMsg.includes("insufficient") || errMsg.includes("balance") || errMsg.includes("fund")) {
        alert("Insufficient balance");
      } else {
        alert(getError(err));
      }
    } finally {
      setActionLoading(false);
    }
  };

  const joinMatch = async (battleId) => {
    if (myActiveBattle) {
      alert("You are already in game.");
      return;
    }

    try {
      setActionLoading(true);
      await api.post(`/contests/join/${battleId}`);
      fetchBattles();
      setActiveTab?.(`RoomCode_${battleId}`);
    } catch (err) {
      const errMsg = getError(err).toLowerCase();
      if (errMsg.includes("insufficient") || errMsg.includes("balance") || errMsg.includes("fund")) {
        alert("Insufficient balance");
      } else {
        alert(getError(err));
      }
    } finally {
      setActionLoading(false);
    }
  };

  const startBattle = async (battleId) => {
    try {
      setActionLoading(true);
      await api.post(`/contests/accept/${battleId}`);
      fetchBattles();
      setActiveTab?.(`RoomCode_${battleId}`);
    } catch (err) {
      console.log("Start error:", getError(err));
    } finally {
      setActionLoading(false);
    }
  };

  const rejectBattle = async (battleId) => {
    try {
      setActionLoading(true);
      await api.post(`/contests/reject/${battleId}`);
      fetchBattles();
    } catch (err) {
      console.log("Reject error:", getError(err));
    } finally {
      setActionLoading(false);
    }
  };

  const cancelBattle = async (battleId) => {
    try {
      setActionLoading(true);
      await api.post(`/contests/cancel/${battleId}`);
      fetchBattles();
    } catch (err) {
      console.log("Cancel error:", getError(err));
    } finally {
      setActionLoading(false);
    }
  };

  const getOpenAction = (battle) => {
    const status = String(battle?.status || "").toLowerCase();
    const isMine = getCreatorId(battle) === myId;
    const isOpponent = getOpponentId(battle) === myId;

    if (status === "open" && isMine) {
      return (
        <button
          disabled={actionLoading}
          onClick={() => cancelBattle(battle.battleId)}
          className="rounded-xl bg-rose-500/10 px-3.5 py-2 text-xs font-bold text-rose-600 ring-1 ring-rose-200 transition-all hover:bg-rose-500/20 active:scale-95 disabled:opacity-50"
        >
          Cancel
        </button>
      );
    }

    if (status === "open" && !isMine) {
      return (
        <button
          disabled={actionLoading}
          onClick={() => joinMatch(battle.battleId)}
          className="rounded-xl bg-gradient-to-r from-emerald-500 via-emerald-600 to-green-600 px-4 py-2 text-xs font-black text-white shadow-md shadow-emerald-500/25 transition-all hover:from-emerald-600 hover:to-green-700 active:scale-95 disabled:opacity-50"
        >
          PLAY
        </button>
      );
    }

    if (status === "join_requested" && isMine) {
      return (
        <div className="flex items-center gap-2">
          <button
            disabled={actionLoading}
            onClick={() => startBattle(battle.battleId)}
            className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white shadow-sm transition-all hover:bg-emerald-700 disabled:opacity-50"
          >
            START
          </button>
          <button
            disabled={actionLoading}
            onClick={() => rejectBattle(battle.battleId)}
            className="rounded-xl bg-rose-500 px-3 py-2 text-xs font-bold text-white shadow-sm transition-all hover:bg-rose-600 disabled:opacity-50"
          >
            REJECT
          </button>
        </div>
      );
    }

    if (status === "join_requested" && isOpponent) {
      return (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-amber-200 border-t-amber-600" />
            <p className="text-[10px] font-black tracking-wider text-amber-700">WAITING</p>
          </div>
          <button
            disabled={actionLoading}
            onClick={() => cancelBattle(battle.battleId)}
            className="rounded-xl bg-rose-500 px-2.5 py-1.5 text-[10px] font-bold text-white transition-all active:scale-95 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      );
    }

    return (
      <button disabled className="rounded-xl bg-slate-200 px-3 py-2 text-xs font-bold text-slate-500">
        BUSY
      </button>
    );
  };

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-amber-50/50 via-white to-amber-50/20 px-4 pb-28 pt-4 text-slate-950">
      {/* Background Ambient Glow Accents */}
      <div className="pointer-events-none absolute -top-10 -left-10 h-48 w-48 rounded-full bg-amber-200/40 blur-3xl" />
      <div className="pointer-events-none absolute top-1/3 -right-10 h-48 w-48 rounded-full bg-yellow-300/30 blur-3xl" />

      <div className="relative z-10 mx-auto max-w-md space-y-4">
        {/* Notice Box */}
        <div className="relative overflow-hidden rounded-2xl border border-amber-300/80 bg-gradient-to-r from-amber-100/90 via-amber-50 to-yellow-100/90 px-4 py-3 text-center text-xs font-bold text-amber-950 shadow-sm">
          <span className="absolute -right-4 -bottom-4 text-4xl opacity-15 select-none" aria-hidden="true">🎲</span>
          👉दोस्तों Battle Ludo 🎲. कभी आपका भरोसा नहीं तोड़ेगा , 24×7 Withdrawal चालू रहता है 👈
        </div>

        {/* Create Battle Box */}
        <div className="rounded-3xl border border-amber-200/80 bg-white/90 p-4 shadow-xl backdrop-blur-md">
          <div className="flex items-center justify-between mb-3 px-2">
            <h2 className="text-xs font-black uppercase tracking-wider text-amber-900 flex items-center gap-1.5">
              <span>🎲</span> Create Battle Challenge
            </h2>
            <span className="text-[10px] font-bold text-slate-400">Min ₹50 | Max ₹1L</span>
          </div>

          <div className="flex rounded-full items-center gap-2 bg-amber-50/60 p-1.5 border border-amber-200/60 shadow-inner">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-400 text-sm font-black text-slate-950 shadow-sm">
              ₹
            </div>

            <input
              type="number"
              placeholder="Enter Amount (e.g. 100)"
              className="min-w-0 flex-1 bg-transparent px-2 text-sm font-bold text-slate-900 outline-none placeholder:text-slate-400 placeholder:font-normal"
              value={betAmount}
              min="50"
              max="100000"
              step="50"
              onChange={(e) => setBetAmount(e.target.value)}
            />

            <button
              disabled={actionLoading}
              onClick={handleCreate}
              className="rounded-full bg-gradient-to-r from-amber-400 via-amber-500 to-yellow-500 px-6 py-2.5 text-xs font-black tracking-wide text-neutral-950 shadow-md shadow-amber-500/20 transition-all hover:brightness-105 active:scale-95 disabled:opacity-60"
            >
              {actionLoading ? "..." : "Set Battle"}
            </button>
          </div>
        </div>

        {/* Open Battles Section */}
        <SectionTitle title="Open Battles" />

        <div className="space-y-3">
          {visibleOpenBattles.length === 0 && <EmptyBox text="No Battles Live" />}

          {visibleOpenBattles.map((battle) => (
            <OpenCard
              key={battle.battleId}
              battle={battle}
              action={getOpenAction(battle)}
              calculatePrize={calculatePrize}
            />
          ))}
        </div>

        <div className="my-2 h-[2px] w-full bg-gradient-to-r from-transparent via-amber-200 to-transparent" />

        {/* Running Battles Section */}
        <SectionTitle title="Running Battles" />

        <div className="space-y-3">
          {runningBattles.length === 0 && <EmptyBox text="No Running Battles" />}

          {runningBattles.map((battle) => (
            <MatchCard
              key={battle.battleId}
              battle={battle}
              calculatePrize={calculatePrize}
              myId={myId}
              onClick={() => {
                setActiveTab?.(`RoomCode_${battle.battleId}`);
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

function SectionTitle({ title }) {
  return (
    <div className="mb-2 mt-4 flex items-center justify-between px-1">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-black uppercase tracking-wider text-slate-900">
          {title}
        </h3>
        <span className="text-xs">⚔️</span>
      </div>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100/80 px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-emerald-800 shadow-sm border border-emerald-200/50">
        <span className="relative flex h-2 w-2" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-600" />
        </span>
        Live
      </span>
    </div>
  );
}

function EmptyBox({ text }) {
  return (
    <div className="rounded-2xl border border-dashed border-amber-200 bg-white/60 p-6 text-center text-xs font-black uppercase tracking-wider text-slate-400 shadow-sm">
      {text}
    </div>
  );
}

function OpenCard({ battle, action, calculatePrize }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-amber-200/70 bg-white shadow-md transition-all hover:shadow-lg">
      <div className="bg-gradient-to-r from-amber-100/80 via-amber-50 to-amber-100/80 px-4 py-2 border-b border-amber-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs">🎲</span>
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Challenge From</span>
          <span className="truncate text-xs font-black text-slate-900">
            {battle?.createdBy?.name || "Player"}
          </span>
        </div>
        <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-amber-800">
          Open
        </span>
      </div>

      <div className="grid grid-cols-3 items-center gap-2 px-4 py-3">
        <MoneyBlock label="Entry Fee" value={battle?.amount} />

        <div className="flex justify-center shrink-0">
          {action}
        </div>

        <MoneyBlock label="Winning Prize" value={battle?.prize || calculatePrize(battle?.amount)} right isGreen />
      </div>
    </div>
  );
}

function MatchCard({ battle, calculatePrize, onClick, myId }) {
  if (!battle) return null;

  const status = String(battle?.status || "").toLowerCase();
  const isPending = status === "result_submitted" || status === "cancel_requested";

  const isMine = getCreatorId(battle) === myId;
  const isOpponent = getOpponentId(battle) === myId;
  const isParticipant = isMine || isOpponent;

  const creatorName = battle?.createdBy?.name || "Player";
  const opponentName = battle?.opponent?.name || "Opponent";
  const amount = battle?.amount || 0;
  const prize = battle?.prize || calculatePrize(battle?.amount);

  return (
    <div
      onClick={onClick}
      className={`cursor-pointer overflow-hidden rounded-2xl bg-white shadow-md border transition-all active:scale-[0.99] hover:shadow-lg ${
        isPending ? "border-orange-300 ring-2 ring-orange-100" : "border-amber-200/70"
      }`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-amber-100 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 px-4 py-2 text-white">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wide text-amber-300">Entry:</span>
          <span className="text-xs font-black text-white">₹{amount}</span>
        </div>

        <div className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">Battle Active</span>
        </div>

        <div className="flex min-w-0 items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-300">Prize:</span>
          <span className="text-xs font-black text-emerald-400">₹{prize}</span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 px-6 py-3.5 bg-amber-50/20">
        <PlayerAvatar name={creatorName} role="Creator" />

        <div className="flex shrink-0 items-center justify-center">
          {isParticipant ? (
            isPending ? (
              <button className="rounded-full bg-orange-500 px-3.5 py-1 text-[10px] font-black uppercase tracking-wide text-white shadow-md shadow-orange-500/25 active:scale-95">
                Pending
              </button>
            ) : (
              <button className="rounded-full bg-gradient-to-r from-amber-500 to-yellow-500 px-4 py-1.5 text-[10px] font-black uppercase tracking-wide text-neutral-950 shadow-md shadow-amber-500/25 active:scale-95">
                VIEW ROOM
              </button>
            )
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-yellow-500 shadow-md ring-2 ring-white">
              <span className="text-xs font-black text-neutral-950">🎲</span>
            </div>
          )}
        </div>

        <PlayerAvatar name={opponentName} role="Opponent" />
      </div>
    </div>
  );
}

function PlayerAvatar({ name, role }) {
  const safeName = String(name || "Player").trim() || "Player";
  const initials = safeName.slice(0, 1).toUpperCase();

  return (
    <div className="flex min-w-0 flex-col items-center gap-1">
      <div
        aria-hidden="true"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-amber-300 bg-gradient-to-br from-amber-50 to-yellow-100 text-sm font-black text-amber-900 shadow-sm ring-2 ring-white"
      >
        {initials}
      </div>
      <div className="text-center">
        <p className="w-20 truncate text-[11px] font-black text-slate-800">
          {safeName}
        </p>
        <p className="text-[9px] font-bold uppercase text-slate-400">{role}</p>
      </div>
    </div>
  );
}

function MoneyBlock({ label, value, right = false, isGreen = false }) {
  return (
    <div className={right ? "text-right" : "text-left"}>
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`mt-0.5 text-sm font-black ${isGreen ? "text-emerald-600" : "text-slate-900"}`}>
        ₹{value || 0}
      </p>
    </div>
  );
}

export default Battle;
