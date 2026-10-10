// Loads amber-ui.css once, into the "amber-ui" layer (after amber-base, before the app's own CSS).
if (!document.querySelector('link[data-amber-ui]')) {
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = "amber-lib:///amber-ui/amber-ui.css";
  l.dataset.amberUi = "";
  document.head.appendChild(l);
}
