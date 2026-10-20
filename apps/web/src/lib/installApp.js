/**
 * PWA install helper — intercepts the browser's `beforeinstallprompt` event so
 * we can present the native Android "Add to Home Screen" dialog on demand, and
 * capture the moment the app gets installed.
 *
 * The deferred prompt is temporarily stashed in a module-level slot (a single
 * user gesture can prompt), and a tiny pub/sub lets the UI react when it becomes
 * available or when the app is (un)installed.
 */

let deferredPrompt = null;
let installed = false;
const listeners = new Set();

function emit() {
  for (const fn of listeners) fn({ canPrompt: Boolean(deferredPrompt), installed });
}

if (typeof window !== "undefined") {
  if (
    window.matchMedia &&
    (window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true)
  ) {
    installed = true;
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // we call prompt() ourselves from the button
    deferredPrompt = e;
    emit();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    installed = true;
    emit();
  });
}

/** whether we are currently running as an installed PWA / standalone shortcut */
export function isStandalone() {
  if (typeof window === "undefined") return false;
  if (window.navigator.standalone === true) return true;
  return Boolean(window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
}

/** subscribe to install-availability changes; returns an unsubscribe fn */
export function onInstallState(cb) {
  listeners.add(cb);
  cb({ canPrompt: Boolean(deferredPrompt), installed: installed || isStandalone() });
  return () => listeners.delete(cb);
}

export function canInstall() {
  return !installed && Boolean(deferredPrompt);
}

/**
 * Show the Android default install popup (the "shortcut/app" dialog the user
 * asked for). Returns true if the prompt was shown.
 *
 * iOS Safari doesn't support beforeinstallprompt — it returns false so the
 * caller can fall back to a "use your browser menu → Add to Home Screen" hint.
 */
export async function promptInstall() {
  if (deferredPrompt) {
    const pr = deferredPrompt;
    deferredPrompt = null;
    emit();
    await pr.prompt();
    try {
      const result = await pr.userChoice; // Chrome 108+ resolves immediately
      installed = result && result.outcome === "accepted" ? true : installed;
    } catch {
      /* userChoice optional in newer Chrome */
    }
    return true; // the native dialog was shown
  }
  return false; // not installable right now (or iOS)
}