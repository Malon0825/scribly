import { Mark } from "@tiptap/core";

export const textColors = ["blue", "purple", "green", "gray", "brown", "orange", "yellow", "pink", "red"] as const;
export type TextColor = typeof textColors[number];
export const validTextColor = (value: unknown): value is TextColor => textColors.includes(value as TextColor);
function colorMark(name: string, attribute: string) {
  return Mark.create({
    name,
    addAttributes() {
      return { tone: { default: null, parseHTML: (el) => el.getAttribute(attribute), rendered: false } };
    },
    parseHTML() { return [{ tag: `span[${attribute}]`, getAttrs: (el) => validTextColor(el.getAttribute(attribute)) ? {} : false }]; },
    renderHTML({ mark }) { return ["span", validTextColor(mark.attrs.tone) ? { [attribute]: mark.attrs.tone } : {}, 0]; },
  });
}
export const NoteTextColor = colorMark("noteTextColor", "data-text-color");
export const NoteBackgroundColor = colorMark("noteBackgroundColor", "data-background-color");
