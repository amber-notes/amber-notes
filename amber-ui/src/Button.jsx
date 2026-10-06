// variant: "primary" (default), "secondary", "plain" or "destructive"; size: "regular" or "small".
export function Button({ variant = "primary", size = "regular", class: cls = "", type = "button", children, ...props }) {
  return (
    <button type={type} class={`aui-button aui-button--${variant} aui-button--${size} ${cls}`} {...props}>
      {children}
    </button>
  );
}
