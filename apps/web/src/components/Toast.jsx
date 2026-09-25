import React, { createContext, useCallback, useContext, useState } from "react";

/** Zero alert() toasts (F1) — one provider used by every screen. */
const ToastCtx = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const push = useCallback((message, type = "info", ttl = 3500) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ttl);
  }, []);

  const toast = {
    info: (m) => push(m, "info"),
    success: (m) => push(m, "success"),
    error: (m) => push(m, "error", 5000),
  };

  const colors = {
    info: "bg-ink text-white border-neutral-700",
    success: "bg-emerald-600 text-white border-emerald-500",
    error: "bg-rose-600 text-white border-rose-500",
  };

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="pointer-events-none fixed bottom-24 left-1/2 z-50 flex w-full max-w-[398px] -translate-x-1/2 flex-col gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`animate-rise rounded-xl border px-4 py-3 text-sm font-semibold shadow-lg ${colors[t.type]}`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}