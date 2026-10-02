/// Which platform a visitor is on, so someone on Windows, Android or Linux isn't offered a Mac
/// download as the page's main button (app/PlatformInterest.tsx asks whether they want Amber Notes
/// there instead), and someone on an iPhone is told about the iPhone app.

export type Platform = "ios" | "mac" | "windows" | "android" | "linux" | "other";

/// The platforms Amber Notes doesn't run on that the site asks about, with the name it shows.
export const ASKED: [Platform, string][] = [["windows", "Windows"], ["android", "Android"], ["linux", "Linux"]];

/// The browser's localStorage key for "this visitor already said yes". Holds "1", nothing else.
export const INTEREST_KEY = "amber.platform-interest";

/// Runs in <head> before first paint and marks <html> with data-platform, and with
/// data-interest="done" for a visitor who already said yes, so site.css shows the right call to
/// action from the first frame: nothing flashes and nothing moves. A platform it can't tell is
/// "other", which keeps the page as the server sent it. An iPad that says it's a Mac is told apart
/// by its touch screen. The consent page's CSP allows this script by its hash (lib/connect-csp.ts),
/// so change it only here.
export const platformScript = `(function(){try{var n=navigator,d=document.documentElement,u=n.userAgent||"",h=(n.userAgentData&&n.userAgentData.platform)||"";d.dataset.platform=/iPhone|iPad|iPod/.test(u)||(/Macintosh/.test(u)&&n.maxTouchPoints>1)?"ios":/Android/.test(u)||h==="Android"?"android":/Windows/.test(u)||h==="Windows"?"windows":/Macintosh|Mac OS X/.test(u)||h==="macOS"?"mac":/CrOS/.test(u)?"other":/Linux|X11/.test(u)||h==="Linux"?"linux":"other";try{if(localStorage.getItem("${INTEREST_KEY}"))d.dataset.interest="done"}catch(e){}}catch(e){}})();`;

/// The visitor said yes: every ask on the page becomes its thanks, and stays that way in this
/// browser. A browser that refuses storage still shows the thanks until the page is reloaded.
export function markInterest(doc: { documentElement: { dataset: Record<string, string | undefined> } }, storage: () => { setItem(key: string, value: string): void }): void {
  doc.documentElement.dataset.interest = "done";
  try { storage().setItem(INTEREST_KEY, "1"); } catch { /* private mode, or storage turned off */ }
}
