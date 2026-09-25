import React, { createContext, useCallback, useContext, useState } from "react";

const ToastCtx = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const push = useCallback((message, type = "info", ttl = 3500) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ttl);
  }, []);

  const colors = {
    info: "bg-white text-[#3d1f2e] border-[#f0c2d8]",
    success: "bg-emerald-600 text-white border-emerald-500",
    error: "bg-rose-600 text-white border-rose-500",
  };

  return (
    <ToastCtx.Provider value={{ toast: { info: (m) => push(m, "info"), success: (m) => push(m, "success"), error: (m) => push(m, "error", 5000) } }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[3000] flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`max-w-xs rounded-xl border px-4 py-2.5 text-sm font-semibold shadow-[0_10px_24px_rgba(61,31,46,0.18)] transition-all ${colors[t.type]}`}
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
