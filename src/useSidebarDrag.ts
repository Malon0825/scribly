import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { applySidebarDrop, orderFolders, type SidebarDrop, type SidebarItem } from "./sidebarOrder";
import { orderNotes } from "./notebookNavigation";
import { isLiveItem, type Workspace } from "./types";

const MIME = "application/x-still-notes-sidebar";
const sameDrop = (a: SidebarDrop | null, b: SidebarDrop | null) =>
  JSON.stringify(a) === JSON.stringify(b);

export function useSidebarDrag({ workspace, update, reveal, announce, begin, reorderNotes = true }: {
  workspace: Workspace | null;
  update: (updater: (w: Workspace) => Workspace) => void | boolean;
  reveal: (folderId: string | null) => void;
  announce: (message: string) => void;
  begin: () => void;
  reorderNotes?: boolean;
}) {
  const [dragging, setDragging] = useState<SidebarItem | null>(null);
  const [target, setTarget] = useState<SidebarDrop | null>(null);
  const source = useRef<SidebarItem | null>(null);
  const scroll = useRef<{ element: HTMLElement; y: number } | null>(null);
  const frame = useRef(0);

  function finish() {
    source.current = null;
    scroll.current = null;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    setDragging(null);
    setTarget(null);
  }
  useEffect(() => {
    const cancel = () => finish();
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", key);
      cancelAnimationFrame(frame.current);
    };
  }, []);

  function commit(item: SidebarItem, destination: SidebarDrop, keyboard = false) {
    if (!workspace) return;
    const next = applySidebarDrop(workspace, item, destination);
    if (next === workspace) return;
    if (update((current) => applySidebarDrop(current, item, destination)) === false) {
      announce("Move could not be applied. Resolve the notebook save error and retry.");
      return;
    }
    if (destination.kind === "trash") {
      announce(`${item.kind === "folder" ? "Folder and its contents" : "Item"} moved to Trash. Restore it from Trash anytime.`);
    } else if (item.kind === "note") {
      const note = next.notes.find((n) => n.id === item.id)!;
      reveal(note.folderId);
      const folder = next.folders.find((f) => f.id === note.folderId)?.name || "Unfiled notes";
      announce(`“${note.title || "Untitled"}” positioned in ${folder}.`);
    } else announce("Folder order updated.");
    if (keyboard) requestAnimationFrame(() => {
      // A transfer mounts the note under a different folder. Restore its control.
      const controls = document.querySelectorAll<HTMLElement>("[data-sidebar-item]");
      Array.from(controls).find((el) => el.dataset.sidebarItem === `${item.kind}:${item.id}`)?.focus();
    });
  }

  function keyboardMove(event: KeyboardEvent<HTMLElement>, item: SidebarItem) {
    if (!workspace || !event.altKey || event.ctrlKey || event.metaKey ||
        !["ArrowUp", "ArrowDown"].includes(event.key)) return;
    const direction = event.key === "ArrowUp" ? -1 : 1;
    event.preventDefault();
    event.stopPropagation();
    const note = workspace.notes.find((n) => n.id === item.id);
    if (item.kind === "note" && (!note || note.archived || note.deletedAt)) return;
    if (event.shiftKey && item.kind === "note") {
      const folders = [...orderFolders(workspace.folders.filter(f => !f.deletedAt)).map((f) => f.id), null];
      const index = folders.indexOf(note!.folderId) + direction;
      if (index >= 0 && index < folders.length)
        commit(item, { kind: "folder", id: folders[index] }, true);
    } else {
      if (item.kind === "note" && !reorderNotes) return;
      const siblings = item.kind === "folder" ? orderFolders(workspace.folders.filter(f => !f.deletedAt))
        : orderNotes(workspace.notes.filter((n) => isLiveItem(n) && n.folderId === note!.folderId), 'manual');
      const neighbor = siblings[siblings.findIndex((s) => s.id === item.id) + direction];
      if (neighbor) commit(item, {
        kind: item.kind === "folder" ? "folder-order" : "note-order",
        id: neighbor.id, after: direction > 0,
      }, true);
    }
  }

  function dragProps(item: SidebarItem, enabled = true) {
    return {
      draggable: enabled,
      "data-sidebar-item": `${item.kind}:${item.id}`,
      "aria-describedby": enabled ? "sidebar-drag-help" : undefined,
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => enabled && keyboardMove(event, item),
      onDragStart: (event: DragEvent<HTMLElement>) => {
        if (!enabled) { event.preventDefault(); return; }
        begin();
        source.current = item;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(MIME, JSON.stringify(item));
        // The browser owns threshold, grab offset, preview tracking, and cancellation.
        const row = event.currentTarget.closest<HTMLElement>(".folder-row, .note-row");
        if (row) {
          const rect = row.getBoundingClientRect();
          event.dataTransfer.setDragImage(row, event.clientX - rect.left, event.clientY - rect.top);
        }
        setDragging(item);
        setTarget(null);
      },
      onDragEnd: finish,
    };
  }

  function destination(event: DragEvent<HTMLElement>, base: SidebarDrop): SidebarDrop | null {
    const item = source.current;
    if (!item || !event.dataTransfer.types.includes(MIME)) return null;
    if (base.kind === "trash") return base;
    if (base.kind === "note-order" && !reorderNotes) return null;
    if ((item.kind === "folder") !== (base.kind === "folder-order")) return null;
    if (base.kind !== "folder" && item.id === base.id) return null;
    if (base.kind === "folder") return base;
    const rect = event.currentTarget.getBoundingClientRect();
    return { ...base, after: event.clientY >= rect.top + rect.height / 2 };
  }

  function dropProps(base: SidebarDrop) {
    return {
      onDragOver: (event: DragEvent<HTMLElement>) => {
        event.stopPropagation();
        const next = destination(event, base);
        if (next) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }
        setTarget((current) => sameDrop(current, next) ? current : next);
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget))
          setTarget((current) => current?.kind === base.kind && current.id === base.id ? null : current);
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        event.stopPropagation();
        const next = destination(event, base);
        if (next && source.current) {
          event.preventDefault();
          commit(source.current, next);
        }
        finish();
      },
    };
  }

  function dropClass(kind: SidebarDrop["kind"], id: string | null) {
    if (!target || target.kind !== kind || target.id !== id) return "";
    return target.kind === "trash" ? " drop-trash" : target.kind === "folder" ? " drop-folder" : target.after ? " drop-after" : " drop-before";
  }

  function scrollOnDrag(event: DragEvent<HTMLElement>) {
    if (!source.current) return;
    scroll.current = { element: event.currentTarget, y: event.clientY };
    if (frame.current) return;
    let previous = performance.now();
    const tick = (now: number) => {
      const current = scroll.current;
      if (!current || !source.current) { frame.current = 0; return; }
      const rect = current.element.getBoundingClientRect();
      const distance = current.y < rect.top + 36 ? current.y - rect.top - 36
        : current.y > rect.bottom - 36 ? current.y - rect.bottom + 36 : 0;
      const speed = Math.max(-420, Math.min(420, distance * 12));
      current.element.scrollTop += speed * Math.min(now - previous, 32) / 1000;
      previous = now;
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }

  function leaveScroll(event: DragEvent<HTMLElement>) {
    if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
      scroll.current = null;
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      setTarget(null);
    }
  }

  return { dragging, trashHovered: target?.kind === "trash", dragProps, dropProps, dropClass, scrollOnDrag, leaveScroll };
}
