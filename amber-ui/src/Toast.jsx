import { render } from "preact";

// A short message near the bottom that goes by itself: toast("Saved"). Announced to VoiceOver.
// Use it only for things the app did on its own; Amber Notes already says "Changed" for note edits.
export function Toast({ message }) {
  return <div class="aui-toast" role="status">{message}</div>;
}

let host;
export function toast(message, ms = 2400) {
  if (!host) { host = document.createElement("div"); host.className = "aui-toast-host"; document.body.appendChild(host); }
  render(<Toast message={message} />, host);
  clearTimeout(host._t);
  host._t = setTimeout(() => render(null, host), ms);
}
