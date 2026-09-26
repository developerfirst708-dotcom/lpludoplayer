import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiUpload } from "../lib/api.js";
import compressImage from "../lib/compressImage.js";
import { socket } from "../lib/socket.js";
import { formatPaise } from "@lpludo/shared";
import { useToast } from "../components/Toast.jsx";
import { Button, Empty, Input, Panel, Skeleton, StatusBadge } from "../components/ui.jsx";

export default function Battle() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();

  // State Management
  const [betAmount, setBetAmount] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [busy, setBusy] = useState(null); // "create" | "join" | "room" | "result" | "cancel"
  const [reported, setReported] = useState(null);

  // Result Reporting + Screenshot Proof State
  const [outcome, setOutcome] = useState("");
  const [screenshot, setScreenshot] = useState(null);
  const [screenshotName, setScreenshotName] = useState("");
  const screenshotRef = useRef(null);

  /* -------------------------------------------------------------------------- */
  /*                              API QUERIES                                   */
  /* -------------------------------------------------------------------------- */

  // 1. Fetch Open Battles (Active when in Lobby View)
  const openContestsQuery = useQuery({
    queryKey: ["contests", "open"],
    queryFn: () => api("/contests?status=open").then((r) => r.contests || []),
    enabled: !id,
    refetchInterval: 10_000,
  });

  // 2. Fetch Running Battles (Active when in Lobby View)
  const runningContestsQuery = useQuery({
    queryKey: ["contests", "running"],
    queryFn: () => api("/contests?status=running").then((r) => r.contests || []),
    enabled: !id,
    refetchInterval: 10_000,
  });

  // 3. Fetch Single Contest Details (Active when in Room View with ID)
  const contestQuery = useQuery({
    queryKey: ["contest", id],
    queryFn: () => api(`/contests/${id}`).then((r) => r.contest),
    enabled: Boolean(id),
    refetchInterval: 15_000,
  });

  /* -------------------------------------------------------------------------- */
  /*                         WEBSOCKET LISTENERS                                */
  /* -------------------------------------------------------------------------- */
  useEffect(() => {
    if (!socket.connected) socket.connect();

    function watch() {
      if (id) {
        socket.emit("watch:contest", { contestId: id }, () => {});
      }
    }

    const handleUpdate = (upd) => {
      if (id && String(upd?.id) === String(id)) {
        qc.invalidateQueries({ queryKey: ["contest", id] });
      }
      qc.invalidateQueries({ queryKey: ["contests"] });
      qc.invalidateQueries({ queryKey: ["wallet"] });
    };

    socket.on("connect", watch);
    socket.on("contest:updated", handleUpdate);
    socket.on("contest:created", handleUpdate);

    watch();

    return () => {
      socket.off("connect", watch);
      socket.off("contest:updated", handleUpdate);
      socket.off("contest:created", handleUpdate);
    };
  }, [id, qc]);

  useEffect(() => {
    if (contestQuery.isError) {
      toast.error(contestQuery.error?.message || "Battle not found");
      navigate("/");
    }
  }, [contestQuery.isError, navigate, toast]);

  /* -------------------------------------------------------------------------- */
  /*                              ACTION HANDLERS                               */
  /* -------------------------------------------------------------------------- */
  async function run(action, fn, okMessage) {
    setBusy(action);
    try {
      const res = await fn();
      if (okMessage) toast.success(okMessage);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["contest", id] }),
        qc.invalidateQueries({ queryKey: ["contests"] }),
        qc.invalidateQueries({ queryKey: ["wallet"] }),
      ]);
      return res;
    } catch (err) {
      toast.error(err?.message || "Action failed");
    } finally {
      setBusy(null);
    }
  }

  // Create Battle Action
  const handleCreate = () => {
    const amt = Number(betAmount);
    if (!amt || amt < 50) return toast.error("Min battle amount is ₹50");
    if (amt > 100000) return toast.error("Max battle amount is ₹100,000");
    if (amt % 50 !== 0) return toast.error("Amount must be in multiples of ₹50");

    return run(
      "create",
      async () => {
        const data = await api("/contests", {
          method: "POST",
          body: { stake: amt * 100 }, // Converted to paise for Backend API
        });
        setBetAmount("");
        if (data?.contest?.id) {
          navigate(`/battle/${data.contest.id}`);
        }
      },
      "Battle created successfully!"
    );
  };

  // Join Battle Action
  const join = (targetId = id) =>
    run(
      "join",
      async () => {
        await api(`/contests/${targetId}/join`, { method: "POST" });
        if (targetId !== id) navigate(`/battle/${targetId}`);
      },
      "You joined the battle!"
    );

  // Submit Room Code Action
  const submitRoom = () =>
    run(
      "room",
      () =>
        api(`/contests/${id}/room`, {
          method: "POST",
          body: { roomCode: roomCode.trim().toUpperCase() },
        }),
      "Room code shared!"
    );

  // Submit Result Action
  const submitResultReport = () => {
    if (!outcome) return;
    if (outcome === "won" && !screenshot) {
      return toast.error("Upload your winning screenshot proof first");
    }

    return run(
      "result",
      async () => {
        let screenshotKeys = [];
        if (screenshot) {
          const compressed = await compressImage(screenshot);
          const { key } = await apiUpload("/uploads", compressed, "battle");
          screenshotKeys = [key];
        }
        await api(`/contests/${id}/result`, {
          method: "POST",
          body: { outcome, screenshotKeys },
        });
        setReported(outcome);
      },
      outcome === "cancel" ? "Cancellation requested" : "Result reported successfully!"
    );
  };

  // Cancel Battle Action
  const cancelBattle = (targetId = id) =>
    run(
      "cancel",
      () => api(`/contests/${targetId}/cancel`, { method: "POST" }),
      "Battle cancelled & stake refunded"
    );

  function pickScreenshot(file) {
    if (!file) return;
    setScreenshot(file);
    setScreenshotName(file.name);
  }

  /* -------------------------------------------------------------------------- */
  /*                 1. BATTLE ROOM VIEW (When Route has :id)                   */
  /* -------------------------------------------------------------------------- */
  if (id) {
    if (contestQuery.isLoading) {
      return (
        <div className="space-y-3 p-4 max-w-md mx-auto">
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-28 w-full rounded-2xl" />
        </div>
      );
    }

    const c = contestQuery.data;
    if (!c) return <Empty title="Battle not found" hint="It may have been settled or expired." />;

    const me = c.players?.find((p) => p.isYou);
    const inBattle = Boolean(me);
    const bothSeated = (c.players?.length || 0) === 2;
    const isTerminal = ["approved", "cancelled", "expired"].includes(c.status);
    const winner = c.winnerUserId ? c.players?.find((p) => String(p.userId) === String(c.winnerUserId)) : null;
    const youWon = Boolean(winner && winner.isYou);

    return (
      <div className="max-w-md mx-auto p-4 space-y-4 text-slate-950">
        {/* Notice Banner */}
        <div className="overflow-hidden rounded-xl bg-black p-3.5 text-[11px] leading-relaxed text-white shadow-md">
          LPLUDO में आपका स्वागत है, सबसे Fast ⏩ विथड्रॉ है, 👉 मात्र 2-3 Min में। LPLUDO का APP आ गया है! 🙏
        </div>

        {/* Contest Header / Prize Card */}
        <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-card">
          <div className="game-thumb-container flex h-24 items-center justify-between px-5 bg-slate-900 text-white">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-indigo-300">Classic Ludo Battle</p>
              <p className="mt-0.5 text-2xl font-black">
                {formatPaise(c.stake * 2, { withSymbol: false })}
                <span className="ml-1 text-xs font-bold text-white/60">pool</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11px] font-bold uppercase tracking-wide text-white/50">Winner Prize</p>
              <p className="text-xl font-black text-emerald-400">{formatPaise(c.prize)}</p>
            </div>
          </div>
          <div className="flex items-center justify-between px-4 py-3 bg-slate-50">
            <div className="flex items-center gap-2">
              <StatusBadge status={c.status} />
              {!bothSeated && !isTerminal && <span className="text-[11px] font-bold text-slate-400">Seat 2 Open</span>}
            </div>
            <span className="text-xs font-bold text-slate-600">Entry: {formatPaise(c.stake)}</span>
          </div>
        </section>

        {/* Status Messages */}
        {c.status === "approved" && (
          <div className={`rounded-2xl border px-4 py-3.5 text-sm font-bold ${youWon ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-gray-200 bg-gray-50 text-slate-600"}`}>
            {youWon ? `🏆 You won ${formatPaise(c.prize)}!` : `Settled — ${winner?.name || "opponent"} won ${formatPaise(c.prize)}.`}
          </div>
        )}
        {c.status === "cancelled" && (
          <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3.5 text-sm font-bold text-slate-600">
            Battle cancelled — stakes refunded.
          </div>
        )}
        {c.status === "expired" && (
          <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3.5 text-sm font-bold text-slate-600">
            Battle expired — stake refunded.
          </div>
        )}
        {c.status === "cancel_requested" && (
          <div className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3.5 text-sm font-bold text-orange-700">
            Cancellation requested — an admin will review it.
          </div>
        )}
        {c.conflict && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3.5 text-sm font-bold text-rose-700">
            ⚠️ Conflict reported! Admin is reviewing proof screenshots.
          </div>
        )}

        {/* Waiting / Open Battle State */}
        {c.status === "open" && (
          <Panel title={inBattle ? "Waiting for Opponent" : "Open Battle"}>
            {inBattle ? (
              <div className="space-y-3">
                <p className="rounded-xl bg-indigo-50 px-3 py-2.5 text-xs font-bold text-indigo-700">
                  Your stake is on hold. Share the battle link — it stays open for 10 minutes.
                </p>
                <Button variant="ghost" className="w-full text-rose-600 font-bold" onClick={() => cancelBattle(c.id)} loading={busy === "cancel"}>
                  Cancel Battle & Refund
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-slate-500">
                  Joining puts {formatPaise(c.stake)} on hold until settlement.
                </p>
                <Button className="w-full bg-emerald-600 text-white font-bold" onClick={() => join(c.id)} loading={busy === "join"}>
                  Join for {formatPaise(c.stake)}
                </Button>
              </div>
            )}
          </Panel>
        )}

        {/* Players List */}
        <Panel title="Players">
          <div className="space-y-2">
            {[1, 2].map((seat) => {
              const p = c.players?.find((x) => x.seat === seat);
              return (
                <div key={seat} className={`flex items-center justify-between rounded-xl border px-3 py-2.5 ${p?.isYou ? "border-indigo-200 bg-indigo-50/50" : "border-gray-200 bg-gray-50"}`}>
                  <div className="flex items-center gap-2.5">
                    <div className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-black text-white ${p ? "bg-slate-800" : "bg-gray-300"}`}>
                      {p?.name?.[0]?.toUpperCase() || "?"}
                    </div>
                    <div>
                      <p className="text-sm font-black text-slate-800">{p?.name || "Waiting…"}</p>
                      <p className="text-[11px] font-bold text-slate-400">Seat {seat}{p?.isYou ? " · You" : ""}</p>
                    </div>
                  </div>
                  {p && winner && String(winner.userId) === String(p.userId) && (
                    <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-black uppercase text-emerald-700">WINNER</span>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>

        {/* Room Code Form / Display */}
        {(c.status === "running" || c.status === "room_submitted" || c.status === "result_submitted") && inBattle && (
          <Panel title="Room Code">
            {c.roomCode ? (
              <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 p-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-amber-800">Ludo King Room Code</p>
                  <p className="font-mono text-lg font-black tracking-widest text-slate-900">{c.roomCode}</p>
                </div>
                <Button variant="ghost" onClick={() => { navigator.clipboard?.writeText(c.roomCode); toast.success("Code copied!"); }}>
                  Copy Code
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <Input
                  label="Enter Room Code from Ludo King"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                  placeholder="e.g. 01234567"
                />
                <Button className="w-full" onClick={submitRoom} loading={busy === "room"} disabled={!roomCode.trim()}>
                  Share Room Code
                </Button>
              </div>
            )}
          </Panel>
        )}

        {/* Result Submission Section */}
        {(c.status === "running" || c.status === "room_submitted") && inBattle && (
          <Panel title="Report Match Result">
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setOutcome("won")}
                  className={`rounded-xl py-3 text-xs font-black uppercase text-white transition-all ${outcome === "won" ? "bg-emerald-600 ring-4 ring-emerald-300" : "bg-emerald-600/70"}`}
                >
                  I Won
                </button>
                <button
                  type="button"
                  onClick={() => { setOutcome("lost"); setScreenshot(null); setScreenshotName(""); }}
                  className={`rounded-xl py-3 text-xs font-black uppercase text-white transition-all ${outcome === "lost" ? "bg-rose-600 ring-4 ring-rose-300" : "bg-rose-600/70"}`}
                >
                  I Lost
                </button>
                <button
                  type="button"
                  onClick={() => { setOutcome("cancel"); setScreenshot(null); setScreenshotName(""); }}
                  className={`rounded-xl py-3 text-xs font-black uppercase text-white transition-all ${outcome === "cancel" ? "bg-slate-600 ring-4 ring-slate-300" : "bg-slate-600/70"}`}
                >
                  Cancel
                </button>
              </div>

              {(outcome === "won" || outcome === "lost") && (
                <div>
                  <input ref={screenshotRef} type="file" accept="image/*" className="hidden" onChange={(e) => pickScreenshot(e.target.files?.[0])} />
                  <div className="flex items-center justify-between rounded-xl border p-3 bg-gray-50">
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold uppercase text-slate-400">
                        {outcome === "won" ? "Winning Screenshot (Required)" : "Screenshot (Optional)"}
                      </p>
                      <p className="truncate text-xs font-bold text-slate-700">{screenshotName || "No file chosen"}</p>
                    </div>
                    <Button variant="ghost" type="button" onClick={() => screenshotRef.current?.click()}>
                      {screenshot ? "Replace" : "Upload"}
                    </Button>
                  </div>
                </div>
              )}

              <Button
                className="w-full"
                onClick={submitResultReport}
                loading={busy === "result"}
                disabled={!outcome || (outcome === "won" && !screenshot)}
              >
                Submit Result
              </Button>
            </div>
          </Panel>
        )}

        {/* Back Link */}
        <div className="text-center pt-2">
          <button type="button" onClick={() => navigate("/")} className="text-xs font-extrabold text-slate-500 hover:underline">
            ← Back to Battles Lobby
          </button>
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------------------------- */
  /*                 2. LOBBY / BATTLES LIST VIEW (Main Route)                   */
  /* -------------------------------------------------------------------------- */
  const openContests = openContestsQuery.data || [];
  const runningContests = runningContestsQuery.data || [];

  return (
    <div className="min-h-screen bg-[#eef3ff] px-3 pb-28 pt-6 text-slate-950">
      <div className="mx-auto max-w-md space-y-4">
        {/* LPLudo Notice Header */}
        <div className="text-[11px] leading-relaxed text-white px-4 py-3 rounded-xl bg-black shadow-md">
          LPLUDO में आपका स्वागत है, सबसे Fast ⏩ विथड्रॉ है, 👉 मात्र 2-3 Min में। LPLUDO का APP आ गया है; आप इसे Download कर सकते हैं! 🙏
        </div>

        <h2 className="text-center text-base font-black uppercase text-slate-800">Create Battle</h2>

        {/* Create Input Box */}
        <div className="mx-2 rounded-[50px] bg-white p-2 shadow-md ring-1 ring-slate-200 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-sm font-bold">₹</div>
          <input
            type="number"
            placeholder="Enter Amount (e.g. 50, 100)"
            className="min-w-0 flex-1 bg-transparent py-2 text-sm font-bold outline-none"
            value={betAmount}
            onChange={(e) => setBetAmount(e.target.value)}
          />
          <button
            disabled={busy === "create"}
            onClick={handleCreate}
            className="rounded-full bg-slate-900 px-5 py-2 text-xs font-black text-white active:scale-95 disabled:opacity-60"
          >
            {busy === "create" ? "..." : "Set"}
          </button>
        </div>

        {/* Open Battles Section */}
        <div className="space-y-2 pt-2">
          <h3 className="text-sm font-black uppercase text-slate-800 flex items-center gap-1">
            Open Battles ⚔️
          </h3>

          {openContestsQuery.isLoading ? (
            <Skeleton className="h-16 w-full rounded-xl" />
          ) : openContests.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 p-6 text-center text-xs font-black text-slate-400">
              NO OPEN BATTLES AVAILABLE
            </div>
          ) : (
            openContests.map((b) => (
              <div key={b.id} className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200 p-3 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Entry Fee</p>
                  <p className="text-sm font-black text-slate-800">{formatPaise(b.stake)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Prize Pool</p>
                  <p className="text-sm font-black text-emerald-600">{formatPaise(b.prize)}</p>
                </div>
                <button
                  disabled={busy === "join"}
                  onClick={() => join(b.id)}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-black text-white active:scale-95 disabled:opacity-50"
                >
                  PLAY
                </button>
              </div>
            ))
          )}
        </div>

        {/* Running Battles Section */}
        <div className="space-y-2 pt-2">
          <h3 className="text-sm font-black uppercase text-slate-800 flex items-center gap-1">
            Running Battles ⚔️
          </h3>

          {runningContestsQuery.isLoading ? (
            <Skeleton className="h-16 w-full rounded-xl" />
          ) : runningContests.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 p-6 text-center text-xs font-black text-slate-400">
              NO RUNNING BATTLES
            </div>
          ) : (
            runningContests.map((b) => (
              <div key={b.id} className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200 p-3 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase">
                    {b.players?.[0]?.name || "Player 1"} vs {b.players?.[1]?.name || "Player 2"}
                  </p>
                  <p className="text-xs font-black text-slate-800">Prize: {formatPaise(b.prize)}</p>
                </div>
                <button
                  onClick={() => navigate(`/battle/${b.id}`)}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm"
                >
                  VIEW
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
