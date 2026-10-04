import { Component, type ReactNode } from "react";
import { exportArtifact } from "./storage";
import { portableBoard, type BoardData } from "./boardData";
import { Dialog } from "./Dialog";
export class BoardBoundary extends Component<{ children: ReactNode; board?: BoardData; recovery?: () => BoardData; onClose?: () => void }, { failed: boolean; error: string; message: string; busy: boolean }> {
  state = { failed: false, error: "", message: "", busy: false };
  static getDerivedStateFromError() { return { failed: true }; }
  private mounted = true;
  componentDidMount() { this.mounted = true; }
  componentWillUnmount() { this.mounted = false; }
  private exportRecovery = async () => {
    this.setState({ busy: true, error: "", message: "" });
    try {
      const board = this.props.recovery?.() || this.props.board;
      if (!board) throw Error("No board recovery is available.");
      const saved = await exportArtifact("Board-recovery.excalidraw", JSON.stringify(portableBoard(board)), "application/json");
      if (this.mounted && saved) this.setState({ message: "Board recovery exported." });
    } catch (e) { if (this.mounted) this.setState({ error: `Recovery export failed: ${String(e)}` }); }
    finally { if (this.mounted) this.setState({ busy: false }); }
  };
  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.onClose) return <Dialog title="Board tools unavailable" onClose={this.props.onClose}>
      <p role="alert">The board dialog could not open. Your notebook is retained. Save your work before reopening Scribly to reload the drawing tools.</p>
      <div className="dialog-actions"><button onClick={this.props.onClose}>Close</button></div>
    </Dialog>;
    return <div className="board-load-error" role="alert"><p>The drawing editor could not open. Your board is retained.</p>
      <button disabled={this.state.busy} onClick={() => void this.exportRecovery()}>{this.state.busy ? "Exporting recovery…" : "Export board recovery"}</button>
      {this.state.error && <p>{this.state.error}</p>}{this.state.message && <p role="status">{this.state.message}</p>}
    </div>;
  }
}
