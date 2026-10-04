import { useEffect, useState, type DragEvent } from "react";
import { isImageFile } from "./imageFiles";

export function useFileDrop(defaultFolder: string | null, importFiles: (files: File[], folder: string | null) => void,
  insertImages?: (files: File[], point: { left: number; top: number }) => void) {
  const [target, setTarget] = useState<{ folder: string | null; note?: boolean } | null>(null);
  const editorTarget = (event: DragEvent) => !!insertImages && !!(event.target as Element).closest('.document-editor [contenteditable="true"], .document-editor');
  const files = (event: DragEvent) => event.dataTransfer.types.includes("Files");
  const folder = (event: DragEvent) => {
    const zone = (event.target as Element).closest<HTMLElement>("[data-file-folder]");
    return zone ? zone.dataset.fileFolder || null : defaultFolder;
  };
  useEffect(() => {
    const clear = () => setTarget(null);
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") clear(); };
    const preventNavigation = (event: globalThis.DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
      if (event.type === "drop") clear();
    };
    window.addEventListener("blur", clear);
    window.addEventListener("dragend", clear);
    window.addEventListener("keydown", key);
    window.addEventListener("dragover", preventNavigation);
    window.addEventListener("drop", preventNavigation);
    return () => {
      window.removeEventListener("blur", clear);
      window.removeEventListener("dragend", clear);
      window.removeEventListener("keydown", key);
      window.removeEventListener("dragover", preventNavigation);
      window.removeEventListener("drop", preventNavigation);
    };
  }, []);
  return { target, props: {
    onDragOverCapture: (event: DragEvent<HTMLElement>) => {
      if ((event.target as Element).closest('.board-canvas')) return;
      if (!files(event)) return;
      event.preventDefault(); event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
      const next = folder(event);
      const items = Array.from(event.dataTransfer.items).filter((item) => item.kind === "file");
      const note = editorTarget(event) && items.length > 0 && items.every((item) => item.type.startsWith("image/"));
      setTarget((current) => current?.folder === next && !!current.note === note ? current : { folder: next, note });
    },
    onDragLeaveCapture: (event: DragEvent<HTMLElement>) => {
      if (!files(event)) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX <= bounds.left || event.clientX >= bounds.right ||
          event.clientY <= bounds.top || event.clientY >= bounds.bottom) setTarget(null);
    },
    onDropCapture: (event: DragEvent<HTMLElement>) => {
      if ((event.target as Element).closest('.board-canvas')) return;
      if (!files(event)) return;
      event.preventDefault(); event.stopPropagation();
      setTarget(null);
      const selected = Array.from(event.dataTransfer.files);
      // Mixed documents create independent notes as one import batch. This
      // avoids changing notes while an inline image is still decoding.
      const images = editorTarget(event) && selected.every(isImageFile) ? selected : [];
      if (images.length) insertImages?.(images, { left: event.clientX, top: event.clientY });
      const documents = selected.filter((file) => !images.includes(file));
      if (documents.length) importFiles(documents, folder(event));
    },
  } };
}
