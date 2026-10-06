/// Which site pages are cream and which are leaf brown. Shared notes and the report form have no
/// fixed theme: they follow the visitor's system (app/site.css), cream in light and leaf brown in dark.
/// Any other address is a site page, so an address the site doesn't have gets the site's own 404.
export function themeFor(path: string): "cream" | "leaf" | null {
  if (/^\/(n|s|t|report)(\/|$)/.test(path)) return null;
  if (/^\/(changelog|support|help|privacy-security|privacy|terms)(\/|$)/.test(path)) return "leaf";
  return "cream";
}

/// Runs in <head> before first paint, so a page never flashes the wrong theme. The consent page's
/// CSP allows it by its hash (middleware.ts), so change it only here.
export const themeScript = `(function(){var p=location.pathname,t=/^\\/(n|s|t|report)(\\/|$)/.test(p)?null:/^\\/(changelog|support|help|privacy-security|privacy|terms)(\\/|$)/.test(p)?"leaf":"cream";if(t)document.documentElement.dataset.theme=t;})();`;
