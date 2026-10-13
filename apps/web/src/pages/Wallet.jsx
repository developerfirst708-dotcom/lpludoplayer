import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api, apiUpload } from "../lib/api.js";
import compressImage from "../lib/compressImage.js";
import { socket } from "../lib/socket.js";
import { rupeesToPaise, formatPaise } from "@lpludo/shared";
import { useToast } from "../components/Toast.jsx";
import { Badge, Button, Empty, Input, Panel, Skeleton, Spinner, Tabs, TabsButton, TabsList, TabsPanel } from "../components/ui.jsx";
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
};

// Filter allowed ledger types: Only Deposits & Withdrawals
const DISPLAY_TYPES = ["deposit", "withdrawal_hold", "withdrawal_paid", "withdrawal_refund"];

/** non-throwing paise parse — render paths must never toast */
function safePaise(input) {
  try {
    return input === "" || input === null || input === undefined ? null : rupeesToPaise(input);
  } catch {
    return null;
  }
}

/** Helper function to send native web/browser push notification */
async function triggerDepositNotification(title, body) {
  if (!("Notification" in window)) return;

  if (Notification.permission === "granted") {
    new Notification(title, { body, icon: "/favicon.ico" });
  } else if (Notification.permission !== "denied") {
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      new Notification(title, { body, icon: "/favicon.ico" });
    }
  }
}

export default function Wallet() {
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState("deposit");
  const [amount, setAmount] = useState("");
  const [utr, setUtr] = useState("");
  const [upiId, setUpiId] = useState("");
  const [proof, setProof] = useState(null);
  const [proofName, setProofName] = useState("");
  const [method, setMethod] = useState("upi"); // withdraw rail: upi | bank
  const [bank, setBank] = useState({ accountName: "", accountNumber: "", ifsc: "" });
  const [busy, setBusy] = useState(false);

  const wallet = useQuery({ queryKey: ["wallet"], queryFn: () => api("/wallet") });
  const profile = useQuery({ queryKey: ["profile"], queryFn: () => api("/user/profile") });
  const details = useQuery({ queryKey: ["deposit-details"], queryFn: () => api("/payments/deposit/details") });
  const history = useQuery({ queryKey: ["wallet", "history"], queryFn: () => api("/wallet/history?limit=50") });

  const [searchParams, setSearchParams] = useSearchParams();
  const depositId = searchParams.get("deposit");

  // returning from the UPI checkout lands on ?deposit=<id> — show the verifying card
  useEffect(() => {
    if (depositId) setTab("deposit");
  }, [depositId]);

  function closeDepositCard() {
    const next = new URLSearchParams(searchParams);
    next.delete("deposit");
    setSearchParams(next, { replace: true });
    qc.invalidateQueries({ queryKey: ["deposits", "mine"] });
    qc.invalidateQueries({ queryKey: ["wallet"] });
    qc.invalidateQueries({ queryKey: ["wallet", "history"] });
  }

  // realtime: admin approvals / settlement credits land here without a reload
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
      qc.invalidateQueries({ queryKey: ["wallet", "history"] }),
    ]);
  }

  async function submitDeposit() {
    const paise = toPaise(amount);
    if (paise === null) {
      toast.error("Please enter a valid amount");
      return;
    }

    // Check multiple of ₹50 (5000 paise)
    if (paise % 5000 !== 0) {
      const errMsg = "Deposit amount must be in multiples of ₹50!";
      toast.error(errMsg);
      triggerDepositNotification("Invalid Deposit Amount", errMsg);
      return;
    }

    if (!proof) {
      toast.error("Upload the payment screenshot");
      return;
    }

    setBusy(true);
    try {
      // upload the proof first, then claim with its key (key is required server-side)
      const compressed = await compressImage(proof);
      const { key } = await apiUpload("/uploads", compressed, "deposit");
      await api("/payments/deposit", { method: "POST", body: { amountPaise: paise, utr: utr.trim(), proofImageKey: key } });

      toast.success("Deposit submitted. Wait for admin approval.");

      triggerDepositNotification(
        "Deposit Request Submitted",
        `Your deposit of ${formatPaise(paise)} with UTR: ${utr} was submitted successfully.`
      );

      setAmount("");
      setUtr("");
      setProof(null);
      setProofName("");
      await refreshAll();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  function pickProof(file) {
    if (!file) return;
    setProof(file);
    setProofName(file.name);
  }

  /**
   * Instant UPI: the API creates the order and hands back the hosted checkout
   * URL. We send the browser there; when it comes back the page shows the
   * verifying card. The wallet is credited by the backend, never the client.
   */
  async function submitGatewayDeposit() {
    const paise = toPaise(amount);
    if (paise === null) {
      toast.error("Please enter a valid amount");
      return;
    }

    // Check multiple of ₹50 (5000 paise)
    if (paise % 5000 !== 0) {
      const errMsg = "Deposit amount must be in multiples of ₹50!";
      toast.error(errMsg);
      triggerDepositNotification("Invalid Deposit Amount", errMsg);
      return;
    }

    setBusy(true);
    try {
      const res = await api("/payments/deposit/gateway", { method: "POST", body: { amountPaise: paise } });

      triggerDepositNotification(
        "Initiating Payment",
        `Redirecting to complete payment of ${formatPaise(paise)}.`
      );

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

    // > ₹2000 must go to a bank account (reference rule)
    const bankRequired = paise > 200000;
    const finalMethod = bankRequired ? "bank" : method;
    const body = { amountPaise: paise, method: finalMethod };

    if (finalMethod === "upi") {
      if (!upiId.trim()) { toast.error("Enter your UPI ID"); return; }
      body.upiId = upiId.trim();
    } else {
      const b = {
        accountName: bank.accountName.trim(),
        accountNumber: bank.accountNumber.trim(),
        ifsc: bank.ifsc.trim().toUpperCase(),
      };
      if (!b.accountName || !/^\d{6,20}$/.test(b.accountNumber) \vert{}\vert{} !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(b.ifsc)) {
        toast.error("Enter valid bank details");
        return;
      }
      body.bank = b;
    }

    setBusy(true);
    try {
      await api("/payments/withdraw", { method: "POST", body });
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

  // hybrid rail selection: instant gateway under the threshold, manual UPI + UTR at/above it
  const g = details.data;
  const gatewayPaise = safePaise(amount);
  const gatewayMode = Boolean(g?.gatewayEnabled) && gatewayPaise !== null && gatewayPaise < g.gatewayThresholdPaise;
  const showManualForm = Boolean(g) && (!g.gatewayEnabled || (gatewayPaise !== null && !gatewayMode));

  // Filter history to display ONLY deposits and withdrawals
  const filteredHistory = (history.data?.items || []).filter((item) => DISPLAY_TYPES.includes(item.type));

  // withdraw rail: only winnings are withdrawable; > ₹2000 must be a bank transfer
  const winningsPaise = wallet.data?.winningsPaise ?? 0;
  const withdrawPaise = safePaise(amount);
  const bankRequired = withdrawPaise !== null && withdrawPaise > 200000;
  const effectiveMethod = bankRequired ? "bank" : method;

  return (
    <div className="space-y-4">
      <Tabs value={tab} onChange={setTab}>
        <TabsList>
          <TabsButton value="deposit" activeValue={tab} onChange={setTab}>Add funds</TabsButton>
          <TabsButton value="withdraw" activeValue={tab} onChange={setTab}>Withdraw</TabsButton>
          <TabsButton value="history" activeValue={tab} onChange={setTab}>History</TabsButton>
        </TabsList>

        <TabsPanel match={tab} value="deposit">
          {/* Gorgeous Colorful Ludo-Themed Add Funds Panel */}
          <Panel title="Add funds" className="border-amber-300 bg-gradient-to-b from-amber-50/95 via-white to-amber-50/60 shadow-xl rounded-3xl">
            <div className="space-y-3.5">
              {depositId && <GatewayDepositCard depositId={depositId} onClose={closeDepositCard} />}

              {/* Deposit UPI Policy Notice Box */}
              <div className="relative overflow-hidden rounded-2xl border border-rose-300 bg-gradient-to-r from-rose-100/90 via-orange-50 to-amber-100/90 p-3.5 text-center text-xs font-black text-rose-800 shadow-md">
                <span className="absolute -left-2 -bottom-2 text-2xl opacity-20 select-none" aria-hidden="true">🎲</span>
                👉 जिस UPI से Deposit होगा उसी UPI पर Withdraw होगा ! 👈
              </div>

              {g?.gatewayUnavailable && !gatewayMode && (
                <p className="rounded-xl border border-amber-200 bg-amber-100 px-3 py-2 text-[11px] font-semibold text-amber-800">
                  Instant UPI is temporarily unavailable — pay by UPI transfer below and submit the UTR number.
                </p>
              )}

              <Input
                label="Amount (₹)"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Enter Amount"
                inputMode="decimal"
                hint={
                  g
                    ? `Min ${formatPaise(g.minPaise)} · Max ${formatPaise(g.maxPaise)} · Must be multiple of ₹50${
                        g.gatewayEnabled ? ` · instant under ${formatPaise(g.gatewayThresholdPaise)}` : ""
                      }`
                    : "Must be a multiple of ₹50"
                }
              />

              {/* Preset amounts: 200, 500, 1000, 2000 */}
              <div className="flex gap-2">
                {[200, 500, 1000, 2000].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setAmount(String(preset))}
                    className="flex-1 rounded-2xl border border-amber-300/80 bg-gradient-to-br from-amber-100/80 via-yellow-50 to-amber-200/50 py-2 text-xs font-black text-amber-950 shadow-sm transition-all hover:border-amber-400 hover:shadow-md active:scale-95"
                  >
                    +₹{preset}
                  </button>
                ))}
              </div>

              {g?.gatewayEnabled && gatewayPaise === null && (
                <p className="rounded-xl bg-amber-100/60 px-3 py-2 text-[11px] text-slate-600">
                  Under {formatPaise(g.gatewayThresholdPaise)} you pay instantly with UPI (QR / UPI apps) and the
                  balance is credited automatically. {formatPaise(g.gatewayThresholdPaise)} or more is a UPI
                  transfer with a UTR number.
                </p>
              )}

              {gatewayMode && (
                <>
                  <Button
                    className="w-full rounded-full bg-gradient-to-r from-amber-400 via-amber-500 to-yellow-500 py-3 text-xs font-black text-neutral-950 shadow-lg shadow-amber-500/25 hover:brightness-105"
                    onClick={submitGatewayDeposit}
                    loading={busy}
                  >
                    Pay {gatewayPaise ? formatPaise(gatewayPaise) : ""} instantly
                  </Button>
                  <p className="text-[11px] text-slate-600">
                    You will be taken to the secure UPI checkout (QR + PhonePe / Paytm / GPay).
                    {gatewayPaise !== null && gatewayPaise % 5000 !== 0
                      ? " Deposit amount must be in multiples of ₹50."
                      : " Your wallet is credited automatically as soon as the payment is confirmed."}
                  </p>
                </>
              )}

              {showManualForm && (
                <div className="space-y-3.5 border-t border-amber-200/80 pt-3">
                  {g?.upiId && (
                    <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#FAD655] bg-gradient-to-r from-[#FEF4BA] via-[#FDE88C] to-[#FCD95B] px-4 py-3 shadow-md">
                      <div className="min-w-0">
                        <p className="text-[11px] font-black uppercase tracking-wide text-amber-900">Pay to UPI ID</p>
                        <p className="truncate font-mono text-sm font-black text-slate-900">{g.upiId}</p>
                        <p className="text-[11px] font-extrabold text-slate-700">{g.upiName}</p>
                      </div>
                      <Button variant="ghost" className="shrink-0 rounded-full bg-white/90 px-4 py-2 text-xs font-black shadow-sm hover:bg-white" onClick={copyUpi}>
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

                  {/* payment screenshot */}
                  <div className="flex items-center justify-between gap-2 rounded-2xl border border-amber-200 bg-white p-3.5 shadow-sm">
                    <div className="min-w-0">
                      <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Payment screenshot (required)</p>
                      <p className="truncate text-xs font-bold text-slate-700">{proofName || "No file chosen"}</p>
                    </div>
                    <label className="inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full bg-amber-400 px-4 py-2 text-xs font-black text-neutral-950 shadow-sm transition-all hover:bg-amber-500 active:scale-95">
                      {proof ? "Replace" : "Upload"}
                      <input
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; pickProof(f); }}
                      />
                    </label>
                  </div>

                  <Button
                    className="w-full rounded-full bg-gradient-to-r from-amber-400 via-amber-500 to-yellow-500 py-3 text-xs font-black text-neutral-950 shadow-lg shadow-amber-500/25 hover:brightness-105"
                    onClick={submitDeposit}
                    loading={busy}
                    disabled={!amount || utr.trim().length < 6 || !proof}
                  >
                    Submit deposit
                  </Button>
                  <p className="text-[11px] text-slate-600">
                    Pay the exact amount (multiple of ₹50) to the UPI ID above, then attach the payment screenshot and submit the UTR. An admin verifies and credits your wallet.
                  </p>
                </div>
              )}
            </div>
          </Panel>
        </TabsPanel>

        <TabsPanel match={tab} value="withdraw">
          <Panel title="Withdraw funds" className="border-amber-200 bg-amber-50/70">
            {kycVerified ? (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <Bucket label="Balance" paise={wallet.data?.balancePaise} />
                  <Bucket label="Bonus" paise={wallet.data?.bonusPaise} />
                  <Bucket label="Winnings" paise={wallet.data?.winningsPaise} highlight />
                </div>
                <p className="text-[11px] font-bold text-emerald-700">
                  Withdrawable (winnings): {formatPaise(winningsPaise)}
                </p>

                <Input
                  label="Amount (₹)"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="200"
                  inputMode="decimal"
                  hint="Minimum ₹200 · up to ₹2000 via UPI"
                />

                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={bankRequired}
                    onClick={() => setMethod("upi")}
                    className={`flex-1 rounded-xl border py-2 text-xs font-bold transition-colors disabled:opacity-50 ${
                      effectiveMethod === "upi" ? "border-slate-800 bg-white text-slate-900" : "border-amber-200 bg-white/60 text-slate-500"
                    }`}
                  >
                    UPI
                  </button>
                  <button
                    type="button"
                    onClick={() => setMethod("bank")}
                    className={`flex-1 rounded-xl border py-2 text-xs font-bold transition-colors ${
                      effectiveMethod === "bank" ? "border-slate-800 bg-white text-slate-900" : "border-amber-200 bg-white/60 text-slate-500"
                    }`}
                  >
                    Bank
                  </button>
                </div>

                {effectiveMethod === "upi" ? (
                  <Input
                    label="Your UPI ID"
                    value={upiId}
                    onChange={(e) => setUpiId(e.target.value)}
                    placeholder="name@bank"
                  />
                ) : (
                  <>
                    <Input label="Account holder name" value={bank.accountName} onChange={(e) => setBank({ ...bank, accountName: e.target.value })} placeholder="Full name" />
                    <Input label="Account number" value={bank.accountNumber} inputMode="numeric" onChange={(e) => setBank({ ...bank, accountNumber: e.target.value.replace(/\D/g, "") })} placeholder="Account number" />
                    <Input label="IFSC code" value={bank.ifsc} onChange={(e) => setBank({ ...bank, ifsc: e.target.value.toUpperCase() })} placeholder="ABCD0123456" />
                  </>
                )}

                <Button
                  className="w-full"
                  onClick={submitWithdraw}
                  loading={busy}
                  disabled={!amount || (effectiveMethod === "upi" ? !upiId.trim() : !(bank.accountName && bank.accountNumber && bank.ifsc))}
                >
                  Request withdrawal
                </Button>
                <p className="text-[11px] text-slate-600">
                  Only winnings can be withdrawn. Above ₹2000 a bank transfer is required. The amount is put on hold
                  immediately and paid out by an admin.
                </p>
              </div>
            ) : (
              <Empty title="KYC required" hint="Open KYC Verification from your Profile to unlock withdrawals." />
            )}
          </Panel>
        </TabsPanel>

        <TabsPanel match={tab} value="history">
          <Panel title="Transaction history">
            {history.isLoading && <Spinner />}
            {!history.isLoading && filteredHistory.length === 0 && (
              <Empty title="No deposits or withdrawals yet" hint="Your deposits and withdrawal requests will appear here." />
            )}
            {!history.isLoading && filteredHistory.length > 0 && (
              <ul className="divide-y divide-gray-100">
                {filteredHistory.map((row) => (
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

/** small read-only bucket chip (Balance / Bonus / Winnings) */
function Bucket({ label, paise, highlight }) {
  return (
    <div className={`rounded-xl border px-2 py-2 ${highlight ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-white"}`}>
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-sm font-black text-slate-800">{formatPaise(paise ?? 0, { withSymbol: false })}</p>
    </div>
  );
}
