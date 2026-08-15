import { useEffect, useState } from "react";

export function OfflineBanner() {
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  if (online) return null;

  return (
    <div className="offline-banner" role="status" aria-live="polite">
      <strong>Offline.</strong>
      <span>Live operational data is unavailable and is not treated as current.</span>
    </div>
  );
}
