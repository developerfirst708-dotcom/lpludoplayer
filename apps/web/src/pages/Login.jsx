import React, { useState } from "react";
import { sendOtp, verifyOtp } from "../lib/auth.js";
import { phoneSchema } from "@lpludo/shared/schemas"; // same zod schema as the server (S11)
import { useToast } from "../components/Toast.jsx";
import { Button, Card, Input } from "../components/ui.jsx";

/**
 * Exact LP Crown Logo embedded directly as a React SVG component.
 */
function LpLogo({ className = "w-28 h-28" }) {
  return (
    <svg
      viewBox="0 0 200 200"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        {/* Gold Crown Gradient */}
        <linearGradient id="lpGoldCrown" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#FDE047" />
          <stop offset="40%" stopColor="#EAB308" />
          <stop offset="100%" stopColor="#CA8A04" />
        </linearGradient>
      </defs>

      {/* Outer White Border Ring */}
      <circle cx="100" cy="100" r="96" fill="none" stroke="#FFFFFF" strokeWidth="4" />
      
      {/* Inner Black Circle Background */}
      <circle cx="100" cy="100" r="92" fill="#0A0A0A" stroke="#FFFFFF" strokeWidth="3" />

      {/* Gold Crown */}
      <g transform="translate(0, 5)">
        <path
          d="M 68,64 L 78,42 L 89,53 L 100,32 L 111,53 L 122,42 L 132,64 Z"
          fill="url(#lpGoldCrown)"
        />
        {/* Crown Base Strip */}
        <path
          d="M 68,66 C 78,69 122,69 132,66 L 132,69 C 122,72 78,72 68,69 Z"
          fill="url(#lpGoldCrown)"
        />
        {/* Crown Jewels/Balls */}
        <circle cx="78" cy="40" r="3.5" fill="url(#lpGoldCrown)" />
        <circle cx="100" cy="30" r="4" fill="url(#lpGoldCrown)" />
        <circle cx="122" cy="40" r="3.5" fill="url(#lpGoldCrown)" />
      </g>

      {/* Bold White LP Monogram */}
      <g fill="#FFFFFF" transform="translate(0, 10)">
        {/* Letter L */}
        <path d="M 48,70 H 62 V 126 C 62,133 67,138 74,138 H 82 V 150 H 70 C 58,150 48,140 48,128 Z" />
        
        {/* Letter P */}
        <path d="M 88,70 H 132 C 146,70 154,78 154,92 C 154,106 146,114 132,114 H 102 V 150 H 88 Z M 102,82 V 102 H 130 C 137,102 140,98 140,92 C 140,86 137,82 130,82 Z" />
        
        {/* Bottom Bar Segment */}
        <rect x="96" y="138" width="56" height="12" rx="2" />
      </g>
    </svg>
  );
}

/**
 * Login — mobile + OTP only. The display name is no longer collected here:
 * every new player is given a unique 5-letter code by the server on first
 * login (see apps/api/src/services/auth.service.js).
 */
export default function Login() {
  const toast = useToast();
  const [step, setStep] = useState("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [referral, setReferral] = useState("");
  const [devOtp, setDevOtp] = useState("");
  const [busy, setBusy] = useState(false);

  async function requestOtp(e) {
    e.preventDefault();
    const parsed = phoneSchema.safeParse(phone);
    if (!parsed.success) return toast.error(parsed.error.issues[0].message);
    setBusy(true);
    try {
      const r = await sendOtp(parsed.data);
      if (r.devOtp) {
        setDevOtp(r.devOtp);
        toast.info(`Dev OTP: ${r.devOtp}`);
      } else {
        toast.success("OTP sent");
      }
      setStep("verify");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function doVerify(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await verifyOtp({ phone, otp, referralCode: referral || undefined });
      toast.success("Welcome!");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col justify-center gap-6 px-6 py-10">
      <div className="flex flex-col items-center gap-2 text-center">
        {/* Embedded Logo Component */}
        <LpLogo className="h-28 w-28 drop-shadow-md" />
        <h1 className="mt-2 text-3xl font-black tracking-tight text-ink">WELCOME</h1>
        <p className="text-sm font-semibold text-slate-500">LP ludoplayer</p>
      </div>

      <Card className="p-5">
        {step === "phone" ? (
          <form onSubmit={requestOtp} className="flex flex-col gap-3">
            <Input
              label="Mobile number"
              inputMode="numeric"
              autoComplete="tel"
              placeholder="Enter mobile no."
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <Button type="submit" className="w-full" loading={busy}>
              Send OTP
            </Button>
          </form>
        ) : (
          <form onSubmit={doVerify} className="flex flex-col gap-3">
            <p className="text-xs font-semibold text-slate-500">
              OTP sent to +91 {phone} {devOtp && <span className="font-bold text-brand-600">(dev: {devOtp})</span>}
            </p>
            <input
              inputMode="numeric"
              maxLength={6}
              placeholder="6-digit OTP"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-center text-xl font-bold tracking-[0.4em] text-slate-900 outline-none transition-colors placeholder:text-base placeholder:font-normal placeholder:tracking-normal placeholder:text-slate-400 focus:border-brand-500 focus:bg-white"
            />
            <Input
              placeholder="Referral code (optional)"
              value={referral}
              onChange={(e) => setReferral(e.target.value.toUpperCase())}
            />
            <Button type="submit" className="w-full" loading={busy} disabled={otp.length !== 6}>
              Verify &amp; play
            </Button>
            <button
              type="button"
              onClick={() => setStep("phone")}
              className="text-xs font-bold text-slate-400 transition-colors hover:text-slate-600"
            >
              Change number
            </button>
          </form>
        )}
      </Card>

      <p className="text-center text-[11px] font-semibold text-slate-400">
        By continuing you agree to our Terms & Conditions and Privacy Policy
      </p>
    </div>
  );
}
