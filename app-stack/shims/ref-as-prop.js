// React 19 passes `ref` to function components as a prop; Preact hands them its own component
// object instead. Libraries written for React 19 (shadcn/ui's components, Radix's Slot) need the
// React behaviour, so a ref on a function component (not a class, not forwardRef) goes into props.
import { options } from "preact";

const previous = options.vnode;
options.vnode = (vnode) => {
  const type = vnode.type;
  if (typeof type === "function" && vnode.ref && !(type.prototype && type.prototype.render) && !type.__f) {
    vnode.props.ref = vnode.ref;
    vnode.ref = null;
  }
  if (previous) previous(vnode);
};
