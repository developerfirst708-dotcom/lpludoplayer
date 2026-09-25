import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiUpload } from "../lib/api.js";
import compressImage from "../lib/compressImage.js";
import { socket } from "../lib/socket.js";
import { formatPaise } from "@lpludo/shared";
import { useToast } from "../components/Toast.jsx";
import { Button, Empty, Input, Panel, Skeleton, StatusBadge } from "../components/ui.jsx";

/**
 * Battle room — the whole 1v1 lifecycle in one screen: waiting for an opponent,
 * the shared room code, the two result reports and the settlement.
 *
 * Endpoints (verified against contest.routes.js):
 *   GET    /contests/:id            -> { contest }
 *   POST   /contests/:id/join
 *   POST   /contests/:id/room       { roomCode }
 *   POST   /contests/:id/result     { outcome: won|lost|cancel, screenshotKeys? }
 *   POST   /contests/:id/cancel
 * Realtime: `watch:contest` joins the room, `contest:updated` carries the slim delta.
 */
export default function Battle() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();

  const [roomCode, setRoomCode] = useState("");
  const [busy, setBusy] = useState(null); // "join" | "room" | "result" | "cancel"
  const [reported, setReported] = useState(null);

  // result reporting + proof screenshot (a win claim must carry proof)
  const [outcome, setOutcome] = useState("");
  const [screenshot, setScreenshot] = useState(null);
  const [screenshotName, setScreenshotName] = useState("");
  const screenshotRef = useRef(null);

  const contest = useQuery({
    queryKey: ["contest", id],
    queryFn: () => api(`/contests/${id}`).then((r) => r.contest),
    enabled: Boolean(id),
    refetchInterval: 20_000,
  });

  // realtime: watch this battle, then patch on every slim delta
  useEffect(() => {
    if (!id) return;
    if (!socket.connected) socket.connect();
    function watch() {
      socket.emit("watch:contest", { contestId: id }, () => {});
    }
    socket.on("connect", watch);
    socket.on("contest:updated", (upd) => {
      if (String(upd.id) !== String(id)) return;
      qc.invalidateQueries({ queryKey: ["contest", id] });
      qc.invalidateQueries({ queryKey: ["contests"] });
      qc.invalidateQueries({ queryKey: ["wallet"] });
    });
    watch();
    return () => {
      socket.off("connect", watch);
      socket.off("contest:updated");
    };
  }, [id, qc]);

  useEffect(() => {
    if (contest.isError) {
      toast.error(contest.error?.message || "Battle not found");
      navigate("/");
    }
  }, [contest.isError]); // eslint-disable-line react-hooks/exhaustive-deps

  const c = contest.data;
  const me = c?.players?.find((p) => p.isYou);
  const inBattle = Boolean(me);
  const bothSeated = (c?.players?.length || 0) === 2;
  const isTerminal = ["approved", "cancelled", "expired"].includes(c?.status);

  async function run(action, fn, okMessage) {
    setBusy(action);
    try {
      await fn();
      if (okMessage) toast.success(okMessage);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["contest", id] }),
        qc.invalidateQueries({ queryKey: ["contests"] }),
        qc.invalidateQueries({ queryKey: ["wallet"] }),
      ]);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  }

  const join = () => run("join", () => api(`/contests/${id}/join`, { method: "POST" }), "You're in!");

  const submitRoom = () =>
    run("room", () => api(`/contests/${id}/room`, { method: "POST", body: { roomCode: roomCode.trim() } }), "Room code shared");

  /**
   * Result claim + proof screenshot. The picker is compressed client-side, the
   * file goes to POST /uploads (kind=battle) and only the returned storage key
   * travels with the result — the API rejects a "won" claim without one.
   */
  const submitResultReport = () => {
    if (!outcome) return;
    if (outcome === "won" && !screenshot) {
      toast.error("Upload your winning screenshot first");
      return;
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
        await api(`/contests/${id}/result`, { method: "POST", body: { outcome, screenshotKeys } });
        setReported(outcome);
      },
      outcome === "cancel" ? "Cancellation requested" : "Result reported"
    );
  };

  function pickScreenshot(file) {
    if (!file) return;
    setScreenshot(file);
    setScreenshotName(file.name);
  }

  const cancelBattle = () =>
    run("cancel", () => api(`/contests/${id}/cancel`, { method: "POST" }), "Battle cancelled — stake refunded");

  if (contest.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }


  if (!c) return <Empty title="Battle not found" hint="It may have been settled or expired." />;

  const winner = c.winnerUserId ? c.players.find((p) => String(p.userId) === String(c.winnerUserId)) : null;
  const youWon = Boolean(winner && winner.isYou);

  return (
    <div className="space-y-4">
      {/* stake summary */}
      <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-card">
        <div className="game-thumb-container flex h-24 items-center justify-between px-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-brand-300">Classic Web Ludo</p>
            <p className="mt-0.5 text-2xl font-black tracking-tight text-white">
              {formatPaise(c.stake * 2, { withSymbol: false })}
              <span className="ml-1 text-sm font-bold text-white/60">pool</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-bold uppercase tracking-wide text-white/50">Winner gets</p>
            <p className="text-xl font-black text-brand-400">{formatPaise(c.prize)}</p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <StatusBadge status={c.status} />
            {!bothSeated && !isTerminal && <span className="text-[11px] font-bold text-slate-400">seat 2 open</span>}
          </div>
          <span className="text-xs font-bold text-slate-500">Entry {formatPaise(c.stake)}</span>
        </div>
      </section>

      {/* settlement banners */}
      {c.status === "approved" && (
        <div className={`rounded-2xl border px-4 py-3.5 text-sm font-bold ${youWon ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-gray-200 bg-gray-50 text-slate-600"}`}>
          {youWon ? `You won ${formatPaise(c.prize)}!` : `Settled — ${winner?.name || "opponent"} won ${formatPaise(c.prize)}.`}
        </div>
      )}
      {c.status === "cancelled" && (
        <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3.5 text-sm font-bold text-slate-600">
          Battle cancelled — stakes refunded.
        </div>
      )}
      {c.status === "expired" && (
        <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3.5 text-sm font-bold text-slate-600">
          Battle expired — the stake was refunded.
        </div>
      )}
      {c.status === "cancel_requested" && (
        <div className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3.5 text-sm font-bold text-orange-700">
          Cancellation requested — an admin will review it shortly.
        </div>
      )}
      {c.conflict && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3.5 text-sm font-bold text-rose-700">
          A result conflict was raised. An admin is reviewing this battle.
        </div>
      )}

      {/* waiting / actions */}
      {c.status === "open" && (
        <Panel title={inBattle ? "Waiting for an opponent" : "Open battle"}>
          {inBattle ? (
            <div className="space-y-3">
              <p className="rounded-xl bg-brand-500/10 px-3 py-2.5 text-xs font-bold text-brand-600">
                Your stake is on hold. Share the app — the battle stays open for 10 minutes.
              </p>
              {c.expiresAt && (
                <p className="text-[11px] font-semibold text-slate-400">
                  Expires {new Date(c.expiresAt).toLocaleTimeString()}
                </p>
              )}
              <Button variant="ghost" className="w-full" onClick={cancelBattle} loading={busy === "cancel"}>
                Cancel battle &amp; refund
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-slate-500">
                Joining puts {formatPaise(c.stake)} on hold until the battle settles.
              </p>
              <Button className="w-full" onClick={join} loading={busy === "join"}>
                Join for {formatPaise(c.stake)}
              </Button>
            </div>
          )}
        </Panel>
      )}

      {/* players */}
      <Panel title="Players">
        <div className="space-y-2">
          {[1, 2].map((seat) => {
            const p = c.players.find((x) => x.seat === seat);
            return (
              <div key={seat} className={`flex items-center justify-between rounded-xl border px-3 py-2.5 ${p?.isYou ? "border-brand-500/40 bg-brand-500/5" : "border-gray-200 bg-gray-50"}`}>
                <div className="flex items-center gap-2.5">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-black text-white ${p ? "bg-gradient-to-br from-brand-300 via-brand-500 to-[#C98509]" : "bg-gray-300"}`}>
                    {p?.name?.[0]?.toUpperCase() || "?"}
                  </div>
                  <div>
                    <p className="text-sm font-black text-slate-700">{p?.name || "Waiting…"}</p>
                    <p className="text-[11px] font-bold text-slate-400">Seat {seat}{p?.isYou ? " · you" : ""}</p>
                  </div>
                </div>
                {p && winner && String(winner.userId) === String(p.userId) && (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold uppercase text-emerald-700">winner</span>
                )}
              </div>
            );
          })}
        </div>
      </Panel>


      {/* in-battle actions */}
      {(c.status === "running" || c.status === "room_submitted" || c.status === "result_submitted") && inBattle && (
        <Panel title="Room code">
          <div className="space-y-3">
            {c.roomCode ? (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-[#FAD655] bg-[#FEF4BA]/60 px-3 py-2.5">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-amber-700">Game room</p>
                  <p className="font-mono text-base font-black tracking-widest text-slate-800">{c.roomCode}</p>
                </div>
                <Button
                  variant="ghost"
                  className="shrink-0 px-3 py-2 text-xs"
                  onClick={() => navigator.clipboard?.writeText(c.roomCode).then(() => toast.success("Room code copied"))}
                >
                  Copy
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <Input
                  label="Enter the room code from the game"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                  placeholder="ABC123"
                />
                <Button className="w-full" onClick={submitRoom} loading={busy === "room"} disabled={!roomCode.trim()}>
                  Share room code
                </Button>
              </div>
            )}
          </div>
        </Panel>
      )}

      {(c.status === "running" || c.status === "room_submitted") && inBattle && (
        <Panel title="Report result">
          <div className="space-y-3">
            <p className="text-xs font-semibold text-slate-500">
              Both players must report the same outcome. Mismatched reports go to admin review.
            </p>

            {/* WIN / LOSS / CANCEL selector */}
            <div className="grid grid-cols-3 gap-2">
              {[
                ["won", "I won", "bg-emerald-600"],
                ["lost", "I lost", "bg-rose-600"],
                ["cancel", "Cancel", "bg-slate-600"],
              ].map(([value, label, color]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setOutcome(value);
                    if (value === "cancel") { setScreenshot(null); setScreenshotName(""); }
                  }}
                  disabled={busy !== null}
                  className={`rounded-xl py-3 text-xs font-extrabold text-white transition-all active:scale-95 disabled:opacity-60 ${color} ${
                    outcome === value ? "ring-4 ring-brand-500/60" : "opacity-80"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* proof screenshot — required to claim a win, optional on a loss */}
            {(outcome === "won" || outcome === "lost") && (
              <div className="space-y-1.5">
                <input
                  ref={screenshotRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => pickScreenshot(e.target.files?.[0])}
                />
                <div
                  className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 ${
                    outcome === "won" ? "border-[#FAD655] bg-[#FEF4BA]/40" : "border-gray-200 bg-gray-50"
                  }`}
                >
                  <div className="min-w-0">
                    <p className={`text-[11px] font-bold uppercase tracking-wide ${outcome === "won" ? "text-amber-700" : "text-slate-400"}`}>
                      {outcome === "won" ? "Winning screenshot · required" : "Screenshot · optional"}
                    </p>
                    <p className={`truncate text-xs font-bold ${screenshot ? "text-emerald-600" : "text-slate-500"}`}>
                      {busy === "result" ? "Uploading…" : screenshotName || "No file chosen"}
                    </p>
                  </div>
                  <Button variant="ghost" type="button" className="shrink-0 px-4 py-2 text-xs" onClick={() => screenshotRef.current?.click()}>
                    {screenshot ? "Replace" : "Upload"}
                  </Button>
                </div>
              </div>
            )}

            {outcome === "cancel" && (
              <p className="rounded-xl bg-rose-50 px-3 py-2.5 text-xs font-bold text-rose-700">
                A cancel request reaches admin review. The stake is refunded if the battle is called off.
              </p>
            )}

            <Button
              className="w-full"
              onClick={submitResultReport}
              loading={busy === "result"}
              disabled={busy !== null || !outcome || (outcome === "won" && !screenshot)}
            >
              Submit result
            </Button>
          </div>
        </Panel>
      )}

      {c.status === "result_submitted" && inBattle && (
        <Panel title="Waiting for settlement">
          <div className="space-y-2">
            <p className="rounded-xl bg-brand-500/10 px-3 py-2.5 text-xs font-bold text-brand-600">
              {reported ? `You reported: ${reported}. ` : ""}Both reports are in — the battle settles automatically.
            </p>
            {(c.resultReports || []).some((r) => r.screenshots?.length > 0) && (
              <p className="text-[11px] font-semibold text-slate-500">
                Proof screenshot attached — an admin can review it if the two reports disagree.
              </p>
            )}
          </div>
        </Panel>
      )}

      {!inBattle && !isTerminal && c.status !== "open" && (
        <Empty title="You're not in this battle" hint="Only the two seated players can act here." />
      )}

      {/* footer */}
      <div className="pt-1 text-center">
        <button type="button" onClick={() => navigate("/")} className="text-xs font-extrabold text-slate-500 hover:text-ink">
          ← Back to home
        </button>
      </div>
    </div>
  );
}
