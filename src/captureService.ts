import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { desktop, loadWorkspace } from "./storage";
import type { Note, Workspace } from "./types";

export type CaptureSubmission = { id: string; title: string; text: string; createdAt: string; openAfterSave: boolean };
export type CaptureStatus = {
  enabled: boolean; shortcut: string; registered: boolean; warning: string | null;
  draft: { title: string; text: string } | null; pending: CaptureSubmission | null; lastSavedId: string | null;
};
const KEY = "scribly-quick-capture-v1";
const pendingEvent = "quick-capture-pending", statusEvent = "quick-capture-status", openEvent = "quick-capture-open";
const defaults = (): CaptureStatus => ({ enabled: false, shortcut: "Ctrl+Alt+N", registered: false, warning: "", draft: null, pending: null, lastSavedId: null });
function readBrowser(): CaptureStatus {
  const raw = localStorage.getItem(KEY);
  if (!raw) return defaults();
  const value = JSON.parse(raw) as CaptureStatus;
  if (!value || ![null, "object"].includes(value.draft === null ? null : typeof value.draft) ||
      (value.draft && (typeof value.draft.title !== "string" || typeof value.draft.text !== "string")) ||
      (value.pending && (typeof value.pending.id !== "string" || typeof value.pending.title !== "string" || typeof value.pending.text !== "string" || typeof value.pending.createdAt !== "string"))) {
    throw Error("The capture draft could not be read. Its stored copy was retained.");
  }
  return { ...defaults(), ...value };
}
function writeBrowser(value: CaptureStatus) {
  localStorage.setItem(KEY, JSON.stringify(value));
  window.dispatchEvent(new Event(statusEvent));
  return value;
}
export function captureContent(text: string) {
  return text.split("\n").map(line => `<p>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;") || "<br>"}</p>`).join("");
}
export function appendCapture(workspace: Workspace, capture: CaptureSubmission): Workspace {
  const existing = workspace.notes.find(note => note.id === capture.id);
  if (existing) {
    if (existing.title !== capture.title || existing.content !== captureContent(capture.text) || existing.kind === "board" || existing.kind === "template") {
      throw Error("This capture ID already belongs to different content. The draft was retained.");
    }
    return workspace;
  }
  let inbox = workspace.folders.find(folder => folder.name.trim().toLowerCase() === "inbox");
  if (!inbox) inbox = { id: `capture-inbox-${capture.id}`, name: "Inbox" };
  const note: Note = { id: capture.id, folderId: inbox.id, title: capture.title, content: captureContent(capture.text), createdAt: capture.createdAt, updatedAt: capture.createdAt, archived: false };
  return { ...workspace, folders: workspace.folders.some(folder => folder.id === inbox.id) ? workspace.folders : [...workspace.folders, inbox], notes: [...workspace.notes, note] };
}
export async function getCaptureStatus(): Promise<CaptureStatus> {
  return desktop ? invoke<CaptureStatus>("quick_capture_status") : readBrowser();
}
export async function writeCaptureDraft(title: string, text: string): Promise<CaptureStatus> {
  text = text.replace(/\r\n?/g, "\n");
  if (Array.from(title).length > 120 || new TextEncoder().encode(text).length > 256 * 1024) throw Error("Capture supports a title up to 120 characters and text up to 256 KiB. Your text remains here.");
  if (desktop) return invoke<CaptureStatus>("write_capture_draft", { title, text });
  const value = readBrowser();
  if (value.pending) throw Error("Finish the pending capture before editing another draft.");
  return writeBrowser({ ...value, draft: { title, text }, warning: "", lastSavedId: null });
}
export async function submitCapture(openAfterSave: boolean): Promise<CaptureStatus> {
  const value = await getCaptureStatus();
  if (value.pending) return retryCapture();
  const draft = value.draft;
  if (!draft || (!draft.title.trim() && !draft.text.trim())) throw Error("Write a title or some text before saving.");
  const title = draft.title.trim() || Array.from(draft.text.split("\n").find(line => line.trim())?.trim() || "Quick capture").slice(0, 80).join("");
  const pending: CaptureSubmission = { id: crypto.randomUUID(), title, text: draft.text, createdAt: new Date().toISOString(), openAfterSave };
  if (desktop) return invoke<CaptureStatus>("submit_quick_capture", pending);
  const result = writeBrowser({ ...value, pending, warning: "", lastSavedId: null });
  window.dispatchEvent(new Event(pendingEvent));
  return result;
}
export async function retryCapture(): Promise<CaptureStatus> {
  const value = await getCaptureStatus();
  if (!value.pending) throw Error("There is no pending capture to retry.");
  if (desktop) return invoke<CaptureStatus>("submit_quick_capture", value.pending);
  const result = writeBrowser({ ...value, warning: "" });
  window.dispatchEvent(new Event(pendingEvent));
  return result;
}
export async function finishCapture(id: string) {
  if (desktop) { await invoke("finish_quick_capture", { id }); return; }
  const value = readBrowser();
  if (value.pending?.id !== id) return;
  const saved = await loadWorkspace(), note = saved.document?.notes.find(item => item.id === id);
  if (!note || note.title !== value.pending.title || note.content !== captureContent(value.pending.text)) throw Error("The capture has not been confirmed in storage. Retry saving.");
  writeBrowser({ ...value, draft: null, pending: null, warning: "", lastSavedId: id });
}
export async function reportCaptureError(id: string, error: string) {
  if (desktop) { await invoke("report_quick_capture_error", { id, error }); return; }
  const value = readBrowser();
  if (value.pending?.id === id) writeBrowser({ ...value, warning: error });
}
export async function subscribeCaptureStatus(callback: () => void): Promise<() => void> {
  if (desktop) return listen(statusEvent, callback);
  const storage = (event: StorageEvent) => { if (event.key === KEY) callback(); };
  window.addEventListener(statusEvent, callback); window.addEventListener("storage", storage);
  return () => { window.removeEventListener(statusEvent, callback); window.removeEventListener("storage", storage); };
}
export async function subscribeCapturePending(callback: () => void): Promise<() => void> {
  if (desktop) return listen(pendingEvent, callback);
  window.addEventListener(pendingEvent, callback);
  return () => window.removeEventListener(pendingEvent, callback);
}
export async function subscribeCaptureOpen(callback: (id: string) => void): Promise<() => void> {
  if (desktop) return listen<string>(openEvent, event => callback(event.payload));
  const handler = (event: Event) => callback((event as CustomEvent<string>).detail);
  window.addEventListener(openEvent, handler);
  return () => window.removeEventListener(openEvent, handler);
}
export async function openCapturedNote(id: string) {
  if (desktop) await invoke("open_capture_note", { id });
  else window.dispatchEvent(new CustomEvent(openEvent, { detail: id }));
}
export async function hideCapture() { if (desktop) await getCurrentWindow().hide(); }
export async function openNativeCapture() { await invoke("open_quick_capture"); }
export async function setCapturePreferences(enabled: boolean, shortcut: string): Promise<CaptureStatus> {
  if (!desktop) throw Error("Global shortcuts are available in the Windows app.");
  return invoke<CaptureStatus>("set_quick_capture_preferences", { enabled, shortcut });
}
export async function drainCaptureForShutdown() {
  if (!desktop || !(await WebviewWindow.getByLabel("quick-capture"))) return;
  const requestId = crypto.randomUUID();
  await new Promise<void>((resolve, reject) => {
    let off: (() => void) | undefined;
    const timer = setTimeout(() => { off?.(); reject(Error("Quick capture has not confirmed its draft. Close capture and retry closing the notebook.")); }, 10000);
    void listen<{ requestId: string; error?: string }>("quick-capture-drained", event => {
      if (event.payload.requestId !== requestId) return;
      clearTimeout(timer); off?.();
      if (event.payload.error) reject(Error(event.payload.error)); else resolve();
    }).then(unsubscribe => {
      off = unsubscribe;
      return emitTo("quick-capture", "quick-capture-drain", { requestId });
    }).catch(error => { clearTimeout(timer); off?.(); reject(error); });
  });
}
