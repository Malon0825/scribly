import { architectureTag, type BoardData } from "./boardData";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

export type ConversionIssue = { elementId: string; message: string; requiresReview: boolean };
export type MermaidConversion = { code: string; issues: ConversionIssue[]; nodes: number; edges: number; omitted: number };
export const isNodeShape = (e: ExcalidrawElement) => ["rectangle", "diamond", "ellipse"].includes(e.type);
const quote = (label: string) => `"${label.replace(/#/g, "#35;").replace(/&/g, "#38;").replace(/"/g, "#quot;").replace(/\|/g, "#124;").replace(/</g, "#60;").replace(/>/g, "#62;").replace(/[\r\n]+/g, " ")}"`;
export function elementLabel(e: ExcalidrawElement, elements: readonly ExcalidrawElement[]) {
  if (e.type === "text") return e.text.trim();
  const bound = elements.find((t) => t.type === "text" && !t.isDeleted && t.containerId === e.id);
  return bound?.type === "text" ? bound.text.trim() : e.type === "frame" ? e.name?.trim() || "" : "";
}

export function canAssignBoundary(elements: readonly ExcalidrawElement[], selection: readonly string[], candidate: string) {
  const byId = new Map(elements.filter((e) => !e.isDeleted).map((e) => [e.id, e]));
  const seen = new Set<string>(); let current: string | undefined = candidate;
  while (current) {
    if (selection.includes(current) || seen.has(current)) return false;
    seen.add(current); current = architectureTag(byId.get(current)!)?.parentId;
  }
  return true;
}

export function boardToMermaid(board: BoardData): MermaidConversion {
  const elements = board.elements.filter((e) => !e.isDeleted);
  const byId = new Map(elements.map((e) => [e.id, e]));
  const issues: ConversionIssue[] = [];
  const issue = (e: ExcalidrawElement, message: string, requiresReview = false) => issues.push({ elementId: e.id, message, requiresReview });
  const boundaries = elements.filter((e) => architectureTag(e)?.role === "boundary");
  const nodes = elements.filter((e) => isNodeShape(e) && !["boundary", "annotation"].includes(architectureTag(e)?.role || ""));
  const ids = new Map<string, string>();
  // Unicode code points produce stable, collision-free safe IDs without depending on labels.
  const safeId = (e: ExcalidrawElement) => `n_${Array.from(e.id).map((c) => c.codePointAt(0)!.toString(16)).join("_")}`;
  for (const e of [...boundaries, ...nodes]) ids.set(e.id, safeId(e));
  const members = new Map<string, string>();
  for (const b of boundaries) {
    if (!isNodeShape(b) && b.type !== "frame") issue(b, "Only shapes or frames can be architecture boundaries.", true);
    if (!elementLabel(b, elements)) issue(b, "Give this boundary a bound label (or a frame name).");
    const parent = architectureTag(b)?.parentId;
    if (parent) {
      if (!boundaries.some((e) => e.id === parent)) issue(b, "This boundary refers to a missing parent. Choose its boundary again.", true);
      else if (!canAssignBoundary(elements, [b.id], parent)) issue(b, "Boundary membership contains a cycle. Choose a different parent boundary.", true);
      else members.set(b.id, parent);
    }
  }
  for (const n of nodes) {
    if (!elementLabel(n, elements)) issue(n, "Give this component a label by double-clicking the shape.");
    const parent = architectureTag(n)?.parentId;
    if (parent) {
      if (boundaries.some((b) => b.id === parent) && parent !== n.id) members.set(n.id, parent);
      else issue(n, "This component refers to a missing boundary. Choose its boundary again.", true);
    }
  }
  const definition = (e: ExcalidrawElement) => {
    const label = quote(elementLabel(e, elements) || "Untitled component");
    return `${ids.get(e.id)}${e.type === "diamond" ? `{${label}}` : e.type === "ellipse" ? `((${label}))` : `[${label}]`}`;
  };
  const lines = [`flowchart ${board.exportDirection}`];
  const sortedBoundaries = [...boundaries].sort((a, z) => a.id.localeCompare(z.id));
  const writeBoundary = (b: ExcalidrawElement, depth: number) => {
    const indent = "  ".repeat(depth);
    lines.push(`${indent}subgraph ${ids.get(b.id)}[${quote(elementLabel(b, elements) || "Untitled boundary")}]`);
    for (const n of nodes.filter((n) => members.get(n.id) === b.id).sort((a, z) => a.id.localeCompare(z.id))) lines.push(`${indent}  ${definition(n)}`);
    for (const child of sortedBoundaries.filter((child) => members.get(child.id) === b.id)) writeBoundary(child, depth + 1);
    lines.push(`${indent}end`);
  };
  for (const b of sortedBoundaries.filter((b) => !members.has(b.id))) writeBoundary(b, 1);
  for (const n of nodes.filter((n) => !members.has(n.id)).sort((a, z) => a.id.localeCompare(z.id))) lines.push(`  ${definition(n)}`);
  let edges = 0, omitted = 0;
  for (const e of elements.filter((e) => e.type === "arrow" || e.type === "line").sort((a, z) => a.id.localeCompare(z.id))) {
    if (architectureTag(e)?.role === "annotation" || (e.type !== "arrow" && e.type !== "line")) continue;
    let from = e.startBinding?.elementId, to = e.endBinding?.elementId;
    if (!from || !to || !ids.has(from) || !ids.has(to) || !byId.has(from) || !byId.has(to)) {
      issue(e, "Connect both ends to components or boundaries. This connection is omitted until repaired.", true); omitted++; continue;
    }
    const start = e.startArrowhead, end = e.endArrowhead;
    if ([start, end].some((head) => head && head !== "arrow" && head !== "triangle")) issue(e, "This arrowhead becomes a standard arrow in Mermaid.");
    if (start && !end) [from, to] = [to, from];
    const operator = start && end ? "<-->" : start || end ? (e.strokeStyle === "dotted" || e.strokeStyle === "dashed" ? "-.->" : "-->") : "---";
    const label = elementLabel(e, elements);
    lines.push(`  ${ids.get(from!)} ${operator}${label ? `|${quote(label)}|` : ""} ${ids.get(to!)}`); edges++;
  }
  for (const e of elements) {
    if (architectureTag(e)?.role === "component" && !isNodeShape(e)) issue(e, "Use a rectangle, diamond or ellipse for an architecture component.", true);
  }
  if (!nodes.length) issues.push({ elementId: "", message: "Add a rectangle, diamond or ellipse, then connect your shapes with arrows.", requiresReview: false });
  return { code: lines.join("\n"), issues, nodes: nodes.length, edges, omitted };
}
