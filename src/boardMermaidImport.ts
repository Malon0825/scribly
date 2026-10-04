import { emptyBoard, validateBoard, type BoardData } from "./boardData";
import { boardToMermaid } from "./boardMermaid";
import { mermaidConfig, runMermaid } from "./boardMermaidRuntime";

export function normalizeMermaidInput(input: string) {
  const code = input.trim().replace(/^```(?:mermaid)?\s*\n([\s\S]*?)\n```$/i, "$1").trim();
  if (code.length > 50_000) throw Error("Mermaid input exceeds 50,000 characters.");
  if (!/^(?:%%[^\n]*\n\s*)*(?:flowchart|graph)\s+(?:LR|RL|TB|TD|BT)\b/i.test(code))
    throw Error("Import a Mermaid flowchart (flowchart or graph). Other diagram types are not supported.");
  if (/%%\s*\{|^\s*(?:click\b|---\s*$)|<\/?[a-z!]|\b(?:javascript:|data:|https?:\/\/|url\s*\(|img\s*:|icon\s*:)/im.test(code))
    throw Error("Use plain flowchart labels without configuration directives, HTML, links or remote assets.");
  return code;
}
type Subgraph = { id: string; nodes: string[] };
type FlowDb = { getVertices: () => Map<string, unknown>; getSubGraphs: () => Subgraph[]; getEdges: () => unknown[]; getDirection: () => string };

export async function importMermaidBoard(input: string): Promise<BoardData> {
  const code = normalizeMermaidInput(input);
  return runMermaid(async () => {
    const { default: mermaid } = await import("mermaid");
    mermaid.initialize(mermaidConfig);
    const diagram = await mermaid.mermaidAPI.getDiagramFromText(code);
    if (!["flowchart-v2", "graph"].includes(diagram.type)) throw Error("Only editable flowcharts can be imported.");
    // Pinned Mermaid's parsed database supplies explicit membership, never geometry.
    const db = diagram.db as FlowDb;
    const vertices = db.getVertices(), subgraphs = db.getSubGraphs(), edges = db.getEdges();
    if (!(vertices instanceof Map) || vertices.size > 300 || edges.length > 500 || subgraphs.length > 100)
      throw Error("Import up to 300 components, 100 boundaries and 500 connections at a time.");
    const parents = new Map<string, string>();
    for (const group of subgraphs) for (const child of group.nodes) {
      const old = parents.get(child);
      // Mermaid may include descendants in an outer group. Keep the innermost group.
      if (!old || subgraphs.find((g) => g.id === old)?.nodes.includes(group.id)) parents.set(child, group.id);
    }
    for (const group of subgraphs) {
      const seen = new Set<string>([group.id]); let parent = parents.get(group.id);
      while (parent) { if (seen.has(parent)) throw Error("Architecture boundaries cannot contain a cycle."); seen.add(parent); parent = parents.get(parent); }
    }
    const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");
    const { convertToExcalidrawElements } = await import("@excalidraw/excalidraw");
    const result = await parseMermaidToExcalidraw(code, mermaidConfig);
    if (result.files && Object.keys(result.files).length || result.elements.some((e) => e.type === "image"))
      throw Error("This diagram could only be converted to an image. Simplify it to supported flowchart shapes.");
    const groupIds = new Set(subgraphs.map((g) => g.id));
    // The converter reuses arrow IDs for parallel edges; assign distinct IDs before restoration.
    const skeletons = result.elements.map((e) => e.type === "arrow" ? { ...e, id: crypto.randomUUID() } : e);
    const elements = convertToExcalidrawElements(skeletons, { regenerateIds: false }).map((e) => {
      if (!groupIds.has(e.id) && !vertices.has(e.id)) return e;
      return { ...e, customData: { ...e.customData, notifyArchitecture: {
        version: 1, role: groupIds.has(e.id) ? "boundary" : "component", sourceId: e.id,
        ...(parents.has(e.id) ? { parentId: parents.get(e.id) } : {}),
      } } };
    });
    const direction = db.getDirection() === "TD" ? "TB" : db.getDirection();
    const board = { ...emptyBoard(), elements, exportDirection: direction } as BoardData;
    validateBoard(board);
    const converted = boardToMermaid(board);
    if (converted.nodes !== vertices.size || converted.edges !== edges.length || converted.issues.length)
      throw Error("Some shapes or connections could not be imported faithfully. Simplify the flowchart before importing.");
    return board;
  });
}
