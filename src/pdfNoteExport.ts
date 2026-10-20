import { invoke } from "@tauri-apps/api/core";
import { desktop, exportArtifact } from "./storage";
import { printNoteExport } from "./printNoteExport";

/** The desktop renderer uses an isolated document, never the live editor. */
export async function exportNotePdf(html: string, name: string, signal: AbortSignal): Promise<"saved" | "canceled" | "print"> {
  const check = () => { if (signal.aborted) throw new DOMException("Export canceled.", "AbortError"); };
  check();
  if (!desktop) {
    await printNoteExport(html, signal);
    return "print";
  }
  const bytes = await invoke<ArrayBuffer>("render_note_pdf", { html });
  check(); // Dismissing preparation must never open a later Save dialog.
  const saved = await exportArtifact(name, new Blob([bytes], { type: "application/pdf" }), "application/pdf");
  return saved ? "saved" : "canceled";
}
