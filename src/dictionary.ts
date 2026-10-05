export type DictionaryMeaning = {
  partOfSpeech: string;
  definitions: { definition: string; example?: string; synonyms: string[]; antonyms: string[] }[];
  synonyms: string[];
  antonyms: string[];
};
export type DictionaryEntry = {
  provider: "WordNet" | "Wiktionary";
  word: string;
  phonetic: string;
  meanings: DictionaryMeaning[];
  source: string;
  license?: { name: string; url: string };
};

export function dictionaryWord(value: string): string | null {
  const word = value.trim().replace(/^[“”‘’".,!?;:()]+|[“”‘’".,!?;:()]+$/g, "").replaceAll("’", "'");
  return word.length <= 64 && /^[a-z]+(?:['-][a-z]+)*$/i.test(word) ? word.toLowerCase() : null;
}
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
function httpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  try { const url = new URL(value); return url.protocol === "https:" ? url.href : undefined; } catch { return; }
}
const cache = new Map<string, DictionaryEntry[]>();
const localCache = new Map<string, Record<string, DictionaryMeaning[]>>();
let prefixes: Set<string> | undefined;
async function offlineWord(word: string, signal: AbortSignal): Promise<DictionaryEntry[]> {
  if (!prefixes) {
    const response = await fetch(new URL("dictionary/manifest.json", document.baseURI), { signal });
    if (!response.ok) throw new Error("Local dictionary unavailable");
    const manifest: { prefixes: string[] } = await response.json();
    prefixes = new Set(manifest.prefixes);
  }
  const prefix = word.slice(0, 2).padEnd(2, "_").replace(/[^a-z]/g, "_");
  if (!prefixes.has(prefix)) return [];
  let shard = localCache.get(prefix);
  if (!shard) {
    const response = await fetch(new URL(`dictionary/${prefix}.json`, document.baseURI), { signal });
    if (!response.ok) throw new Error("Local dictionary unavailable");
    shard = await response.json() as Record<string, DictionaryMeaning[]>;
    if (localCache.size >= 8) localCache.delete(localCache.keys().next().value!);
    localCache.set(prefix, shard);
  }
  const meanings = Object.hasOwn(shard, word) ? shard[word] : undefined;
  return meanings ? [{ provider: "WordNet", word, phonetic: "", meanings, source: "https://wordnet.princeton.edu/", license: { name: "WordNet license", url: "https://wordnet.princeton.edu/license-and-commercial-use" } }] : [];
}

export async function lookupWord(word: string, signal: AbortSignal): Promise<DictionaryEntry[]> {
  const normalized = dictionaryWord(word);
  if (!normalized) return [];
  const cached = cache.get(normalized);
  if (cached) return cached;
  const local = await offlineWord(normalized, signal);
  if (signal.aborted) throw new DOMException("Lookup cancelled", "AbortError");
  if (local.length) {
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    cache.set(normalized, local);
    return local;
  }
  const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(normalized)}`, { signal, credentials: "omit", referrerPolicy: "no-referrer" });
  if (response.status === 404) return [];
  if (!response.ok) throw new Error("Dictionary unavailable");
  const data: unknown = await response.json();
  if (!Array.isArray(data)) throw new Error("Invalid dictionary response");
  const entries: DictionaryEntry[] = data.map(value => {
    const item = record(value), license = record(item.license);
    const phonetic = typeof item.phonetic === "string" ? item.phonetic : array(item.phonetics).map(value => record(value).text).find(value => typeof value === "string");
    return {
      provider: "Wiktionary" as const,
      word: typeof item.word === "string" ? item.word : normalized,
      phonetic: typeof phonetic === "string" ? phonetic : "",
      source: strings(item.sourceUrls).map(httpsUrl).find(Boolean) || `https://en.wiktionary.org/wiki/${encodeURIComponent(normalized)}`,
      license: typeof license.name === "string" && httpsUrl(license.url) ? { name: license.name, url: httpsUrl(license.url)! } : undefined,
      meanings: array(item.meanings).map(value => {
        const meaning = record(value);
        return {
          partOfSpeech: typeof meaning.partOfSpeech === "string" ? meaning.partOfSpeech : "Meaning",
          synonyms: strings(meaning.synonyms), antonyms: strings(meaning.antonyms),
          definitions: array(meaning.definitions).map(value => {
            const definition = record(value);
            return { definition: typeof definition.definition === "string" ? definition.definition : "", example: typeof definition.example === "string" ? definition.example : undefined, synonyms: strings(definition.synonyms), antonyms: strings(definition.antonyms) };
          }).filter(value => value.definition),
        };
      }).filter(value => value.definitions.length),
    };
  }).filter(value => value.meanings.length);
  if (!entries.length) throw new Error("Invalid dictionary response");
  if (cache.size >= 100) cache.delete(cache.keys().next().value!);
  cache.set(normalized, entries);
  return entries;
}
