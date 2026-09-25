import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { socket } from "../lib/socket.js";
import { formatPaise } from "@lpludo/shared";
import { useToast } from "../components/Toast.jsx";
import { Button, Card, Empty, Money, Panel, SectionTitle, Skeleton, StatusBadge } from "../components/ui.jsx";
import LudoBoardArt from "../components/LudoBoardArt.jsx";

const STAKES = [5000, 10000, 25000, 50000];

/**
 * Play — the Classic Web Ludo arena that the "Play Now" pill opens. Contains
 * the stake picker (creates a battle and HOLDS the stake), the list of open
 * battles to join, and your live battles. Extracted from Home so the games
 * grid stays a pure launcher.
 */
export default function Play() {
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [stake, setStake] = useState(5000);
  const [creating, setCreating] = useState(false);
  const [joiningId, setJoiningId] = useState(null);

  const wallet = useQuery({ queryKey: ["wallet"], queryFn: () => api("/wallet") });
  const open = useQuery({
    queryKey: ["contests", "open"],
    queryFn: () => api("/contests/open"),
    refetchInterval: 15_000,
  });
  const mine = useQuery({ queryKey: ["contests", "mine"], queryFn: () => api("/contests/mine") });

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

  async function createBattle() {
    setCreating(true);
    try {
      const r = await api("/contests", { method: "POST", body: { stake } });
      toast.success("Battle created — waiting for an opponent");
      qc.invalidateQueries({ queryKey: ["contests"] });
      qc.invalidateQueries({ queryKey: ["wallet"] });
      navigate(`/battle/${r.contest.id}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function join(id) {
    setJoiningId(id);
    try {
      await api(`/contests/${id}/join`, { method: "POST" });
      toast.success("You're in — room code is next");
      qc.invalidateQueries({ queryKey: ["contests"] });
      navigate(`/battle/${id}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setJoiningId(null);
    }
  }

  const available = wallet.data ? wallet.data.availablePaise : null;
  const notEnough = available !== null && available < stake;
  const liveBattles = (mine.data?.items || []).filter((c) =>
    ["open", "running", "room_submitted", "result_submitted", "cancel_requested"].includes(c.status)
  );

  return (
    <div className="flex flex-col gap-4">
      {/* header row with a way back to the launcher */}
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => navigate("/")} className="text-xs font-extrabold text-slate-500 transition-colors hover:text-ink">
          ← Home
        </button>
        <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Classic Web Ludo</span>
      </div>

      {/* board art banner so the arena feels like the game you opened */}
      <div className="game-thumb-container flex h-28 items-center justify-center rounded-2xl">
        <LudoBoardArt className="h-24 w-auto drop-shadow-2xl" />
      </div>

      {/* ---- live battles (context: what you already have running) ---- */}
      {liveBattles.length > 0 && (
        <Panel title="Your live battles" className="border-brand-500/40 bg-brand-500/5">
          <div className="flex flex-col divide-y divide-gray-100">
            {liveBattles.map((c) => (
              <Link
                key={c.id}
                to={`/battle/${c.id}`}
                className="flex items-center justify-between py-2.5 text-sm font-bold text-slate-700"
              >
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-brand-500" />
                  Stake <Money paise={c.stake} />
                </span>
                <StatusBadge status={c.status} />
              </Link>
            ))}
          </div>
        </Panel>
      )}

      {/* ---- stake picker ---- */}
      <div>
        <Panel
          title="Choose your stake"
          action={
            <Link to="/wallet" className="text-xs font-bold text-brand-600">
              Balance <Money paise={available ?? 0} />
            </Link>
          }
        >
          <div className="grid grid-cols-4 gap-2">
            {STAKES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStake(s)}
                className={`rounded-xl border px-2 py-2.5 text-sm font-extrabold transition-all active:scale-95 ${
                  stake === s
                    ? "border-brand-500 bg-brand-500/20 text-brand-600"
                    : "border-gray-200 bg-gray-50 text-slate-600 hover:border-gray-300"
                }`}
              >
                {formatPaise(s, { withSymbol: false })}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] font-semibold text-slate-500">
            Winner gets {formatPaise(stake * 2 - Math.floor((stake * 2 * 500) / 10000))} · 5% platform fee
          </p>
          <Button className="mt-3 w-full" onClick={createBattle} loading={creating} disabled={notEnough}>
            Create &amp; hold {formatPaise(stake)}
          </Button>
          {notEnough && <p className="mt-2 text-center text-[11px] font-bold text-rose-600">Add funds to play this stake</p>}
        </Panel>
      </div>

      {/* ---- open battles ---- */}
      <section className="flex flex-col gap-2">
        <SectionTitle title="Open battles" action={<span className="text-[11px] font-bold text-slate-400">live</span>} />
        {open.isLoading && <Skeleton className="h-20 w-full" />}
        {open.data && open.data.items.length === 0 && (
          <Empty title="No open battles" hint="Create one above — it stays open for 10 minutes." />
        )}
        {open.data?.items?.map((c) => (
          <Card key={c.id} className="flex items-center justify-between py-3.5">
            <div>
              <p className="text-base font-black text-ink">
                <Money paise={c.stake} />
              </p>
              <p className="text-[11px] font-semibold text-slate-500">Win {formatPaise(c.prize)} · 2 seats</p>
            </div>
            <Button variant="primary" onClick={() => join(c.id)} loading={joiningId === c.id} disabled={available !== null && available < c.stake}>
              Join
            </Button>
          </Card>
        ))}
      </section>
    </div>
  );
}

