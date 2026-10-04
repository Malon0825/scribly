// A separate document keeps print preparation out of the live editor. Printing
// is a dialog handoff: browsers do not report whether a PDF or paper was saved.
let activePrint: (() => void) | null = null;

function cancelled() { return new DOMException("Export cancelled.", "AbortError"); }

function printDocument(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,iframe,frame,frameset,object,embed,link,base,meta").forEach(node => node.remove());
  for (const node of doc.querySelectorAll("*")) {
    for (const attr of Array.from(node.attributes)) {
      if (/^on/i.test(attr.name) || ["srcdoc", "srcset", "formaction", "action", "autofocus"].includes(attr.name)) node.removeAttribute(attr.name);
    }
    // Even sandboxed links must not initiate navigation or external protocols.
    if (node.localName === "a") { node.removeAttribute("href"); node.removeAttribute("target"); }
  }
  const policy = doc.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  doc.head.prepend(policy);
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

/** Resolve only when window.print was requested, never when a PDF was saved. */
export async function printNoteExport(html: string, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw cancelled();
  if (activePrint) throw Error("A print request is already open. Close it before exporting again.");
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const selection = document.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
  const iframe = document.createElement("iframe");
  iframe.title = "Formatted note for printing";
  // Same-origin permits readiness inspection; scripts remain disabled. Modals
  // are required by the HTML print algorithm even when the parent calls print.
  iframe.setAttribute("sandbox", "allow-same-origin allow-modals");
  iframe.setAttribute("aria-hidden", "true");
  iframe.tabIndex = -1;
  Object.assign(iframe.style, { position: "fixed", left: "-10000px", top: "0", width: "800px", height: "1100px", border: "0", pointerEvents: "none" });
  let cleaned = false;
  let printWindow: Window | null = null;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let rejectPending: ((reason: unknown) => void) | undefined;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (timeout) clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
    printWindow?.removeEventListener("afterprint", cleanup);
    window.removeEventListener("pagehide", cleanup);
    iframe.remove();
    activePrint = null;
    if (focused?.isConnected && (document.activeElement === iframe || document.activeElement === document.body)) {
      focused.focus({ preventScroll: true });
      if (selection && ranges.every(range => range.commonAncestorContainer.isConnected)) {
        selection.removeAllRanges();
        ranges.forEach(range => selection.addRange(range));
      }
    }
  };
  const onAbort = () => { rejectPending?.(cancelled()); cleanup(); };
  activePrint = cleanup;
  signal?.addEventListener("abort", onAbort, { once: true });
  window.addEventListener("pagehide", cleanup, { once: true });
  try {
    await new Promise<void>((resolve, reject) => {
      rejectPending = reject;
      timeout = setTimeout(() => rejectPending?.(Error("The printable document did not finish loading. Try exporting HTML instead.")), 30000);
      iframe.addEventListener("load", () => resolve(), { once: true });
      iframe.addEventListener("error", () => reject(Error("The printable document could not load.")), { once: true });
      iframe.srcdoc = printDocument(html);
      document.body.append(iframe);
    });
    if (cleaned || signal?.aborted) throw cancelled();
    printWindow = iframe.contentWindow;
    const doc = iframe.contentDocument;
    if (!printWindow || !doc || typeof printWindow.print !== "function") throw Error("Printing is unavailable. Export HTML and print it in a browser instead.");
    await Promise.race([
      Promise.all([
        doc.fonts.ready,
        ...Array.from(doc.images, image => {
          image.loading = "eager";
          return image.decode().catch(() => { throw Error("An exported image could not load. Try exporting HTML instead."); });
        }),
      ]),
      new Promise<never>((_, reject) => { rejectPending = reject; }),
    ]);
    if (cleaned || signal?.aborted) throw cancelled();
    if (timeout) clearTimeout(timeout);
    rejectPending = undefined;
    printWindow.addEventListener("afterprint", cleanup, { once: true });
    let started = false;
    const beforePrint = () => { started = true; };
    printWindow.addEventListener("beforeprint", beforePrint, { once: true });
    printWindow.focus();
    try { printWindow.print(); }
    finally { printWindow.removeEventListener("beforeprint", beforePrint); }
    if (!started) throw Error("The print request was blocked. Export HTML and print it in a browser instead.");
    // Chromium can keep print() pending until dismissal or return immediately.
    // Keep its source mounted until afterprint rather than using an exit timer.
  } catch (error) {
    cleanup();
    throw error;
  }
}
