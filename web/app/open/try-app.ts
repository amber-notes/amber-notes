/// Hands an ambernotes:// link to the browser and calls `done` after `wait` ms with whether the
/// browser left for the app (the window lost focus or the page was hidden). Returns a function that
/// stops listening without calling `done`. Callers check the link first.
export function tryApp(href: string, wait: number, done: (opened: boolean) => void): () => void {
  let left = false;
  const away = () => { if (document.visibilityState === "hidden" || !document.hasFocus()) left = true; };
  window.addEventListener("blur", away);
  document.addEventListener("visibilitychange", away);
  window.addEventListener("pagehide", away);
  // Safari shows an "address is invalid" alert when a page itself goes to a scheme no app
  // handles, so there the attempt goes through a hidden frame; elsewhere the page navigates.
  const ua = navigator.userAgent;
  const safari = /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/.test(ua);
  let frame: HTMLIFrameElement | undefined;
  if (safari) {
    frame = document.createElement("iframe");
    frame.style.display = "none";
    frame.src = href;
    document.body.appendChild(frame);
  } else window.location.href = href;
  const stop = () => {
    window.clearTimeout(timer);
    window.removeEventListener("blur", away);
    document.removeEventListener("visibilitychange", away);
    window.removeEventListener("pagehide", away);
    frame?.remove();
  };
  const timer = window.setTimeout(() => { stop(); done(left); }, wait);
  return stop;
}
