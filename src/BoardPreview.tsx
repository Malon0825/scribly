import { useEffect, useMemo, useState } from "react";
import type { BoardData } from "./boardData";
import { architectureTag } from "./boardData";
import { elementLabel, isNodeShape } from "./boardMermaid";
import "./board.css";

// A static preview does not instantiate a second canvas or own editing shortcuts.
export default function BoardPreview({ board, dark }: { board: BoardData; dark: boolean }) {
  const [svg, setSvg] = useState(""), [error, setError] = useState("");
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    let canceled = false; setSvg(""); setError("");
    const draw = async () => {
      const { exportToSvg, getNonDeletedElements } = await import("@excalidraw/excalidraw");
      const elements = getNonDeletedElements(board.elements);
      if (!elements.length) { if (!canceled) setError("This board is empty."); return; }
      const image: SVGSVGElement = await exportToSvg({ elements, files: board.files,
        appState: { ...board.appState, exportWithDarkMode: dark, exportBackground: true }, exportPadding: 20, skipInliningFonts: true });
      // Reference is informational; authored hyperlinks must not become active controls.
      image.querySelectorAll("a").forEach((a) => a.replaceWith(...Array.from(a.childNodes)));
      if (!canceled) setSvg(image.outerHTML);
    };
    void draw().catch((e) => { if (!canceled) setError(`Preview unavailable: ${String(e)}`); });
    return () => { canceled = true; };
  }, [board, dark]);
  const description = useMemo(() => {
    const labels = board.elements.filter((e) => !e.isDeleted && (isNodeShape(e) || architectureTag(e)?.role === "boundary"))
      .map((e) => elementLabel(e, board.elements)).filter(Boolean);
    return labels.length ? `Architecture: ${labels.slice(0, 30).map((label) => label.slice(0, 100)).join(", ")}${labels.length > 30 ? ", and more components" : ""}` : "Architecture drawing";
  }, [board]);
  return <div className="board-preview">
    <div className="board-preview-controls" role="group" aria-label="Drawing preview zoom">
      <button disabled={zoom <= 1} aria-label="Zoom out preview" onClick={() => setZoom((z) => Math.max(1, z - .5))}>−</button>
      <button onClick={() => setZoom(1)}>Fit</button>
      <button disabled={zoom >= 4} aria-label="Zoom in preview" onClick={() => setZoom((z) => Math.min(4, z + .5))}>+</button>
    </div>
    <div className="board-preview-scroll" role="img" tabIndex={0} aria-label={description}>
      {svg ? <div className="board-preview-image" style={{ width: `${zoom * 100}%` }} dangerouslySetInnerHTML={{ __html: svg }} /> : <p role="status">{error || "Rendering drawing…"}</p>}
    </div>
  </div>;
}
