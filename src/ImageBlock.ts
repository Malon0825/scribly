import { Node } from "@tiptap/core";
import type { DOMOutputSpec } from "@tiptap/pm/model";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { ImageBlockView } from "./ImageBlockView";
import { safeImageSource } from "./imageFiles";
import { imageElementSource, imageSourceAttributes } from "./attachments";
import { inkAttributes } from "./inkData";

export const imageWidth = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.max(20, Math.min(100, n)) : 100;
};
export const imageAlign = (value: unknown) => ["left", "right"].includes(String(value)) ? String(value) : "center";
export const NotifyImage = Node.create({
  name: "image", group: "block", atom: true, draggable: true,
  addAttributes() {
    return {
      src: { default: "", parseHTML: (el) => imageElementSource(el.matches("img") ? el : el.querySelector("img")) },
      alt: { default: "", parseHTML: (el) => (el.matches("img") ? el : el.querySelector("img"))?.getAttribute("alt")?.slice(0, 300) || "" },
      title: { default: "", parseHTML: (el) => (el.matches("img") ? el : el.querySelector("img"))?.getAttribute("title")?.slice(0, 300) || "" },
      width: { default: 100, parseHTML: (el) => imageWidth(el.getAttribute("data-width")) },
      align: { default: "center", parseHTML: (el) => imageAlign(el.getAttribute("data-align")) },
      caption: { default: "", parseHTML: (el) => el.querySelector("figcaption")?.textContent?.slice(0, 2000) || "" },
    };
  },
  parseHTML() {
    return [{ tag: "figure[data-notify-image]", getAttrs: (el) => safeImageSource(imageElementSource(el.querySelector("img"))) ? {} : false },
      { tag: "img", getAttrs: (el) => el.closest("figure[data-notify-image]") || !safeImageSource(imageElementSource(el)) ? false : {} }];
  },
  renderHTML({ node }) {
    const { src, alt, title, width, align, caption } = node.attrs;
    if (!safeImageSource(src)) return ["p", "[Image unavailable]"];
    return ["figure", { ...inkAttributes(node.attrs.ink), "data-notify-image": "", "data-width": imageWidth(width), "data-align": imageAlign(align) },
      ["img", { ...imageSourceAttributes(src), alt, title }], ...(caption ? [["figcaption", {}, String(caption).slice(0, 2000)]] : [])] as DOMOutputSpec;
  },
  addNodeView() { return ReactNodeViewRenderer(ImageBlockView); },
});
