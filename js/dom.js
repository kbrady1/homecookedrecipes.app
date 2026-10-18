// Small DOM helpers. Every text value goes through `textContent`, never `innerHTML`.

export function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  Object.entries(props).forEach(([key, value]) => {
    if (value == null || value === false) return;
    if (key === "class") element.className = value;
    else if (key === "style") Object.assign(element.style, value);
    else if (key.startsWith("on")) element.addEventListener(key.slice(2).toLowerCase(), value);
    else element.setAttribute(key, value === true ? "" : value);
  });
  append(element, children);
  return element;
}

function append(element, children) {
  children.flat(Infinity).forEach((child) => {
    if (child == null || child === false) return;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  });
}

const SVG_NS = "http://www.w3.org/2000/svg";

export function icon(name, className = "icon") {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

// An image that falls back to the HomeCooked placeholder when the URL is missing or fails to load.
export function recipeImage(url, className) {
  const frame = h("div", { class: `${className} image-frame` }, h("div", { class: "placeholder-mark" }));
  if (url) {
    const img = h("img", { src: url, alt: "", loading: "lazy", decoding: "async" });
    img.addEventListener("load", () => frame.classList.add("loaded"));
    img.addEventListener("error", () => img.remove());
    frame.append(img);
  }
  return frame;
}
