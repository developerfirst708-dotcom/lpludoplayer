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

  const [betAmount, setBetAmount] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [busy, setBusy] = useState(null); // "create" | "join" | "room" | "result" | "cancel"
  const [outcome, setOutcome] = useState("");
  const [screenshot, setScreenshot] = useState(null);
  const [screenshotName, setScreenshotName] = useState("");
  const screenshotRef = useRef(null);

  // Fetch open battles list when in lobby view
  const openContestsQuery = useQuery({
    queryKey: ["contests", "open"],
    queryFn: () => api("/contests?status=open").then((r) => r.contests || []),
    enabled: !id,
    refetchInterval: 10_000
  });

  // Fetch running battles list when in lobby view
  const runningContestsQuery = useQuery({
    queryKey: ["contests", "running"],
    queryFn: () => api("/contests?status=running").then((r) => r.contests || []),
    enabled: !id,
    refetchInterval: 10_000
  });

  // Fetch individual battle details when viewing room/battle ID
  const contestQuery = useQuery({
    queryKey: ["contest", id],
    queryFn: () => api(`/contests/${id}`).then((r) => r.contest),
    enabled: Boolean(id),
    refetchInterval: 15_000
  });

  // Real-time WebSockets
  useEffect(() => {
    if (!socket.connected) socket.connect();

    if (id) {
      socket.emit("watch:contest", { contestId: id }, () => {});
    }

    function handleContestUpdate(upd) {
      if (id && String(upd?.id) === String(id)) {
        qc.invalidateQueries({ queryKey: ["contest", id] });
      }
      qc.invalidateQueries({ queryKey: ["contests"] });
      qc.invalidateQueries({ queryKey: ["wallet"] });
    }

    socket.on("contest:updated", handleContestUpdate);
    socket.on("contest:created", handleContestUpdate);

    return () => {
      socket.off("contest:updated", handleContestUpdate);
      socket.off("contest:created", handleContestUpdate);
    };
  }, [id, qc]);

  useEffect(() => {
    if (contestQuery.isError) {
      toast.error(contestQuery.error?.message || "Battle not found");
      navigate("/battle");
    }
  }, [contestQuery.isError, navigate, toast]);

  // Generic runner for async requests
  async function run(action, fn, okMessage) {
    setBusy(action);
    try {
      const res = await fn();
      if (okMessage) toast.success(okMessage);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["contest", id] }),
        qc.invalidateQueries({ queryKey: ["contests"] }),
        qc.invalidateQueries({ queryKey: ["wallet"] })
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
    if (!amt || amt < 50) return toast.error("Min battle ₹50");
    if (amt > 100000) return toast.error("Max battle ₹100,000");
    if (amt % 50 !== 0) return toast.error("Amount must be in multiples of ₹50");

    return run("create", async () => {
      const data = await api("/contests", {
        method: "POST",
        body: { stake: amt * 100 } // Paise conversion
      });
      setBetAmount("");
      if (data?.contest?.id) {
        navigate(`/battle/${data.contest.id}`);
      }
    }, "Battle created successfully!");
  };

  // Join Battle Action
  const joinBattle = (targetId) =>
    run("join", async () => {
      await api(`/contests/${targetId}/join`, { method: "POST" });
      navigate(`/battle/${targetId}`);
    }, "Joined battle successfully!");

  // Submit Room Code
  const submitRoom = () => {
    if (!roomCode.trim()) return toast.error("Enter a valid Room Code");
    return run("room", () =>
      api(`/contests/${id}/room`, {
        method: "POST",
        body: { roomCode: roomCode.trim() }
      }),
      "Room code shared!"
    );
  };

  // Submit Match Result
  const submitResultReport = () => {
    if (!outcome) return toast.error("Select result outcome");
    if (outcome === "won" && !screenshot) {
      return toast.error("Upload winning screenshot proof first");
    }

    return run("result", async () => {
      let screenshotKeys = [];
      if (screenshot) {
        const compressed = await compressImage(screenshot);
        const { key } = await apiUpload("/uploads", compressed, "battle");
        screenshotKeys = [key];
      }
      await api(`/contests/${id}/result`, {
        method: "POST",
        body: { outcome, screenshotKeys }
      });
    }, outcome === "cancel" ? "Cancellation requested" : "Result reported successfully!");
  };

  // Cancel Battle Action
  const cancelBattle = (targetId = id) =>
    run("cancel", () => api(`/contests/${targetId}/cancel`, { method: "POST" }), "Battle cancelled & stake refunded");

  function pickScreenshot(file) {
    if (!file) return;
    setScreenshot(file);
    setScreenshotName(file.name);
  }

  // Direct Battle Room View
  if (id) {
    if (contestQuery.isLoading) {
      return (
        <div className="space-y-3 p-4">
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-28 w-full rounded-2xl" />
        </div>
      );
    }

    const c = contestQuery.data;
    if (!c) return <Empty title="Battle not found" hint="It may have been settled or expired." />;

    const me = c.players?.find((p) => p.isYou);
    const bothSeated = (c.players?.length || 0) === 2;
    const isTerminal = ["approved", "cancelled", "expired"].includes(c.status);
    const winner = c.winnerUserId ? c.players?.find((p) => String(p.userId) === String(c.winnerUserId)) : null;
    const youWon = Boolean(winner && winner.isYou);

    return (
      <div className="max-w-md mx-auto p-4 space-y-4">
        {/* Banner */}
        <div className="overflow-hidden rounded-xl bg-black p-4 text-xs leading-relaxed text-white shadow-md">
          ADDA LUDO में आपका स्वागत है, सबसे Fast ⏩ विथड्रॉ है, 👉 मात्र 2-3 Min में। ADDA LUDO का APP आ गया है, आप इसे Download कर सकते हैं। 🙏
        </div>

        {/* Stake Summary Card */}
        <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-md">
          <div className="bg-gradient-to-r from-slate-900 to-indigo-950 p-5 flex items-center justify-between text-white">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-300">Classic Ludo 1v1</p>
              <p className="mt-0.5 text-2xl font-black">
                {formatPaise(c.stake * 2, { withSymbol: false })}
                <span className="ml-1 text-xs font-bold text-white/60">pool</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11px] font-bold uppercase tracking-wider text-white/50">Prize Pool</p>
              <p className="text-xl font-black text-emerald-400">{formatPaise(c.prize)}</p>
            </div>
          </div>
          <div className="flex items-center justify-between px-4 py-3 bg-gray-50">
            <div className="flex items-center gap-2">
              <StatusBadge status={c.status} />
              {!bothSeated && !isTerminal && <span className="text-[11px] font-bold text-slate-400">Waiting for Opponent</span>}
            </div>
            <span className="text-xs font-bold text-slate-600">Entry: {formatPaise(c.stake)}</span>
          </div>
        </section>

        {/* Settlement Messages */}
        {c.status === "approved" && (
          <div className={`rounded-2xl border px-4 py-3.5 text-sm font-bold ${youWon ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-gray-200 bg-gray-50 text-slate-600"}`}>
            {youWon ? `🏆 You won ${formatPaise(c.prize)}!` : `Settled — ${winner?.name || "Opponent"} won ${formatPaise(c.prize)}.`}
          </div>
        )}
        {c.status === "cancelled" && (
          <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3.5 text-sm font-bold text-slate-600">
            Battle cancelled — stakes refunded.
          </div>
        )}
        {c.conflict && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3.5 text-sm font-bold text-rose-700">
            ⚠️ Conflict reported! Admin is reviewing proof screenshots.
          </div>
        )}

        {/* Room Code Section */}
        {bothSeated && !isTerminal && (
          <Panel title="Room Code">
            {c.roomCode ? (
              <div className="flex items-center justify-between rounded-xl bg-slate-100 p-3">
                <span className="text-lg font-black text-slate-900 tracking-wider">{c.roomCode}</span>
                <Button onClick={() => { navigator.clipboard.writeText(c.roomCode); toast.success("Code copied!"); }}>
                  Copy Code
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <Input
                  placeholder="Enter Ludo King Room Code"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value)}
                />
                <Button disabled={busy === "room"} onClick={submitRoom} className="w-full">
                  {busy === "room" ? "Sharing..." : "Share Room Code"}
                </Button>
              </div>
            )}
          </Panel>
        )}

        {/* Result Submission Section */}
        {bothSeated && !isTerminal && (
          <Panel title="Match Outcome & Proof">
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setOutcome("won")}
                  className={`rounded-xl border py-2.5 text-xs font-black uppercase ${outcome === "won" ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-gray-200 text-slate-600"}`}
                >
                  I Won
                </button>
                <button
                  type="button"
                  onClick={() => setOutcome("lost")}
                  className={`rounded-xl border py-2.5 text-xs font-black uppercase ${outcome === "lost" ? "border-rose-500 bg-rose-50 text-rose-700" : "border-gray-200 text-slate-600"}`}
                >
                  I Lost
                </button>
                <button
                  type="button"
                  onClick={() => setOutcome("cancel")}
                  className={`rounded-xl border py-2.5 text-xs font-black uppercase ${outcome === "cancel" ? "border-amber-500 bg-amber-50 text-amber-700" : "border-gray-200 text-slate-600"}`}
                >
                  Cancel
                </button>
              </div>

              {outcome === "won" && (
                <div>
                  <input
                    type="file"
                    accept="image/*"
                    ref={screenshotRef}
                    className="hidden"
                    onChange={(e) => pickScreenshot(e.target.files?.[0])}
                  />
                  <Button variant="outline" className="w-full" onClick={() => screenshotRef.current?.click()}>
                    📸 {screenshotName || "Upload Winning Screenshot"}
                  </Button>
                </div>
              )}

              {outcome && (
                <Button disabled={busy === "result"} onClick={submitResultReport} className="w-full">
                  {busy === "result" ? "Submitting..." : "Submit Result"}
                </Button>
              )}
            </div>
          </Panel>
        )}

        {/* Cancel option when waiting alone */}
        {c.status === "open" && me && (
          <Button variant="danger" disabled={busy === "cancel"} onClick={() => cancelBattle(c.id)} className="w-full">
            {busy === "cancel" ? "Cancelling..." : "Cancel Battle"}
          </Button>
        )}
      </div>
    );
  }

  // Lobby View (Lists real open & running battles)
  const openContests = openContestsQuery.data || [];
  const runningContests = runningContestsQuery.data || [];

  return (
    <div className="min-h-screen bg-[#eef3ff] px-3 pb-28 pt-6 text-slate-950">
      <div className="mx-auto max-w-md space-y-4">
        {/* Banner Box */}
        <div className="text-[12px] text-white px-5 py-3 rounded-lg bg-black shadow-md">
          ADDA LUDO में आपका स्वागत है, सबसे Fast ⏩ विथड्रॉ है, 👉 मात्र 2-3 Min में, 👈 ADDA LUDO का APP आ गया है; आप इसे Download कर सकते हैं। आपका विश्वास बनाये रखे 🙏
        </div>

        <h2 className="text-center text-base font-bold">Create Battle</h2>

        {/* Create Battle Input Form */}
        <div className="mx-6 rounded-[50px] bg-white p-2 shadow-md ring-1 ring-slate-200 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-md text-base font-semibold">₹</div>
          <input
            type="number"
            placeholder="Enter Amount"
            className="min-w-0 flex-1 bg-transparent py-2 text-sm font-semibold outline-none"
            value={betAmount}
            onChange={(e) => setBetAmount(e.target.value)}
          />
          <button
            disabled={busy === "create"}
            onClick={handleCreate}
            className="rounded-md bg-slate-900 px-4 py-2 text-xs font-bold text-white active:scale-95 disabled:opacity-60"
          >
            {busy === "create" ? "..." : "Set"}
          </button>
        </div>

        {/* Open Battles List */}
        <div className="space-y-2">
          <h3 className="text-sm font-black uppercase text-slate-800 flex items-center gap-1">
            Open Battles ⚔️
          </h3>

          {openContests.length === 0 ? (
            <div className="rounded-[24px] border border-dashed border-slate-300 bg-white/70 p-6 text-center text-xs font-black text-slate-400">
              NO BATTLES LIVE
            </div>
          ) : (
            openContests.map((battle) => (
              <div key={battle.id} className="overflow-hidden rounded-xl bg-white shadow-md ring-1 ring-slate-200 p-3 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-semibold text-gray-500">Entry Fee</p>
                  <p className="text-sm font-bold">{formatPaise(battle.stake)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-gray-500">Winning</p>
                  <p className="text-sm font-bold text-emerald-600">{formatPaise(battle.prize)}</p>
                </div>
                <button
                  disabled={busy === "join"}
                  onClick={() => joinBattle(battle.id)}
                  className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-black text-white active:scale-95 disabled:opacity-50"
                >
                  PLAY
                </button>
              </div>
            ))
          )}
        </div>

        {/* Real Running Battles List */}
        <div className="space-y-2 pt-2">
          <h3 className="text-sm font-black uppercase text-slate-800 flex items-center gap-1">
            Running Battles ⚔️
          </h3>

          {runningContests.length === 0 ? (
            <div className="rounded-[24px] border border-dashed border-slate-300 bg-white/70 p-6 text-center text-xs font-black text-slate-400">
              NO RUNNING BATTLES
            </div>
          ) : (
            runningContests.map((battle) => (
              <div key={battle.id} className="overflow-hidden rounded-xl bg-white shadow-md ring-1 ring-slate-200 p-3 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-semibold text-gray-500">
                    {battle.players?.[0]?.name || "Player 1"} vs {battle.players?.[1]?.name || "Player 2"}
                  </p>
                  <p className="text-xs font-bold">Prize: {formatPaise(battle.prize)}</p>
                </div>
                <button
                  onClick={() => navigate(`/battle/${battle.id}`)}
                  className="rounded-full bg-indigo-600 px-3 py-1 text-[10px] font-bold text-white shadow-sm"
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
