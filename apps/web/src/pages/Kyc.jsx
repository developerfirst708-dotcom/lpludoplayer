import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiUpload } from "../lib/api.js";
import { socket } from "../lib/socket.js";
import { useToast } from "../components/Toast.jsx";
import { Badge, Button, Empty, Input, Panel, Skeleton } from "../components/ui.jsx";

/**
 * KYC — the identity verification flow, reached from the Profile screen (the
 * KYC shortcut box is the only entry point). Documents are uploaded first
 * (POST /uploads?kind=kyc) and then referenced by key in POST /user/kyc,
 * which is how the API expects them.
 */
export default function Kyc() {
  const toast = useToast();
  const qc = useQueryClient();

  const [holderName, setHolderName] = useState("");
  const [upiId, setUpiId] = useState("");
  const [frontKey, setFrontKey] = useState("");
  const [backKey, setBackKey] = useState("");
  const [frontName, setFrontName] = useState("");
  const [backName, setBackName] = useState("");
  const [uploading, setUploading] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const frontRef = useRef(null);
  const backRef = useRef(null);

  const profile = useQuery({ queryKey: ["profile"], queryFn: () => api("/user/profile") });

  // admin verdicts land without a reload
  useEffect(() => {
    if (!socket.connected) socket.connect();
    function refresh() {
      qc.invalidateQueries({ queryKey: ["profile"] });
    }
    socket.on("kyc:updated", refresh);
    return () => socket.off("kyc:updated", refresh);
  }, [qc]);

  const kycStatus = profile.data?.user?.kycStatus || "not_submitted";
  const kycVerified = kycStatus === "verified";
  const kycLocked = kycStatus === "pending" || kycVerified;

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

  async function submit() {
    setSubmitting(true);
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
      setSubmitting(false);
    }
  }

  if (profile.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  if (profile.isError) return <Empty title="KYC unavailable" hint={profile.error?.message} />;

  return (
    <div className="space-y-4">
      <Link
        to="/profile"
        className="inline-flex items-center gap-1.5 text-xs font-extrabold text-slate-500 transition-colors hover:text-slate-700"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 6l-6 6 6 6" />
        </svg>
        Back to profile
      </Link>

      <Panel title="KYC verification">
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2.5">
            <span className="text-sm font-bold text-slate-500">Status</span>
            <Badge status={kycStatus} />
          </div>

          {kycVerified && (
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
                onClick={submit}
                loading={submitting}
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
    </div>
  );
}
