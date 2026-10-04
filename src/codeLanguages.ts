export const codeLanguages = [
  { id: "javascript", label: "JavaScript / JSX", aliases: ["js", "jsx"] },
  { id: "typescript", label: "TypeScript / TSX", aliases: ["ts", "tsx"] },
  { id: "rust", label: "Rust", aliases: ["rs"] },
  { id: "python", label: "Python", aliases: ["py"] },
  { id: "xml", label: "HTML / XML", aliases: ["html", "svg"] },
  { id: "css", label: "CSS", aliases: [] },
  { id: "json", label: "JSON", aliases: [] },
  { id: "sql", label: "SQL", aliases: [] },
  { id: "bash", label: "Shell / Bash", aliases: ["sh", "shell"] },
  { id: "java", label: "Java", aliases: [] },
  { id: "c", label: "C", aliases: ["h"] },
  { id: "cpp", label: "C++", aliases: ["c++", "cc", "hpp"] },
  { id: "csharp", label: "C#", aliases: ["cs", "c#"] },
  { id: "go", label: "Go", aliases: ["golang"] },
  { id: "yaml", label: "YAML", aliases: ["yml"] },
  { id: "ini", label: "INI / TOML", aliases: ["toml"] },
  { id: "markdown", label: "Markdown", aliases: ["md"] },
] as const;
export function normalizeCodeLanguage(language: unknown): string | null {
  if (typeof language !== "string" || !language || language === "auto") return null;
  const value = language.toLowerCase();
  if (["plain", "text", "txt", "plaintext"].includes(value)) return "plaintext";
  return codeLanguages.find((item) => item.id === value || (item.aliases as readonly string[]).includes(value))?.id || "plaintext";
}
export const codeLanguageLabel = (language: string) =>
  codeLanguages.find((item) => item.id === language)?.label || "Plain text";
export type CodeToken = { from: number; to: number; classes: string };
export type CodeHighlight = {
  language: string;
  tokens: CodeToken[];
  limited?: boolean;
  unavailable?: boolean;
};
export const MAX_HIGHLIGHT_LENGTH = 50_000;
