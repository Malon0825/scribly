# Parent browser observation record

Collected October 4, 2026 on this worktree's isolated port 1430. This supplements the tool transcript and screenshots; it is not an automated test log or native WebView2 result.

- Light and Dark, Large, 850×600, default text scaling: `.sidebar-scroll` measured 17.1px overall with 13.2px vertical padding; Sidebar 491.1px high. Creation112.2px, search48.4px, notebook controls80px, footer164.7px. This leaves about3.9px of list content. Screenshots `light-large-850.jpg` / `dark-large-850.jpg`.
- Selected Filter option keyboard highlight: computed outline none,1px inset --line. Exact theme token ratios are in contrast-measurements.json; screenshot select-focus.jpg.
- Settings→About→Keyboard shortcuts: immediately after replacement, activeElement BODY. Following Tab focused Done inside the modal. The saved modal-focus-leak.json describes the latter outcome and must not be used to claim background focus escape.
- Delete confirmation initially focused Close dialog; Cancel returned focus to Note options. Background application DOM was not inert. dialog-runtime.json records this flow. No actual screen-reader modal background traversal was performed.
- Ordinary selected text context and Shift+F10 showed only semantic color commands; no native edit commands in the custom surface. Empty/code exclusions remain native; installed WebView clipboard/spelling contents were not checked.
- Reference at850×600 Medium used a310px absolute panel overlapping about300px of559.4px editor. reference-minimum.jpg.
- Board at850×600 Medium: title50.5px, topbar56px, toolbar44px, conservative chrome25.083%, canvas448.9px; board-minimum.jpg. Excalidraw main-menu button had no text/title/aria-label, hidden SVG; raw DOM saved board-main-menu-runtime.json.
- Toolbar overflow at minimum width is horizontally scrollable; do not classify offscreen toolbar buttons as permanently inaccessible clipping.
- Dark Medium 1920/2560×1080: content width679.21px, centered. No full Latin character-per-line measurement was made; approximate line-length targets remain separate.
- Width snapshots in runtime-measurements.json can include intermediate grid animation geometry; stable final-width comparisons need a settled capture. Chrome height comparisons use static bars.
