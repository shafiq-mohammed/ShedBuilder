type Child = Node | string | null | undefined | false;

/** Tiny DOM builder: h('div.cls#id', {onclick, title}, ...children) */
export function h<K extends keyof HTMLElementTagNameMap>(
  spec: string,
  attrs: Record<string, any> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const [tagPart] = spec.split(/(?=[.#])/);
  const tag = tagPart || 'div';
  const el = document.createElement(tag) as HTMLElementTagNameMap[K];
  for (const part of spec.slice(tag.length).split(/(?=[.#])/)) {
    if (part.startsWith('.')) el.classList.add(part.slice(1));
    else if (part.startsWith('#')) el.id = part.slice(1);
  }
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k.startsWith('on') && typeof v === 'function') (el as any)[k] = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(c));
  }
  return el;
}

export const $ = (sel: string, root: ParentNode = document) =>
  root.querySelector(sel) as HTMLElement;
