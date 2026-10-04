import { test, expect } from "@playwright/test";
import { highlightCode } from "../src/codeHighlighter";
import { MAX_HIGHLIGHT_LENGTH, normalizeCodeLanguage } from "../src/codeLanguages";

const samples = [
  { language: "rust", code: 'fn main() {\n  let answer: u32 = 42;\n  println!("Hello 日本語 ✓");\n}' },
  { language: "xml", code: '<!doctype html>\n<html lang="en"><body><h1>Notify</h1></body></html>' },
  { language: "typescript", code: 'interface Note { title: string; }\nconst note: Note = { title: "Hello" };' },
  { language: "json", code: '{\n  "title": "Hello",\n  "count": 42\n}' },
  { language: "sql", code: 'SELECT id, title FROM notes WHERE archived = false ORDER BY updated_at DESC;' },
  { language: "python", code: 'def greet(name):\n    print("Hello", name)\n\ngreet("Notify")' },
];

for (const sample of samples) test(`detects and highlights ${sample.language} without changing code`, () => {
  const result = highlightCode(sample.code, null);
  expect(result.language).toBe(sample.language);
  expect(result.tokens.length).toBeGreaterThan(0);
  for (const token of result.tokens) {
    expect(token.from).toBeGreaterThanOrEqual(0);
    expect(token.to).toBeLessThanOrEqual(sample.code.length);
    expect(token.to).toBeGreaterThan(token.from);
    expect(token.classes).toMatch(/^hljs-/);
  }
});

test("manual language overrides automatic detection and supports fences/aliases", () => {
  expect(normalizeCodeLanguage("HTML")).toBe("xml");
  expect(normalizeCodeLanguage("rs")).toBe("rust");
  expect(normalizeCodeLanguage("c++")).toBe("cpp");
  expect(normalizeCodeLanguage("tsx")).toBe("typescript");
  expect(highlightCode(samples[0].code, "javascript").language).toBe("javascript");
  expect(highlightCode(samples[0].code, "plaintext").tokens).toEqual([]);
});

test("empty, ambiguous and unsupported text safely remains plain text", () => {
  expect(highlightCode("", null).tokens).toEqual([]);
  expect(highlightCode("Just a short note about tomorrow.", null).language).toBe("plaintext");
  expect(highlightCode("something", "unknown-grammar").language).toBe("plaintext");
});

test("large blocks remain editable without expensive highlighting", () => {
  const result = highlightCode("x".repeat(MAX_HIGHLIGHT_LENGTH + 1), null);
  expect(result).toEqual({ language: "plaintext", tokens: [], limited: true });
});

test("HTML code remains tokens, not executable markup", () => {
  const result = highlightCode('<script>alert("demo")</script>\n<div onclick="danger()">Text</div>', "html");
  expect(result.language).toBe("xml");
  expect(result.tokens.every((token) => typeof token.classes === "string" && !token.classes.includes("<"))).toBe(true);
});
