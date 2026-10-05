# Reference resizing and note actions

The sidebar note action button has a scaled 9px inset and a 30px square target. Note titles and previews reserve the button's space in all states, so hovering or keyboard focusing a row does not move the text or cover it with the button.

`PanelResize.tsx` shares the existing sidebar resize controller with Reference. Reference's left divider highlights on pointer-down; after 10 CSS pixels it captures the pointer and follows horizontal displacement from the initial width. Moving left widens Reference. The last pointer position commits the size; Escape, pointer cancellation, lost capture, window blur and effect cleanup restore the last committed preference. Arrow keys move the divider by 10px, Shift uses 40px, Home/End select the size limits, and double-click restores the responsive default. The preference is local to this device, with blocked storage handled without interrupting writing.

Reference uses its existing responsive default widths until customized. Its bounds start at 260–600px, scaled with the app's element size. In the desktop grid both controllers reserve at least 360 scaled pixels for the document; each observes the other panel and viewport changes. Narrow-window Reference retains the existing right-side overlay, with a divider at its left edge and a 32px viewport margin. Narrow windows temporarily clamp a stored preference and restore it when space returns.

Resizing deliberately changes grid layout because the document and Reference text must reflow at their real widths. During pointer and keyboard resizing the grid transition is disabled: animation does not trail the pointer, scale text, or run React updates per frame. A precision resize stops at the chosen size without inertia, snap targets, rubber-banding, or a settling spring. Reduced motion therefore uses the same direct tracking and immediate release. Existing panel-toggle transitions are otherwise retained.

Pointer-down prevents focus transfer, preserving the active Tiptap instance, caret and selection. Handles expose a labelled vertical separator, controlled panel, current value and limits. Hidden handles leave the tab order; entering Focus mode from either divider moves keyboard focus to Exit focus. Panels retain their existing solid theme surfaces, borders and shadows; the divider feedback uses `--accent`, with no new glass, backdrop, sound or animation dependency.


See [verification history](../tests/verification.md) for recorded results, source snapshots, and remaining limits.
