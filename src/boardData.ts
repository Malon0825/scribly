import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import { safeImageSource } from "./imageFiles";

export const MAX_BOARD_ELEMENTS = 2500;
export const MAX_WORKSPACE_BYTES = 20 * 1024 * 1024;
export type ArchitectureRole = "component" | "boundary" | "annotation";
export type ArchitectureTag = { version: 1; role: ArchitectureRole; parentId?: string; sourceId?: string };
export type BoardData = {
  schemaVersion: 1;
  engine: "excalidraw";
  elements: readonly ExcalidrawElement[];
  files: BinaryFiles;
  appState: Pick<Partial<AppState>, "viewBackgroundColor" | "gridSize">;
  exportDirection: "LR" | "RL" | "TB" | "BT";
};
export const emptyBoard = (): BoardData => ({ schemaVersion: 1, engine: "excalidraw", elements: [], files: {}, appState: { viewBackgroundColor: "#ffffff" }, exportDirection: "LR" });
export const architectureTag = (element?: ExcalidrawElement): ArchitectureTag | undefined => element?.customData?.notifyArchitecture;
export function activeBoardFiles(elements: readonly ExcalidrawElement[], files: BinaryFiles): BinaryFiles {
  const used = new Set<string>();
  for (const e of elements) if (!e.isDeleted && e.type === "image" && e.fileId) used.add(e.fileId);
  return Object.fromEntries(Object.entries(files).filter(([id]) => used.has(id)));
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const types = new Set(["rectangle", "diamond", "ellipse", "arrow", "line", "text", "freedraw", "image", "frame"]);
const id = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 200;
const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 10_000_000;

// Lightweight validation: importing this module never loads the canvas engine.
// Restore utilities inside BoardEditor normalize the remaining editor fields.
export function validateBoard(value: unknown): asserts value is BoardData {
  if (!object(value) || value.schemaVersion !== 1 || value.engine !== "excalidraw" || !Array.isArray(value.elements)
    || value.elements.length > 20_000 || value.elements.filter((e) => !object(e) || !e.isDeleted).length > MAX_BOARD_ELEMENTS || !object(value.files) || !object(value.appState)
    || !["LR", "RL", "TB", "BT"].includes(String(value.exportDirection))) throw Error("Invalid or unsupported board format (maximum 2,500 elements).");
  if ((value.appState.viewBackgroundColor !== undefined && (typeof value.appState.viewBackgroundColor !== "string" || !/^#[\da-f]{3,8}$/i.test(value.appState.viewBackgroundColor)))
    || (value.appState.gridSize != null && (!finite(value.appState.gridSize) || (value.appState.gridSize as number) < 0))) throw Error("Invalid board background or grid.");
  const ids = new Set<string>();
  for (const e of value.elements) {
    if (!object(e) || !id(e.id) || ids.has(e.id as string) || !types.has(String(e.type))
      || ![e.x, e.y, e.width, e.height].every(finite) || (e.width as number) < 0 || (e.height as number) < 0
      || typeof e.isDeleted !== "boolean") throw Error("Invalid, duplicate, or unsupported board element.");
    ids.add(e.id as string);
    if ((e.customData != null && !object(e.customData))
      || (e.name != null && typeof e.name !== "string")
      || (e.originalText != null && typeof e.originalText !== "string")
      || (e.containerId != null && !id(e.containerId))
      || (e.groupIds !== undefined && (!Array.isArray(e.groupIds) || !e.groupIds.every(id)))
      || (e.boundElements != null && (!Array.isArray(e.boundElements) || !e.boundElements.every((b) => object(b) && id(b.id) && ["text", "arrow"].includes(String(b.type)))))) throw Error("Invalid board label, grouping or bound elements.");
    for (const name of ["angle", "fontSize", "lineHeight", "strokeWidth", "roughness", "opacity", "version", "versionNonce", "seed"]) {
      if (e[name] !== undefined && (typeof e[name] !== "number" || !Number.isFinite(e[name]))) throw Error("Invalid board appearance or version.");
    }
    if (e.link != null && (typeof e.link !== "string" || !/^https?:\/\//i.test(e.link))) throw Error("Board links must use http or https.");
    if (e.type === "text" && (typeof e.text !== "string" || e.text.length > 50_000)) throw Error("Invalid board text.");
    if (["arrow", "line", "freedraw"].includes(String(e.type)) && (!Array.isArray(e.points) || e.points.length > 20_000
      || !e.points.every((p) => Array.isArray(p) && p.length === 2 && p.every(finite)))) throw Error("Invalid connector or drawing points.");
    for (const name of ["startBinding", "endBinding"]) {
      const b = e[name];
      if (b != null && (!object(b) || !id(b.elementId))) throw Error("Invalid connector binding.");
    }
    const tag = object(e.customData) ? e.customData.notifyArchitecture : undefined;
    if (tag != null && (!object(tag) || tag.version !== 1 || !["component", "boundary", "annotation"].includes(String(tag.role))
      || (tag.parentId !== undefined && !id(tag.parentId)) || (tag.sourceId !== undefined && !id(tag.sourceId)))) throw Error("Invalid architecture metadata.");
    if (e.type === "image" && !e.isDeleted && (!id(e.fileId) || !Object.hasOwn(value.files, e.fileId as string))) throw Error("A board image is missing its file.");
  }
  for (const [key, file] of Object.entries(value.files)) {
    if (!id(key) || !object(file) || file.id !== key || typeof file.dataURL !== "string"
      || !safeImageSource(file.dataURL) || !file.dataURL.startsWith(`data:${file.mimeType};base64,`)
      || !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(String(file.mimeType))) throw Error("Use local PNG, JPEG, WebP or GIF images up to 5 MB.");
  }
  if (Object.keys(value.files).length > MAX_BOARD_ELEMENTS || JSON.stringify(value).length > MAX_WORKSPACE_BYTES) throw Error("Board exceeds the 20 MB notebook limit.");
}

export function portableBoard(board: BoardData) {
  // Include files explicitly: Excalidraw's database serializer removes them.
  return { type: "excalidraw", version: 2, source: "Scribly", elements: board.elements.filter((e) => !e.isDeleted), appState: board.appState, files: activeBoardFiles(board.elements, board.files), notify: { exportDirection: board.exportDirection } };
}

export function boardFromScene(value: unknown): BoardData {
  if (!object(value) || value.type !== "excalidraw" || ![1, 2].includes(Number(value.version))) throw Error("This is not a supported .excalidraw drawing.");
  const state = object(value.appState) ? value.appState : {};
  const board = { ...emptyBoard(), elements: value.elements, files: value.files || {}, appState: { viewBackgroundColor: state.viewBackgroundColor, gridSize: state.gridSize },
    ...(object(value.notify) && value.notify.exportDirection !== undefined ? { exportDirection: value.notify.exportDirection } : {}) };
  validateBoard(board);
  return board;
}
