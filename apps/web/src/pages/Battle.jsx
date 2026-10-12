import React, { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
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
  const [roomCode, setRoomCode] = useState("");
  const [busy, setBusy] = useState(null); // "create" | "join" | "room" | "result" | "cancel"
  const [reported, setReported] = useState(null);

  // Result Reporting + Screenshot Proof State
  const [outcome, setOutcome] = useState("");
  const [screenshot, setScreenshot] = useState(null);
  const [screenshotName, setScreenshotName] = useState("");

  /* -------------------------------------------------------------------------- */
  /*                            API QUERIES / MOCK                              */
  /* -------------------------------------------------------------------------- */

  // Fetch Single Contest Details for the room view
  const contestQuery = useQuery({
    queryKey: ["contest", id],
    queryFn: async () => {
      // If the ID matches one of our generated fake IDs, return mock data for presentation
      if (id && id.startsWith("fake-")) {
        const index = parseInt(id.replace("fake-", ""), 10) || 1;
        const names = ["Rahul Sharma", "Amit Kumar", "Priya Singh", "Rohit Verma", "Ankit Gupta", "Neha Verma", "Vikas Yadav", "Deepak Kumar", "Pooja Sharma", "Sunil Kumar", "Manish Kumar", "Sandeep Singh", "Ajay Kumar", "Kiran Rao", "Vijay Kumar"];
        const name1 = names[(index * 3) % names.length];
        const name2 = names[(index * 7) % names.length];
        const stakeAmount = ((index % 5) + 1) * 10000; // in paise
        return {
          id: id,
          status: "running",
          stake: stakeAmount,
          prize: stakeAmount * 2,
          roomCode: String(10000000 + index * 12345).slice(0, 8),
          players: [
            { seat: 1, userId: "u1", name: name1, isYou: false },
            { seat: 2, userId: "u2", name: name2, isYou: true },
          ],
        };
      }
      return api(`/contests/${id}`).then((r) => r.contest);
    },
    enabled: Boolean(id),
    refetchInterval: 15_000,
  });

  /* -------------------------------------------------------------------------- */
  /*                            WEBSOCKET LISTENERS                             */
  /* -------------------------------------------------------------------------- */
  useEffect(() => {
    if (!socket.connected) socket.connect();

    function watch() {
      if (id) {
        socket.emit("watch:contest", { contestId: id }, () => {});
      } else {
        socket.emit("subscribe:contests", {}, () => {});
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
    socket.on("contest:list-changed", handleUpdate);
    socket.on("contest:created", handleUpdate);

    watch();

    return () => {
      socket.off("connect", watch);
      socket.off("contest:updated", handleUpdate);
      socket.off("contest:list-changed", handleUpdate);
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
  /*                            ACTION HANDLERS                                 */
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

  const join = (targetId = id) =>
    run(
      "join",
      async () => {
        if (targetId.startsWith("fake-")) {
          navigate(`/battle/${targetId}`);
          return;
        }
        await api(`/contests/${targetId}/join`, { method: "POST" });
        if (targetId !== id) navigate(`/battle/${targetId}`);
      },
      "Join request sent — waiting for the creator to accept"
    );

  const accept = (targetId = id) =>
    run(
      "accept",
      () => (targetId.startsWith("fake-") ? Promise.resolve() : api(`/contests/${targetId}/accept`, { method: "POST" })),
      "Battle started!"
    );

  const rejectJoin = (targetId = id) =>
    run(
      "reject",
      () => (targetId.startsWith("fake-") ? Promise.resolve() : api(`/contests/${targetId}/reject`, { method: "POST" })),
      "Join request declined"
    );

  const submitRoom = () =>
    run(
      "room",
      () =>
        id.startsWith("fake-")
          ? Promise.resolve()
          : api(`/contests/${id}/room`, {
              method: "POST",
              body: { roomCode: roomCode.trim().toUpperCase() },
            }),
      "Room code shared!"
    );

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
        if (!id.startsWith("fake-")) {
          await api(`/contests/${id}/result`, {
            method: "POST",
            body: { outcome, screenshotKeys },
          });
        }
        setReported(outcome);
      },
      outcome === "cancel" ? "Cancellation requested" : "Result reported successfully!"
    );
  };

  const cancelBattle = (targetId = id) =>
    run(
      "cancel",
      () => (targetId.startsWith("fake-") ? Promise.resolve() : api(`/contests/${targetId}/cancel`, { method: "POST" })),
      "Battle cancelled — amount refunded"
    );

  function pickScreenshot(file) {
    if (!file) return;
    setScreenshot(file);
    setScreenshotName(file.name);
  }

  /* -------------------------------------------------------------------------- */
  /*                  1. BATTLE ROOM VIEW (When Route has :id)                  */
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
    const isCreator = Boolean(c.players?.find((p) => p.seat === 1)?.isYou);
    const winner = c.winnerUserId ? c.players?.find((p) => String(p.userId) === String(c.winnerUserId)) : null;
    const youWon = Boolean(winner && winner.isYou);
    const myReport = Boolean((c.resultReports || []).some((r) => String(r.userId) === String(me?.userId)));
    const resultOpen = ["running", "room_submitted", "result_submitted", "cancel_requested"].includes(c.status);

    return (
      <div className="max-w-md mx-auto p-4 space-y-4 text-slate-950">
        {/* Battle header — both players + entry/winning amounts */}
        <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-card">
          <div className="flex items-start justify-between gap-2 bg-slate-900 px-4 py-4 text-white">
            <PlayerHead player={c.players?.find((p) => p.seat === 1)} />
            <div className="flex flex-col items-center gap-1.5 pt-4">
              <span className="text-xs font-black tracking-[0.3em] text-white/40">VS</span>
              <StatusBadge status={c.status} />
            </div>
            <PlayerHead player={c.players?.find((p) => p.seat === 2)} />
          </div>
          <div className="flex items-center justify-between px-5 py-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Entry amount</p>
              <p className="text-base font-black text-slate-800">{formatPaise(c.stake)}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Winning amount</p>
              <p className="text-base font-black text-emerald-600">{formatPaise(c.prize)}</p>
            </div>
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
            Battle cancelled — amounts refunded.
          </div>
        )}
        {c.status === "expired" && (
          <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3.5 text-sm font-bold text-slate-600">
            Battle expired — amount refunded.
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
                  No amount is deducted yet. Your {formatPaise(c.stake)} is locked only when you accept an opponent.
                </p>
                <Button variant="ghost" className="w-full text-rose-600 font-bold" onClick={() => cancelBattle(c.id)} loading={busy === "cancel"}>
                  Cancel Battle
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-slate-500">
                  Joining sends a request — {formatPaise(c.stake)} is only locked once the creator accepts.
                </p>
                <Button className="w-full bg-emerald-600 text-white font-bold" onClick={() => join(c.id)} loading={busy === "join"}>
                  Join for {formatPaise(c.stake)}
                </Button>
              </div>
            )}
          </Panel>
        )}

        {c.status === "join_requested" && (
          <Panel title={isCreator ? "Opponent Found" : "Join Requested"}>
            {isCreator ? (
              <div className="space-y-3">
                <p className="rounded-xl bg-indigo-50 px-3 py-2.5 text-xs font-bold text-indigo-700">
                  Accept to start the match — both players' {formatPaise(c.stake)} amount is locked at that moment.
                </p>
                <Button className="w-full bg-emerald-600 text-white font-bold" onClick={() => accept(c.id)} loading={busy === "accept"} disabled={busy === "accept"}>
                  Accept &amp; Start
                </Button>
                <Button variant="ghost" className="w-full text-rose-600 font-bold" onClick={() => rejectJoin(c.id)} loading={busy === "reject"}>
                  Decline
                </Button>
              </div>
            ) : (
              <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-xs font-bold text-amber-700">
                Waiting for the creator to accept…
              </p>
            )}
          </Panel>
        )}

        {/* Room Code */}
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
            ) : isCreator ? (
              <div className="space-y-2">
                <Input
                  label="Enter Room Code from Ludo King"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
                  placeholder="8-digit code"
                  inputMode="numeric"
                  maxLength={8}
                />
                <Button className="w-full" onClick={submitRoom} loading={busy === "room"} disabled={roomCode.length !== 8}>
                  Share Room Code
                </Button>
              </div>
            ) : (
              <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-xs font-bold text-amber-700">
                Waiting for the creator to share the room code…
              </p>
            )}
          </Panel>
        )}

        {/* Rules */}
        <Panel title="Rules">
          <ul className="list-disc space-y-1.5 pl-5 text-xs font-semibold leading-relaxed text-slate-600">
            <li>Both players must join the same Ludo King room with the code above.</li>
            <li>Do not leave a running match — leaving before it ends counts as a loss.</li>
            <li>Only a win claim needs a screenshot of the final result; a loss needs no proof.</li>
            <li>Any dispute is reviewed by an admin and settled shortly.</li>
            <li>Play fair — cheating leads to a penalty and account suspension.</li>
          </ul>
        </Panel>

        {/* Result Submission */}
        {inBattle && !myReport && resultOpen && (
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

              {outcome === "won" && (
                <div className="flex items-center justify-between rounded-xl border border-gray-200 p-3 bg-gray-50">
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase text-slate-400">Winning screenshot (required)</p>
                    <p className="truncate text-xs font-bold text-slate-700">{screenshotName || "No file chosen"}</p>
                  </div>
                  <label className="inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full bg-gray-100 px-4 py-2 text-xs font-extrabold text-slate-700 transition-all hover:bg-gray-200 active:scale-95">
                    {screenshot ? "Replace" : "Upload"}
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        pickScreenshot(file);
                      }}
                    />
                  </label>
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

        {inBattle && myReport && resultOpen && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-sm font-bold text-amber-700">
            Your result is submitted — waiting for the other player / admin.
          </div>
        )}

        <div className="text-center pt-2">
          <button type="button" onClick={() => navigate("/battle")} className="text-xs font-extrabold text-slate-500 hover:underline">
            ← Back to Battles Lobby
          </button>
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------------------------- */
  /*          2. BATTLES LOBBY VIEW (List of 15 Fake Running Battles)           */
  /* -------------------------------------------------------------------------- */
  const fakeBattles = Array.from({ length: 15 }, (_, i) => {
    const idNum = i + 1;
    const names = ["Rahul Sharma", "Amit Kumar", "Priya Singh", "Rohit Verma", "Ankit Gupta", "Neha Verma", "Vikas Yadav", "Deepak Kumar", "Pooja Sharma", "Sunil Kumar", "Manish Kumar", "Sandeep Singh", "Ajay Kumar", "Kiran Rao", "Vijay Kumar"];
    const name1 = names[(i * 3) % names.length];
    const name2 = names[(i * 7) % names.length];
    const stakeAmount = ((i % 5) + 1) * 10000; // e.g. ₹100, ₹200, ₹300, ₹400, ₹500
    return {
      id: `fake-${idNum}`,
      status: "running",
      stake: stakeAmount,
      prize: stakeAmount * 2,
      players: [
        { seat: 1, name: name1 },
        { seat: 2, name: name2 },
      ],
    };
  });

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-black tracking-tight text-slate-900">Live Running Battles</h2>
        <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-700 animate-pulse">15 Active</span>
      </div>

      <div className="flex flex-col gap-3">
        {fakeBattles.map((b) => (
          <div key={b.id} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-card space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
                <span className="text-xs font-extrabold text-slate-700">{b.players[0].name} vs {b.players[1].name}</span>
              </div>
              <StatusBadge status={b.status} />
            </div>

            <div className="flex items-center justify-between border-t border-gray-50 pt-3">
              <div>
                <p className="text-[10px] font-bold uppercase text-slate-400">Entry / Prize</p>
                <p className="text-sm font-black text-slate-900">{formatPaise(b.stake)} <span className="text-emerald-600 font-bold">({formatPaise(b.prize)})</span></p>
              </div>
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold" onClick={() => navigate(`/battle/${b.id}`)}>
                Watch / View
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** one side of the battle header — avatar (real or generated) + name */
function PlayerHead({ player }) {
  const name = player?.name || "Waiting…";
  return (
    <div className="flex w-24 flex-col items-center gap-1">
      <div className="h-14 w-14 overflow-hidden rounded-full bg-slate-700 ring-2 ring-white/20">
        <img
          src={player?.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name)}`}
          alt={name}
          className="h-full w-full object-cover"
        />
      </div>
      <p className="w-full truncate text-center text-xs font-black">{name}</p>
      {player?.isYou && <p className="text-[10px] font-bold text-white/40">You</p>}
    </div>
  );
}
