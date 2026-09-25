import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api.js";
import { socket } from "../lib/socket.js";
import { rupeesToPaise, formatPaise } from "@lpludo/shared";
import { useToast } from "../components/Toast.jsx";
import { Badge, Button, Empty, Input, Panel, Skeleton, Spinner, Tabs, TabsButton, TabsList, TabsPanel } from "../components/ui.jsx";
import { CoinIcon } from "../components/art.jsx";
import GatewayDepositCard from "../components/GatewayDepositCard.jsx";

/**
 * Wallet — balances, deposits, withdrawals and the ledger, all in the shared
 * light/gold theme. Reads the real API shapes: /wallet, /wallet/history,
 * /payments/deposit/details (never computes money locally).
 */

const LEDGER_LABELS = {
  deposit: "Deposit",
  withdrawal_hold: "Withdrawal on hold",
  withdrawal_paid: "Withdrawal paid",
  withdrawal_refund: "Withdrawal refunded",
  entry_fee_hold: "Stake held",
  entry_fee_release: "Stake released",
  entry_fee_paid: "Stake played",
  entry_fee_refund: "Stake refunded",
  prize_win: "Prize won",
  referral_bonus: "Referral bonus",
  admin_adjustment: "Admin adjustment",
};

/** non-throwing paise parse — render paths must never toast */
function safePaise(input) {
  try {
    return input === "" || input === null || input === undefined ? null : rupeesToPaise(input);
  } catch {
    return null;
  }
}

export default function Wallet() {
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState("balance");
  const [amount, setAmount] = useState("");
  const [utr, setUtr] = useState("");
  const [upiId, setUpiId] = useState("");
  const [busy, setBusy] = useState(false);

  const wallet = useQuery({ queryKey: ["wallet"], queryFn: () => api("/wallet") });
  const profile = useQuery({ queryKey: ["profile"], queryFn: () => api("/user/profile") });
  const details = useQuery({ queryKey: ["deposit-details"], queryFn: () => api("/payments/deposit/details") });
  const history = useQuery({ queryKey: ["wallet", "history"], queryFn: () => api("/wallet/history?limit=30") });
  const myDeposits = useQuery({ queryKey: ["deposits", "mine"], queryFn: () => api("/payments/deposits?limit=10") });

  const [searchParams, setSearchParams] = useSearchParams();
  const depositId = searchParams.get("deposit");

  // returning from the UPI checkout lands on ?deposit=<id> — show the verifying card
  useEffect(() => {
    if (depositId) setTab("deposit");
  }, [depositId]);

  function openDepositCard(id) {
    const next = new URLSearchParams(searchParams);
    next.set("deposit", id);
    setSearchParams(next, { replace: true });
  }

  function closeDepositCard() {
    const next = new URLSearchParams(searchParams);
    next.delete("deposit");
    setSearchParams(next, { replace: true });
    qc.invalidateQueries({ queryKey: ["deposits", "mine"] });
    qc.invalidateQueries({ queryKey: ["wallet"] });
    qc.invalidateQueries({ queryKey: ["wallet", "history"] });
  }

  // realtime: admin approvals / settlement credits land here without a reload (F2)
  useEffect(() => {
    if (!socket.connected) socket.connect();
    function onWallet(view) {
      qc.setQueryData(["wallet"], view);
      qc.invalidateQueries({ queryKey: ["wallet", "history"] });
      qc.invalidateQueries({ queryKey: ["profile"] });
    }
    function onProfileChanged() {
      qc.invalidateQueries({ queryKey: ["profile"] });
      qc.invalidateQueries({ queryKey: ["wallet"] });
    }
    socket.on("wallet:updated", onWallet);
    socket.on("kyc:updated", onProfileChanged);
    socket.on("deposit:updated", onProfileChanged);
    socket.on("withdrawal:updated", onProfileChanged);
    return () => {
      socket.off("wallet:updated", onWallet);
      socket.off("kyc:updated", onProfileChanged);
      socket.off("deposit:updated", onProfileChanged);
      socket.off("withdrawal:updated", onProfileChanged);
    };
  }, [qc]);

  const w = wallet.data;
  const kycVerified = profile.data?.user?.kycStatus === "verified";

  /** rupees (string) -> integer paise, with the shared exact-math guard */
  function toPaise(input) {
    try {
      return rupeesToPaise(input);
    } catch (err) {
      toast.error(err.message || "Enter a valid amount");
      return null;
    }
  }

  async function refreshAll() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["wallet"] }),
      qc.invalidateQueries({ queryKey: ["profile"] }),
    ]);
  }

  async function submitDeposit() {
    const paise = toPaise(amount);
    if (paise === null) return;
    setBusy(true);
    try {
      await api("/payments/deposit", { method: "POST", body: { amountPaise: paise, utr: utr.trim() } });
      toast.success("Deposit submitted. Wait for admin approval.");
      setAmount("");
      setUtr("");
      await refreshAll();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Instant UPI: the API creates the order and hands back the hosted checkout
   * URL. We send the browser there; when it comes back the page shows the
   * verifying card. The wallet is credited by the backend, never the client.
   */
  async function submitGatewayDeposit() {
    const paise = toPaise(amount);
    if (paise === null) return;
    if (paise % 100 !== 0) {
      toast.error("Instant UPI payments must be in whole rupees");
      return;
    }
    setBusy(true);
    try {
      const res = await api("/payments/deposit/gateway", { method: "POST", body: { amountPaise: paise } });
      if (res.paymentUrl) {
        window.location.href = res.paymentUrl; // hosted checkout (QR + UPI apps)
      } else {
        toast.error("Could not open the payment page");
      }
    } catch (err) {
      toast.error(err.message);
      qc.invalidateQueries({ queryKey: ["deposit-details"] });
      setBusy(false);
    }
  }

  async function submitWithdraw() {
    const paise = toPaise(amount);
    if (paise === null) return;
    setBusy(true);
    try {
      await api("/payments/withdraw", { method: "POST", body: { amountPaise: paise, upiId: upiId.trim() } });
      toast.success("Withdrawal requested");
      setAmount("");
      await refreshAll();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function copyUpi() {
    const id = details.data?.upiId;
    if (!id) return;
    try {
      await navigator.clipboard.writeText(id);
      toast.success("UPI ID copied");
    } catch {
      toast.info(id);
    }
  }

  if (wallet.isLoading || profile.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (wallet.isError) {
    return <Empty title="Wallet unavailable" hint={wallet.error?.message} />;
  }

  const totals = w?.totals || {};

  // hybrid rail selection: instant gateway under the threshold, manual UPI + UTR at/above it
  const g = details.data;
  const gatewayPaise = safePaise(amount);
  const gatewayMode = Boolean(g?.gatewayEnabled) && gatewayPaise !== null && gatewayPaise < g.gatewayThresholdPaise;
  const showManualForm = Boolean(g) && (!g.gatewayEnabled || (gatewayPaise !== null && !gatewayMode));

  return (
    <div className="space-y-4">
      {/* headline balance */}
      <section className="rounded-2xl border border-gray-100 bg-gradient-to-b from-[#FFFDF5] to-white p-4 shadow-card">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Available balance</p>
        <div className="mt-1 flex items-end gap-2">
          <CoinIcon className="h-7 w-7 text-sm" />
          <span className="text-3xl font-black tracking-tight text-ink">{formatPaise(w?.availablePaise ?? 0)}</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-xl bg-gray-50 px-3 py-2">
            <p className="font-bold text-slate-400">Total</p>
            <p className="font-black text-slate-700">{formatPaise(w?.totalPaise ?? 0)}</p>
          </div>
          <div className="rounded-xl bg-gray-50 px-3 py-2">
            <p className="font-bold text-slate-400">On hold</p>
            <p className="font-black text-slate-700">{formatPaise(w?.heldPaise ?? 0)}</p>
          </div>
        </div>
      </section>

      <Tabs value={tab} onChange={setTab}>
        <TabsList>
          <TabsButton value="balance" activeValue={tab} onChange={setTab}>Balance</TabsButton>
          <TabsButton value="deposit" activeValue={tab} onChange={setTab}>Add funds</TabsButton>
          <TabsButton value="withdraw" activeValue={tab} onChange={setTab}>Withdraw</TabsButton>
          <TabsButton value="history" activeValue={tab} onChange={setTab}>History</TabsButton>
        </TabsList>

        <TabsPanel match={tab} value="balance">
          <div className="space-y-3">
            <Panel title="Stats">
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  ["Deposited", totals.depositedPaise],
                  ["Won", totals.wonPaise],
                  ["Withdrawn", totals.withdrawnPaise],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-gray-50 px-2 py-3">
                    <p className="text-[11px] font-bold text-slate-400">{label}</p>
                    <p className="mt-0.5 text-sm font-black text-slate-700">{formatPaise(value ?? 0)}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2.5 text-sm">
                <span className="font-bold text-slate-500">Battles played</span>
                <span className="font-black text-slate-700">
                  {totals.battlesPlayed ?? 0}
                  <span className="ml-1 text-xs font-bold text-slate-400">({totals.battlesWon ?? 0} won)</span>
                </span>
              </div>
            </Panel>

            <Panel title="Account">
              <div className="space-y-2.5 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-500">KYC status</span>
                  <Badge status={profile.data?.user?.kycStatus || "not_submitted"} />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-bold text-slate-500">Referral code</span>
                  <span className="font-mono text-xs font-bold text-slate-700">{profile.data?.referralCode || "—"}</span>
                </div>
                {!kycVerified && (
                  <Link to="/profile" className="block rounded-xl bg-brand-500/10 px-3 py-2 text-xs font-bold text-brand-600">
                    Complete KYC to unlock withdrawals →
                  </Link>
                )}
              </div>
            </Panel>
          </div>
        </TabsPanel>


        <TabsPanel match={tab} value="deposit">
          <Panel title="Add funds">
            <div className="space-y-3">
              {depositId && <GatewayDepositCard depositId={depositId} onClose={closeDepositCard} />}

              {g?.gatewayUnavailable && !gatewayMode && (
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800">
                  Instant UPI is temporarily unavailable — pay by UPI transfer below and submit the UTR number.
                </p>
              )}

              <Input
                label="Amount (₹)"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="500"
                inputMode="decimal"
                hint={g ? `Min ${formatPaise(g.minPaise)} · Max ${formatPaise(g.maxPaise)}${g.gatewayEnabled ? ` · instant under ${formatPaise(g.gatewayThresholdPaise)}` : ""}` : undefined}
              />

              {g?.gatewayEnabled && gatewayPaise === null && (
                <p className="rounded-xl bg-gray-50 px-3 py-2 text-[11px] text-slate-500">
                  Under {formatPaise(g.gatewayThresholdPaise)} you pay instantly with UPI (QR / UPI apps) and the
                  balance is credited automatically. {formatPaise(g.gatewayThresholdPaise)} or more is a UPI
                  transfer with a UTR number.
                </p>
              )}

              {gatewayMode && (
                <>
                  <Button
                    className="w-full"
                    onClick={submitGatewayDeposit}
                    loading={busy}
                    disabled={gatewayPaise % 100 !== 0}
                  >
                    Pay {formatPaise(gatewayPaise)} instantly
                  </Button>
                  <p className="text-[11px] text-slate-500">
                    You will be taken to the secure UPI checkout (QR + PhonePe / Paytm / GPay).
                    {gatewayPaise % 100 !== 0
                      ? " Whole rupee amounts only for instant payment."
                      : " Your wallet is credited automatically as soon as the payment is confirmed."}
                  </p>
                </>
              )}

              {showManualForm && (
                <div className="space-y-3 border-t border-gray-100 pt-3">
                  {g?.upiId && (
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-[#FAD655] bg-[#FEF4BA]/60 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-amber-700">Pay to</p>
                        <p className="truncate font-mono text-sm font-black text-slate-800">{g.upiId}</p>
                        <p className="text-[11px] font-semibold text-slate-500">{g.upiName}</p>
                      </div>
                      <Button variant="ghost" className="shrink-0 px-3 py-2 text-xs" onClick={copyUpi}>
                        Copy
                      </Button>
                    </div>
                  )}
                  <Input
                    label="UTR / Transaction ID"
                    value={utr}
                    onChange={(e) => setUtr(e.target.value.toUpperCase())}
                    placeholder="XXXXXXXXXXXX"
                  />
                  <Button className="w-full" onClick={submitDeposit} loading={busy} disabled={!amount || utr.trim().length < 6}>
                    Submit deposit
                  </Button>
                  <p className="text-[11px] text-slate-500">
                    Pay the exact amount to the UPI ID above, then submit the UTR. An admin verifies and credits your wallet.
                  </p>
                </div>
              )}

              {myDeposits.data?.items?.length > 0 && (
                <div className="space-y-1 border-t border-gray-100 pt-3">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Recent deposits</p>
                  <ul className="divide-y divide-gray-100">
                    {myDeposits.data.items.map((d) => (
                      <li key={d.id}>
                        <button
                          type="button"
                          onClick={() => d.method === "gateway" && openDepositCard(d.id)}
                          className={`flex w-full items-center justify-between gap-2 py-2 text-left ${
                            d.method === "gateway" ? "cursor-pointer" : "cursor-default"
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-slate-700">{formatPaise(d.amountPaise)}</p>
                            <p className="text-[11px] text-slate-400">
                              {d.method === "gateway" ? "Instant UPI" : "UPI transfer"} ·{" "}
                              {new Date(d.createdAt).toLocaleString()}
                            </p>
                            {d.gatewayNote && (
                              <p className="text-[11px] font-semibold text-amber-700">{d.gatewayNote}</p>
                            )}
                            {d.rejectReason && !d.gatewayNote && (
                              <p className="text-[11px] text-slate-400">{d.rejectReason}</p>
                            )}
                          </div>
                          <Badge status={d.status} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Panel>
        </TabsPanel>

        <TabsPanel match={tab} value="withdraw">
          <Panel title="Withdraw funds">
            {kycVerified ? (
              <div className="space-y-3">
                <Input
                  label="Amount (₹)"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="1000"
                  inputMode="decimal"
                  hint="Minimum withdrawal ₹1,000"
                />
                <Input
                  label="Your UPI ID"
                  value={upiId}
                  onChange={(e) => setUpiId(e.target.value)}
                  placeholder="yourname@bank"
                />
                <Button className="w-full" onClick={submitWithdraw} loading={busy} disabled={!amount || !upiId.trim()}>
                  Request withdrawal
                </Button>
                <p className="text-[11px] text-slate-500">The amount is put on hold immediately and paid out by an admin.</p>
              </div>
            ) : (
              <Empty title="KYC required" hint="Verify your identity from the Profile tab before withdrawing." />
            )}
          </Panel>
        </TabsPanel>

        <TabsPanel match={tab} value="history">
          <Panel title="Transaction history">
            {history.isLoading && <Spinner />}
            {history.data && history.data.items.length === 0 && (
              <Empty title="No transactions yet" hint="Deposits, stakes and prizes all appear here." />
            )}
            {history.data && history.data.items.length > 0 && (
              <ul className="divide-y divide-gray-100">
                {history.data.items.map((row) => (
                  <li key={row.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-700">{LEDGER_LABELS[row.type] || row.type}</p>
                      <p className="truncate text-[11px] text-slate-400">
                        {row.note || row.refType} · {new Date(row.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <Badge amountPaise={row.amountPaise} />
                      <p className="text-[10px] font-semibold text-slate-400">
                        bal {formatPaise(row.balanceAfterPaise ?? 0, { withSymbol: false })}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </TabsPanel>
      </Tabs>
    </div>
  );
}

