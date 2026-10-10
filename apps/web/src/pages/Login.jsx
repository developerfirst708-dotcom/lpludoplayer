import React, { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { sendOtp, verifyOtp } from "../lib/auth.js";
import { phoneSchema } from "@lpludo/shared/schemas"; // same zod schema as the server (S11)
import { useToast } from "../components/Toast.jsx";
import { Button, Card, Input } from "../components/ui.jsx";

/**
 * Login — mobile + OTP only in a unified single container card.
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
    <div className="flex min-h-screen flex-col justify-center px-4 py-8">
      {/* Unified Single Container Card */}
      <Card className="flex flex-col gap-5 p-6 shadow-card border-[#FAD655]/60">
        {/* Brand Header inside the Box */}
        <div className="flex flex-col items-center gap-3 text-center">
          <img
            src="/logo.png"
            alt="LP Ludo"
            className="aspect-square w-32 rounded-full object-cover shadow-sm ring-2 ring-amber-300"
          />
          
          {/* Welcome Title with spaced out words */}
          <h1 className="text-xl font-black tracking-wider text-ink space-x-1.5">
            <span>WELCOME</span>
            <span>TO</span>
            <span>LP</span>
            <span>LUDO</span>
          </h1>
          
          <p className="text-xs font-semibold text-slate-500">
            Sign in securely with your mobile number
          </p>
        </div>

        {/* Divider */}
        <div className="h-[1px] w-full bg-gray-100" />

        {/* Input Form Section inside the Box */}
        {step === "phone" ? (
          <form onSubmit={requestOtp} className="flex flex-col gap-3.5">
            <Input
              label="Mobile number"
              inputMode="numeric"
              autoComplete="tel"
              placeholder="Enter mobile no."
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <Button type="submit" className="w-full mt-1" loading={busy}>
              Send OTP
            </Button>
          </form>
        ) : (
          <form onSubmit={doVerify} className="flex flex-col gap-3.5">
            <p className="text-xs font-semibold text-slate-500 text-center">
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
              className="text-xs font-bold text-slate-400 transition-colors hover:text-slate-600 text-center"
            >
              Change number
            </button>
          </form>
        )}
      </Card>

      <p className="mt-4 text-center text-[11px] font-semibold text-slate-400 px-2">
        By continuing you agree to our Terms & Conditions and Privacy Policy
      </p>
    </div>
  );
}
