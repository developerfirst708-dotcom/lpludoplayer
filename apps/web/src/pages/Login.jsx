import React, { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { sendOtp, verifyOtp } from "../lib/auth.js";
import { phoneSchema } from "@lpludo/shared/schemas"; // same zod schema as the server (S11)
import { useToast } from "../components/Toast.jsx";
import { Button, Card, Input } from "../components/ui.jsx";

/**
 * Login — Mobile + OTP with dynamic ambient styling and interactive focus states.
 */
export default function Login() {
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [referral, setReferral] = useState((searchParams.get("ref") || "").toUpperCase());
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
    <div className="relative flex min-h-screen flex-col justify-center overflow-hidden bg-gradient-to-b from-amber-50/40 via-white to-amber-50/20 px-4 py-8">
      {/* Background Ambient Glow Accents */}
      <div className="pointer-events-none absolute -top-20 -left-20 h-64 w-64 rounded-full bg-amber-200/40 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 -right-20 h-64 w-64 rounded-full bg-yellow-300/30 blur-3xl" />

      {/* Dynamic Main Container Box */}
      <Card className="relative z-10 flex flex-col gap-6 p-6 shadow-xl border border-amber-200/80 bg-white/90 backdrop-blur-md transition-all duration-300 hover:shadow-2xl hover:border-amber-300">
        {/* Brand Header */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="relative">
            <img
              src="/logo.png"
              alt="LP Ludo"
              className="aspect-square w-28 rounded-full object-cover shadow-md transition-transform duration-300 hover:scale-105"
            />
          </div>

          {/* Welcome Title */}
          <h1 className="text-xl font-black tracking-wider text-ink space-x-1.5 drop-shadow-sm">
            <span className="bg-gradient-to-r from-amber-700 via-amber-900 to-slate-900 bg-clip-text text-transparent">
              WELCOME
            </span>
            <span>TO</span>
            <span>LPludoplayer</span>
            
          </h1>

          <p className="text-xs font-bold text-slate-500">
            Sign in securely with your mobile number
          </p>
        </div>

        {/* Dynamic Gradient Divider */}
        <div className="h-[2px] w-full bg-gradient-to-r from-transparent via-amber-200 to-transparent" />

        {/* Input Form Section */}
        {step === "phone" ? (
          <form onSubmit={requestOtp} className="flex flex-col gap-4">
            <Input
              label="Mobile number"
              inputMode="numeric"
              autoComplete="tel"
              placeholder="Enter mobile no."
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="transition-all duration-200 focus:ring-2 focus:ring-amber-400/50"
            />
            <Button
              type="submit"
              className="w-full mt-1 bg-gradient-to-r from-amber-400 via-brand-500 to-amber-500 shadow-md hover:shadow-lg active:scale-95 transition-all"
              loading={busy}
            >
              Send OTP
            </Button>
          </form>
        ) : (
          <form onSubmit={doVerify} className="flex flex-col gap-4">
            <p className="text-xs font-semibold text-slate-500 text-center">
              OTP sent to +91 {phone} {devOtp && <span className="font-bold text-brand-600">(dev: {devOtp})</span>}
            </p>
            <input
              inputMode="numeric"
              maxLength={6}
              placeholder="6-digit OTP"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              className="w-full rounded-xl border border-amber-200 bg-amber-50/30 px-3.5 py-3 text-center text-xl font-bold tracking-[0.4em] text-slate-900 outline-none transition-all duration-200 placeholder:text-base placeholder:font-normal placeholder:tracking-normal placeholder:text-slate-400 focus:border-amber-400 focus:bg-white focus:ring-2 focus:ring-amber-300/40"
            />
            <Input
              placeholder="Referral code (optional)"
              value={referral}
              onChange={(e) => setReferral(e.target.value.toUpperCase())}
            />
            <Button
              type="submit"
              className="w-full bg-gradient-to-r from-amber-400 via-brand-500 to-amber-500 shadow-md hover:shadow-lg active:scale-95 transition-all"
              loading={busy}
              disabled={otp.length !== 6}
            >
              Verify &amp; play
            </Button>
            <button
              type="button"
              onClick={() => setStep("phone")}
              className="text-xs font-bold text-amber-700 hover:text-amber-800 transition-colors text-center py-1"
            >
              Change number
            </button>
          </form>
        )}
      </Card>

      <p className="mt-5 text-center text-[11px] font-semibold text-slate-400 px-2">
        By continuing you agree to our Terms &amp; Conditions and Privacy Policy
      </p>
    </div>
  );
}
