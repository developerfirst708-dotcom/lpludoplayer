import React, { useState } from "react";
import { sendOtp, verifyOtp } from "../lib/auth.js";
import { phoneSchema } from "@lpludo/shared/schemas"; // same zod schema as the server (S11)
import { useToast } from "../components/Toast.jsx";
import { Button, Card, Input } from "../components/ui.jsx";
import { Monogram } from "../components/art.jsx";

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
        <Monogram className="scale-110" />
        <h1 className="mt-2 text-3xl font-black tracking-tight text-ink">WELCOME BACK</h1>
        <p className="text-sm font-semibold text-slate-500">welcome to LPludoplayer</p>
      </div>

      <Card className="p-5">
        {step === "phone" ? (
          <form onSubmit={requestOtp} className="flex flex-col gap-3">
            <Input
              label="Mobile number"
              inputMode="numeric"
              autoComplete="tel"
              placeholder="10-digit mobile"
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
        New players get a unique 5-letter player code automatically — no name to choose.
      </p>
    </div>
  );
}
