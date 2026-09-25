import React, { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiUpload } from "../lib/api.js";
import { socket } from "../lib/socket.js";
import { formatPaise } from "@lpludo/shared";
import { useToast } from "../components/Toast.jsx";
import { Badge, Button, Empty, Input, Panel, Skeleton } from "../components/ui.jsx";
import { NavIcon } from "../components/art.jsx";
import { logout } from "../lib/auth.js";

/**
 * Profile — the player's auto-assigned handle, KYC submission and account
 * facts. KYC documents are uploaded first (POST /uploads?kind=kyc) and then
 * referenced by key in POST /user/kyc, which is how the API expects them.
 */
export default function Profile() {
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);

  const [holderName, setHolderName] = useState("");
  const [upiId, setUpiId] = useState("");
  const [frontKey, setFrontKey] = useState("");
  const [backKey, setBackKey] = useState("");
  const [frontName, setFrontName] = useState("");
  const [backName, setBackName] = useState("");
  const [uploading, setUploading] = useState(null);
  const [submittingKyc, setSubmittingKyc] = useState(false);

  const frontRef = useRef(null);
  const backRef = useRef(null);

  const profile = useQuery({ queryKey: ["profile"], queryFn: () => api("/user/profile") });

  // realtime: admin KYC verdicts + wallet movements land without a reload (F2)
  useEffect(() => {
    if (!socket.connected) socket.connect();
    function refresh() {
      qc.invalidateQueries({ queryKey: ["profile"] });
      qc.invalidateQueries({ queryKey: ["wallet"] });
    }
    socket.on("kyc:updated", refresh);
    socket.on("wallet:updated", refresh);
    return () => {
      socket.off("kyc:updated", refresh);
      socket.off("wallet:updated", refresh);
    };
  }, [qc]);

  useEffect(() => {
    if (profile.data?.user?.name) setName(profile.data.user.name);
  }, [profile.data]);

  const u = profile.data?.user || {};
  const kycStatus = u.kycStatus || "not_submitted";
  const kycLocked = kycStatus === "pending" || kycStatus === "verified";

  async function saveName() {
    setSavingName(true);
    try {
      await api("/user/profile", { method: "PATCH", body: { name } });
      toast.success("Display name updated");
      qc.invalidateQueries({ queryKey: ["profile"] });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingName(false);
    }
  }

  async function upload(kind, file) {
    if (!file) return;
    setUploading(kind);
    try {
      const { key } = await apiUpload("/uploads", file, "kyc");
      if (kind === "front") {
        setFrontKey(key);
        setFrontName(file.name);
      } else {
        setBackKey(key);
        setBackName(file.name);
      }
      toast.success("Document uploaded");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setUploading(null);
    }
  }

  async function submitKyc() {
    setSubmittingKyc(true);
    try {
      await api("/user/kyc", {
        method: "POST",
        body: { holderName, upiId, frontImageKey: frontKey, backImageKey: backKey },
      });
      toast.success("KYC submitted for review");
      qc.invalidateQueries({ queryKey: ["profile"] });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmittingKyc(false);
    }
  }

  if (profile.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (profile.isError) return <Empty title="Profile unavailable" hint={profile.error?.message} />;

  return (
    <div className="space-y-4">
      {/* identity */}
      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-card">
        <div className="flex items-center gap-3">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-300 via-brand-500 to-[#C98509] text-xl font-black text-white shadow-inner">
            {u.name?.[0]?.toUpperCase() || "L"}
          </div>
          <div className="min-w-0">
            <p className="truncate text-lg font-black tracking-tight text-ink">{u.name || "—"}</p>
            <p className="text-xs font-semibold text-slate-400">+91 {profile.data?.phone || "—"}</p>
          </div>
          <div className="ml-auto">
            <Badge status={kycStatus} />
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-gray-50 px-2 py-2">
            <p className="text-[11px] font-bold text-slate-400">Battles</p>
            <p className="text-sm font-black text-slate-700">{profile.data?.battlesPlayed ?? 0}</p>
          </div>
          <div className="rounded-xl bg-gray-50 px-2 py-2">
            <p className="text-[11px] font-bold text-slate-400">Balance</p>
            <p className="text-sm font-black text-slate-700">{formatPaise(profile.data?.wallet?.availablePaise ?? 0)}</p>
          </div>
          <div className="rounded-xl bg-gray-50 px-2 py-2">
            <p className="text-[11px] font-bold text-slate-400">On hold</p>
            <p className="text-sm font-black text-slate-700">{formatPaise(profile.data?.wallet?.heldPaise ?? 0)}</p>
          </div>
        </div>
      </section>

      {/* display name */}
      <Panel title="Player details">
        <div className="space-y-3">
          <Input
            label="Display name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your player code"
            hint="Auto-generated for you — rename it if you prefer."
            maxLength={40}
          />
          <Input label="Phone number" value={profile.data?.phone || ""} disabled hint="Phone numbers cannot be changed." />
          <Input label="Referral code" value={profile.data?.referralCode || ""} disabled hint="Share it to earn 5% commission for life." />
          <Button className="w-full" onClick={saveName} loading={savingName} disabled={!name || name === u.name}>
            Save changes
          </Button>
        </div>
      </Panel>


      {/* KYC */}
      <Panel title="KYC verification">
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2.5">
            <span className="text-sm font-bold text-slate-500">Status</span>
            <Badge status={kycStatus} />
          </div>

          {kycStatus === "verified" && (
            <p className="rounded-xl bg-emerald-50 px-3 py-2.5 text-xs font-bold text-emerald-700">
              Your KYC is verified — withdrawals are unlocked.
            </p>
          )}

          {kycStatus === "pending" && (
            <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-xs font-bold text-amber-700">
              Documents submitted. An admin will review them shortly.
            </p>
          )}

          {!kycLocked && (
            <>
              {kycStatus === "rejected" && (
                <p className="rounded-xl bg-rose-50 px-3 py-2.5 text-xs font-bold text-rose-700">
                  Your previous submission was rejected. Please upload again.
                </p>
              )}
              <Input
                label="Name on document"
                value={holderName}
                onChange={(e) => setHolderName(e.target.value)}
                placeholder="As printed on your ID"
              />
              <Input
                label="UPI ID for payouts"
                value={upiId}
                onChange={(e) => setUpiId(e.target.value)}
                placeholder="yourname@bank"
              />

              <input ref={frontRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => upload("front", e.target.files?.[0])} />
              <input ref={backRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => upload("back", e.target.files?.[0])} />

              {[
                ["front", "ID front", frontName, frontRef, frontKey, uploading === "front"],
                ["back", "ID back", backName, backRef, backKey, uploading === "back"],
              ].map(([kind, label, fileLabel, ref, key, isBusy]) => (
                <div key={kind} className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
                    <p className={`truncate text-xs font-bold ${key ? "text-emerald-600" : "text-slate-500"}`}>
                      {isBusy ? "Uploading…" : fileLabel || "No file chosen"}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    className="shrink-0 px-4 py-2 text-xs"
                    loading={isBusy}
                    onClick={() => ref.current?.click()}
                  >
                    {key ? "Replace" : "Upload"}
                  </Button>
                </div>
              ))}

              <Button
                className="w-full"
                onClick={submitKyc}
                loading={submittingKyc}
                disabled={!holderName.trim() || !upiId.trim() || !frontKey || !backKey}
              >
                Submit KYC
              </Button>
              <p className="text-[11px] text-slate-500">
                JPEG, PNG or WebP. Documents are stored privately and only visible to you and the review team.
              </p>
            </>
          )}
        </div>
      </Panel>

      {/* account + logout */}
      <Panel title="Account">
        <div className="space-y-2.5 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="font-bold text-slate-500">Account ID</span>
            <span className="truncate font-mono text-xs text-slate-600">{u.id}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-bold text-slate-500">Member since</span>
            <span className="font-bold text-slate-600">
              {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}
            </span>
          </div>
          <button
            type="button"
            onClick={logout}
            className="mt-1 flex w-full items-center justify-center gap-2 rounded-full bg-gray-100 py-2.5 text-sm font-extrabold text-rose-600 transition-all hover:bg-rose-50 active:scale-95"
          >
            <NavIcon name="logout" className="h-4 w-4" />
            Log out
          </button>
        </div>
      </Panel>
    </div>
  );
}

