/// Which platform a visitor is on, so someone on Windows, Android or Linux isn't offered a Mac
/// download as the page's main button (app/PlatformInterest.tsx asks whether they want Amber Notes
/// there instead), and someone on an iPhone is told about the iPhone app.

export type Platform = "ios" | "mac" | "windows" | "android" | "linux" | "other";

/// The platforms Amber Notes doesn't run on that the site asks about, with the name it shows.
export const ASKED: [Platform, string][] = [["windows", "Windows"], ["android", "Android"], ["linux", "Linux"]];

/// The browser's localStorage key for "this visitor already said yes". Holds "1", nothing else.
export const INTEREST_KEY = "amber.platform-interest";

/// Seeing the site as another platform's visitor does: ambernotes.app/?as=windows (or android,
/// linux, iphone, mac) sets it for the browser tab, in sessionStorage under this key, and ?as=off
/// clears it. A preview counts nothing (lib/posthog.ts) and shows a "Dev" pill
/// (app/PlatformPreview.tsx). The names are the ones the pill shows.
export const PREVIEW_KEY = "amber.platform-as";
export const PREVIEWS: [string, string][] = [["windows", "Windows"], ["android", "Android"], ["linux", "Linux"], ["iphone", "iPhone"], ["mac", "Mac"]];

/// Runs in <head> before first paint and marks <html> with data-platform, and with
/// data-interest="done" for a visitor who already said yes, so site.css shows the right call to
/// action from the first frame: nothing flashes and nothing moves. A platform it can't tell is
/// "other", which keeps the page as the server sent it. An iPad that says it's a Mac is told apart
/// by its touch screen. A preview (?as=) wins over the real platform and also sets data-as; it
/// never reads the real "already said yes". The consent page's CSP allows this script by its hash
/// (lib/connect-csp.ts), so change it only here.
export const platformScript = `(function(){try{var n=navigator,d=document.documentElement,v=null,ok=/^(${PREVIEWS.map(([as]) => as).join("|")})$/;try{var q=/[?&]as=([a-z]+)(?:&|$)/.exec(location.search);v=q&&q[1]}catch(e){}try{var s=sessionStorage;if(v==="off")s.removeItem("${PREVIEW_KEY}");else if(ok.test(v))s.setItem("${PREVIEW_KEY}",v);else v=s.getItem("${PREVIEW_KEY}")}catch(e){}if(ok.test(v)){d.dataset.platform=v==="iphone"?"ios":v;d.dataset.as=v;return}var u=n.userAgent||"",h=(n.userAgentData&&n.userAgentData.platform)||"";d.dataset.platform=/iPhone|iPad|iPod/.test(u)||(/Macintosh/.test(u)&&n.maxTouchPoints>1)?"ios":/Android/.test(u)||h==="Android"?"android":/Windows/.test(u)||h==="Windows"?"windows":/Macintosh|Mac OS X/.test(u)||h==="macOS"?"mac":/CrOS/.test(u)?"other":/Linux|X11/.test(u)||h==="Linux"?"linux":"other";try{if(localStorage.getItem("${INTEREST_KEY}"))d.dataset.interest="done"}catch(e){}}catch(e){}})();`;

/// The visitor said yes: every ask on the page becomes its thanks, and stays that way in this
/// browser. A browser that refuses storage still shows the thanks until the page is reloaded, and
/// so does a preview, which never writes the real value.
export function markInterest(doc: { documentElement: { dataset: Record<string, string | undefined> } }, storage: () => { setItem(key: string, value: string): void }): void {
  const html = doc.documentElement.dataset;
  html.interest = "done";
  if (html.as) return;
  try { storage().setItem(INTEREST_KEY, "1"); } catch { /* private mode, or storage turned off */ }
}

/// Ends a preview: forgets it, and loads the page again without ?as= so the real platform is read.
export function endPreview(storage: () => { removeItem(key: string): void }, loc: { pathname: string; replace(url: string): void }): void {
  try { storage().removeItem(PREVIEW_KEY); } catch { /* nothing was stored */ }
  loc.replace(loc.pathname);
}
