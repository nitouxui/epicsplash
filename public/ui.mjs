export const $ = id => document.getElementById(id);
export function el(tag, content, attrs = {}) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  if (content != null) element.append(content);
  return element;
}
export function button(label, action, disabled = false) {
  const element = el('button', label, {type: 'button'});
  element.onclick = action;
  element.disabled = disabled;
  return element;
}
