import React, { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { adminLogin, authState } from "../lib/auth.js";
import { Button, Card, Input } from "../components/ui.jsx";

export default function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  if (authState().user) return <Navigate to="/dashboard" replace />;

  async function doLogin(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await adminLogin(email, password);
      navigate("/dashboard");
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <div className="text-center">
        <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#ec4899] to-[#db2777] text-lg font-black text-white shadow-[0_10px_24px_rgba(219,39,119,0.3)]">
          LP
        </span>
        <h1 className="text-3xl font-black tracking-tight text-[#2a1520]">LPLUDO</h1>
        <p className="text-sm font-semibold text-[#7a3d58]">Admin panel</p>
      </div>

      <Card className="p-5">
        <form onSubmit={doLogin} className="flex flex-col gap-3">
          {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-600">{error}</p>}
          <Input
            label="Admin email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@lpludo.local"
          />
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
          <Button type="submit" disabled={busy || !email || !password} className="mt-1 w-full py-2.5 text-sm">
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </Card>

      <p className="text-center text-[11px] font-semibold text-[#a56a83]">
        Demo: admin@lpludo.local / Admin@12345
      </p>
    </div>
  );
}
