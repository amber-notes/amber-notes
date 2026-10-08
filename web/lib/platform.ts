/// Which platform a visitor is on, so someone on Windows, Android or Linux isn't offered a Mac
/// download as the page's main button (app/PlatformNote.tsx tells them Amber Notes is for iPhone
/// and Mac instead), and someone on an iPhone is told about the iPhone app.

export type Platform = "ios" | "mac" | "windows" | "android" | "linux" | "other";

/// Seeing the site as another platform's visitor does: ambernotes.app/?as=windows (or android,
/// linux, iphone, mac) sets it for the browser tab, in sessionStorage under this key, and ?as=off
/// clears it. A preview shows a "Dev" pill (app/PlatformPreview.tsx). The names are the ones the
/// pill shows.
export const PREVIEW_KEY = "amber.platform-as";
export const PREVIEWS: [string, string][] = [["windows", "Windows"], ["android", "Android"], ["linux", "Linux"], ["iphone", "iPhone"], ["mac", "Mac"]];

/// Runs in <head> before first paint and marks <html> with data-platform, so site.css shows the
/// right call to action from the first frame: nothing flashes and nothing moves. A platform it
/// can't tell is "other", which keeps the page as the server sent it. An iPad that says it's a Mac
/// is told apart by its touch screen. A preview (?as=) wins over the real platform and also sets
/// data-as. The consent page's CSP allows this script by its hash (lib/connect-csp.ts), so change
/// it only here.
export const platformScript = `(function(){try{var n=navigator,d=document.documentElement,v=null,ok=/^(${PREVIEWS.map(([as]) => as).join("|")})$/;try{var q=/[?&]as=([a-z]+)(?:&|$)/.exec(location.search);v=q&&q[1]}catch(e){}try{var s=sessionStorage;if(v==="off")s.removeItem("${PREVIEW_KEY}");else if(ok.test(v))s.setItem("${PREVIEW_KEY}",v);else v=s.getItem("${PREVIEW_KEY}")}catch(e){}if(ok.test(v)){d.dataset.platform=v==="iphone"?"ios":v;d.dataset.as=v;return}var u=n.userAgent||"",h=(n.userAgentData&&n.userAgentData.platform)||"";d.dataset.platform=/iPhone|iPad|iPod/.test(u)||(/Macintosh/.test(u)&&n.maxTouchPoints>1)?"ios":/Android/.test(u)||h==="Android"?"android":/Windows/.test(u)||h==="Windows"?"windows":/Macintosh|Mac OS X/.test(u)||h==="macOS"?"mac":/CrOS/.test(u)?"other":/Linux|X11/.test(u)||h==="Linux"?"linux":"other"}catch(e){}})();`;

/// The address of "Send myself the link": an email to nobody yet, with the link in it. It works
/// without scripts, and it's what opens where the browser has no share sheet.
export function mailLink(url: string): string {
  return `mailto:?subject=${encodeURIComponent("Amber Notes")}&body=${encodeURIComponent(url)}`;
}

/// A click on "Send myself the link": the system's share sheet where the browser has one (phones,
/// Windows, Safari), so the visitor picks how to send it. Otherwise the link's own mailto: opens.
export function sendLink(nav: { share?: (data: { title: string; url: string }) => Promise<void> }, event: { preventDefault(): void }, url: string): void {
  if (typeof nav.share !== "function") return;
  event.preventDefault();
  nav.share({ title: "Amber Notes", url }).catch(() => { /* closed without sending */ });
}

/// Ends a preview: forgets it, and loads the page again without ?as= so the real platform is read.
export function endPreview(storage: () => { removeItem(key: string): void }, loc: { pathname: string; replace(url: string): void }): void {
  try { storage().removeItem(PREVIEW_KEY); } catch { /* nothing was stored */ }
  loc.replace(loc.pathname);
}
