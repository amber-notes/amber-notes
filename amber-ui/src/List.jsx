import { Icon } from "./Icon.jsx";

// A grouped list, like Settings: <List title="Today"><ListRow title="Walk" /></List>.
export function List({ title, footer, class: cls = "", children }) {
  return (
    <div class={`aui-list ${cls}`}>
      {title && <h2 class="aui-list__title">{title}</h2>}
      <div class="aui-list__rows" role="list">{children}</div>
      {footer && <p class="aui-list__footer">{footer}</p>}
    </div>
  );
}

// A row: title and subtitle on the left, trailing text or controls on the right. With onClick or
// href it is a button or link and shows a chevron (unless chevron={false}).
export function ListRow({ title, subtitle, leading, trailing, onClick, href, chevron, class: cls = "", children }) {
  const action = onClick || href;
  const body = (
    <>
      {leading && <span class="aui-row__leading">{leading}</span>}
      <span class="aui-row__text">
        <span class="aui-row__title">{title}</span>
        {subtitle && <span class="aui-row__subtitle">{subtitle}</span>}
        {children}
      </span>
      {trailing != null && <span class="aui-row__trailing">{trailing}</span>}
      {action && chevron !== false && <Icon name="chevron" class="aui-row__chevron" />}
    </>
  );
  if (href) return <a role="listitem" class={`aui-row aui-row--action ${cls}`} href={href}>{body}</a>;
  if (onClick) return <button role="listitem" type="button" class={`aui-row aui-row--action ${cls}`} onClick={onClick}>{body}</button>;
  return <div role="listitem" class={`aui-row ${cls}`}>{body}</div>;
}
