export function registerPwaServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (!("serviceWorker" in navigator)) return;
  if (!window.isSecureContext) return;

  window.addEventListener(
    "load",
    () => {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // Installability support must never prevent the operational UI from loading.
      });
    },
    { once: true },
  );
}
