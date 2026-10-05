/* Amber Notes router 1.0.0: screens for a Preact app, in memory. A note's app runs on a page that
   can't navigate (not even its #hash), so the route is kept here. Needs preact and preact-hooks.
   <Router><List path="/" default /><Item path="/item/:id" /></Router>, links as <a href="#/item/3">,
   route("/add"), back(), useRoute(). */
(function () {
  var h = preact.h, useState = preactHooks.useState, useLayoutEffect = preactHooks.useLayoutEffect;
  var current = "/", stack = [], subs = new Set();
  function go(path) { current = path; subs.forEach(function (f) { f(path); }); }
  function route(path) { if (path === current) return; stack.push(current); go(path); }
  function back() { if (stack.length) go(stack.pop()); }
  function useRoute() {
    var s = useState(current);
    // A layout effect: it runs as the screen is built, not on the next frame (which a hidden page may never draw).
    useLayoutEffect(function () { subs.add(s[1]); return function () { subs.delete(s[1]); }; }, []);
    return s[0];
  }
  function match(pattern, path) {
    var a = pattern.split("/").filter(Boolean), b = path.split("/").filter(Boolean), params = {};
    if (a.length !== b.length) return null;
    for (var i = 0; i < a.length; i++) {
      if (a[i].charAt(0) === ":") params[a[i].slice(1)] = decodeURIComponent(b[i]);
      else if (a[i] !== b[i]) return null;
    }
    return params;
  }
  function Router(props) {
    var path = useRoute(), kids = [].concat(props.children).filter(Boolean);
    for (var i = 0; i < kids.length; i++) {
      var c = kids[i], m = c.props.path ? match(c.props.path, path) : null;
      if (m) return h(c.type, Object.assign({}, c.props, m, { path: path }));
    }
    var d = kids.find(function (c) { return c.props.default; });
    return d ? h(d.type, Object.assign({}, d.props, { path: path })) : null;
  }
  function Link(props) {
    return h("a", Object.assign({}, props, { onClick: function (e) { e.preventDefault(); route(String(props.href || "/").replace(/^#/, "")); } }));
  }
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#/"]');
    if (a && !e.defaultPrevented) { e.preventDefault(); route(a.getAttribute("href").slice(1)); }
  });
  window.amberRouter = { Router: Router, Link: Link, route: route, back: back, useRoute: useRoute, get path() { return current; } };
})();
