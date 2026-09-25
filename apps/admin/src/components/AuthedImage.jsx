import React, { useEffect, useState } from "react";
import { apiBlobUrl } from "../lib/api.js";

/**
 * Renders a storage key served by the authenticated /api/files endpoint.
 * `<img src>` can't carry a bearer token, so the bytes are fetched once and
 * exposed as an object URL (revoked on unmount / key change).
 */
export default function AuthedImage({ fileKey, alt = "proof", className = "", onClick }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!fileKey) return undefined;
    let alive = true;
    let created = null;
    setFailed(false);
    setUrl(null);
    apiBlobUrl(`/files/${fileKey}`)
      .then((u) => {
        if (!alive) {
          URL.revokeObjectURL(u);
          return;
        }
        created = u;
        setUrl(u);
      })
      .catch(() => { if (alive) setFailed(true); });
    return () => {
      alive = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [fileKey]);

  if (!fileKey) return <span className="text-xs text-[#a56a83]">—</span>;
  if (failed) return <span className="text-xs font-semibold text-rose-500">unavailable</span>;
  if (!url) {
    return <div className={`animate-pulse rounded-xl bg-[#fce4ee] ${className}`} />;
  }
  return (
    <img
      src={url}
      alt={alt}
      onClick={onClick}
      className={`cursor-zoom-in rounded-xl border border-[#f0c2d8] object-cover ${className}`}
    />
  );
}
