/// Which site pages are cream and which are leaf brown. Anything else (shared notes) has no theme.
export function themeFor(path: string): "cream" | "leaf" | null {
  if (/^\/(changelog|support|help)(\/|$)/.test(path)) return "leaf";
  if (path === "/" || /^\/(download|privacy|terms|blog|connect)(\/|$)/.test(path)) return "cream";
  return null;
}

/// Runs in <head> before first paint, so a page never flashes the wrong theme. The consent page's
/// CSP allows it by its hash (middleware.ts), so change it only here.
export const themeScript = `(function(){var p=location.pathname,t=/^\\/(changelog|support|help)(\\/|$)/.test(p)?"leaf":(p==="/"||/^\\/(download|privacy|terms|blog|connect)(\\/|$)/.test(p))?"cream":null;if(t)document.documentElement.dataset.theme=t;})();`;
