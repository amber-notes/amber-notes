import { render, hydrate, unmountComponentAtNode } from "react";
export function createRoot(container) { return { render(children) { render(children, container); }, unmount() { unmountComponentAtNode(container); } }; }
export function hydrateRoot(container, children) { hydrate(children, container); return createRoot(container); }
