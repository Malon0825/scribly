// Mermaid has global configuration and temporary DOM. Serialize preview/import work.
let queue: Promise<unknown> = Promise.resolve();
export function runMermaid<T>(work: () => Promise<T>): Promise<T> {
  const task = queue.catch(() => {}).then(work);
  queue = task;
  return task;
}
export const mermaidConfig = {
  startOnLoad: false, securityLevel: "strict" as const, htmlLabels: false, fontFamily: "Segoe UI, sans-serif",
  maxTextSize: 100_000, maxEdges: 3000, themeVariables: { fontSize: "20px" },
  flowchart: { htmlLabels: false, curve: "linear" as const },
};
export async function renderMermaid(code: string, dark: boolean) {
  return runMermaid(async () => {
    const { default: mermaid } = await import("mermaid");
    mermaid.initialize({ ...mermaidConfig, theme: dark ? "dark" : "default" });
    await mermaid.parse(code);
    return (await mermaid.render(`notify_mermaid_${crypto.randomUUID().replace(/-/g, "")}`, code)).svg;
  });
}
