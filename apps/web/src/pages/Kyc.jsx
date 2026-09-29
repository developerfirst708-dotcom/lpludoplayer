import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiUpload } from "../lib/api.js";
import compressImage from "../lib/compressImage.js";
import { socket } from "../lib/socket.js";
import { useToast } from "../components/Toast.jsx";
import { Badge, Button, Empty, Input, Panel, Skeleton } from "../components/ui.jsx";

/**
 * KYC — the identity verification form, reached from the Profile screen.
 * Name, date of birth, Aadhaar or PAN number and both sides of the ID card.
 * Photos are uploaded first (POST /uploads?kind=kyc) and then referenced by
 * key in POST /user/kyc, which is how the API expects them.
 */

const DOC_TYPES = [
  { value: "aadhar", label: "Aadhaar Card", placeholder: "12-digit Aadhaar number" },
  { value: "pan", label: "PAN Card", placeholder: "ABCDE1234F" },
];

/** age in whole years from a YYYY-MM-DD string */
function ageFrom(dob) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age;
}

export default function Kyc() {
  const toast = useToast();
  const qc = useQueryClient();

  const [holderName, setHolderName] = useState("");
  const [dob, setDob] = useState("");
  const [docType, setDocType] = useState("aadhar");
  const [docNumber, setDocNumber] = useState("");
  const [frontKey, setFrontKey] = useState("");
  const [backKey, setBackKey] = useState("");
  const [frontName, setFrontName] = useState("");
  const [backName, setBackName] = useState("");
  const [uploading, setUploading] = useState(null);
  const [submitting, setSubmitting] = useState(false);

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

  function selectType(next) {
    setDocType(next);
    setDocNumber("");
  }

  function onDocNumber(raw) {
    if (docType === "aadhar") setDocNumber(raw.replace(/\D/g, "").slice(0, 12));
    else setDocNumber(raw.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 10));
  }

  const nameValid = holderName.trim().length >= 2;
  const dobAge = ageFrom(dob);
  const dobValid = dobAge !== null && dobAge >= 18;
  const docValid = docType === "aadhar" ? /^\d{12}$/.test(docNumber) : /^[A-Z]{5}\d{4}[A-Z]$/.test(docNumber);
  const ready = nameValid && dobValid && docValid && Boolean(frontKey) && Boolean(backKey);

  async function upload(kind, file) {
    if (!file) return;
    setUploading(kind);
    try {
      // phone cameras produce multi-MB photos — shrink + re-encode to JPEG first
      const prepared = await compressImage(file, { maxWidth: 1600, maxHeight: 1600, quality: 0.8, maxSizeKB: 1500 });
      const { key } = await apiUpload("/uploads", prepared, "kyc");
      if (kind === "front") {
        setFrontKey(key);
        setFrontName(file.name);
      } else {
        setBackKey(key);
        setBackName(file.name);
      }
      toast.success("Photo uploaded");
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
        body: { holderName, dob, docType, docNumber, frontImageKey: frontKey, backImageKey: backKey },
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
                  Your previous submission was rejected. Please fill the form again.
                </p>
              )}

              <Input
                label="Name"
                value={holderName}
                onChange={(e) => setHolderName(e.target.value)}
                placeholder="Full name as on the document"
                maxLength={60}
              />

              <Input
                label="Date of birth"
                type="date"
                value={dob}
                onChange={(e) => setDob(e.target.value)}
                max={new Date().toISOString().slice(0, 10)}
                hint={dob && dobAge !== null && dobAge < 18 ? "You must be 18 or older to verify" : undefined}
              />

              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-500">Select document</label>
                <div className="grid grid-cols-2 gap-2">
                  {DOC_TYPES.map((d) => (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => selectType(d.value)}
                      className={`rounded-xl border px-3 py-2.5 text-sm font-bold transition-all active:scale-[0.98] ${
                        docType === d.value
                          ? "border-brand-500 bg-brand-500/15 text-brand-600"
                          : "border-gray-200 bg-gray-50 text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>

              <Input
                label="Document number"
                value={docNumber}
                onChange={(e) => onDocNumber(e.target.value)}
                placeholder={DOC_TYPES.find((d) => d.value === docType)?.placeholder}
                inputMode={docType === "aadhar" ? "numeric" : "text"}
                hint={docNumber && !docValid ? (docType === "aadhar" ? "Aadhaar must be 12 digits" : "Enter a valid PAN (e.g. ABCDE1234F)") : undefined}
              />

              {[
                ["front", "Photo (front)", frontName, frontKey, uploading === "front"],
                ["back", "Photo (back)", backName, backKey, uploading === "back"],
              ].map(([kind, label, fileLabel, key, isBusy]) => (
                <div key={kind} className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
                    <p className={`truncate text-xs font-bold ${key ? "text-emerald-600" : "text-slate-500"}`}>
                      {isBusy ? "Uploading…" : fileLabel || "No file chosen"}
                    </p>
                  </div>
                  {/* a label wrapping the input opens the native picker on every mobile browser */}
                  <label
                    className={`inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full bg-gray-100 px-4 py-2 text-xs font-extrabold text-slate-700 transition-all hover:bg-gray-200 active:scale-95 ${
                      isBusy ? "pointer-events-none opacity-50" : ""
                    }`}
                  >
                    {key ? "Replace" : "Upload"}
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      disabled={isBusy}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        upload(kind, file);
                      }}
                    />
                  </label>
                </div>
              ))}

              <Button className="w-full" onClick={submit} loading={submitting} disabled={!ready}>
                Submit
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
