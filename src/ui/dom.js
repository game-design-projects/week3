// Minimal DOM helpers shared by every screen. No framework on purpose — the
// game is small and the student editing it afterwards should be able to read
// every line.

/**
 * Create an element.
 *   h('button', { class: 'btn', onclick: fn, dataset: { testid: 'x' } }, 'Label')
 * Props: `class`, `style` (string or object), `dataset`, `on<event>` handlers,
 * boolean attributes (true → present, false/null → absent), anything else → attribute.
 * Children: strings, numbers, nodes, arrays (flattened), null/false (skipped).
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class' || key === 'className') el.className = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'html') el.innerHTML = value;
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else el.append(child instanceof Node ? child : String(child));
  }
}

/** Replace an element's children, with the same child rules as h() (arrays flattened, null skipped). */
export function fill(el, ...children) {
  clear(el);
  append(el, children);
  return el;
}

/** Remove all children. */
export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** querySelector shorthand scoped to a root. */
export function $(root, selector) {
  return root.querySelector(selector);
}

export function $$(root, selector) {
  return Array.from(root.querySelectorAll(selector));
}

/** Relative URL of a piece image, e.g. pieceUrl('w', 'n') → 'assets/pieces/wN.svg'. */
export function pieceUrl(color, type) {
  return `assets/pieces/${color}${type.toUpperCase()}.svg`;
}

/** <img> for a piece, sized by CSS. */
export function pieceImg(color, type, extraClass = '') {
  return h('img', {
    class: `piece-img ${extraClass}`.trim(),
    src: pieceUrl(color, type),
    alt: `${color === 'w' ? 'White' : 'Black'} ${type}`,
    draggable: 'false',
  });
}

/** Trigger a file download of `text` (used for telemetry export). */
export function downloadText(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename, style: 'display:none' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Format milliseconds as m:ss. */
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '–';
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
}
