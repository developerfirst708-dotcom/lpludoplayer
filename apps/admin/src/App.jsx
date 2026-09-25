import React, { useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { subscribe, tryResume, authState } from "./lib/auth.js";
import Layout from "./components/Layout.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import { ToastProvider } from "./components/Toast.jsx";
import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Users from "./pages/Users.jsx";
import Kyc from "./pages/Kyc.jsx";
import Deposits from "./pages/Deposits.jsx";
import Withdrawals from "./pages/Withdrawals.jsx";
import Matches from "./pages/Matches.jsx";
import Ledger from "./pages/Ledger.jsx";
import Audit from "./pages/Audit.jsx";
import Settings from "./pages/Settings.jsx";

/** Every authenticated screen renders inside the shell + its own error boundary. */
function Screen({ admin, children }) {
  return (
    <Layout admin={admin}>
      <ErrorBoundary>{children}</ErrorBoundary>
    </Layout>
  );
}

function AdminApp() {
  const [auth, setAuth] = useState(authState());

  useEffect(() => {
    tryResume();
    return subscribe(setAuth);
  }, []);

  if (!auth.ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#fbe6ef]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#f3cfe0] border-t-[#db2777]" />
      </div>
    );
  }

  if (!auth.user) return <Navigate to="/login" replace />;

  const withShell = (node) => <Screen admin={auth.user}>{node}</Screen>;

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={withShell(<Dashboard />)} />
      <Route path="/matches" element={withShell(<Matches />)} />
      <Route path="/users" element={withShell(<Users />)} />
      <Route path="/kyc" element={withShell(<Kyc />)} />
      <Route path="/deposits" element={withShell(<Deposits />)} />
      <Route path="/withdrawals" element={withShell(<Withdrawals />)} />
      <Route path="/ledger" element={withShell(<Ledger />)} />
      <Route path="/audit" element={withShell(<Audit />)} />
      <Route path="/settings" element={withShell(<Settings />)} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<AdminApp />} />
      </Routes>
    </ToastProvider>
  );
}
