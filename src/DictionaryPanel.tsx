import { useEffect, useRef, useState } from "react";
import { useContentMotion } from './useSurfaceMotion';
import { BookOpen, MagnifyingGlass, ArrowClockwise } from "@phosphor-icons/react";
import { dictionaryWord, lookupWord, type DictionaryEntry } from "./dictionary";

type Result = { word: string; status: "loading" | "ready" | "missing" | "error"; entries: DictionaryEntry[] };
export function DictionaryPanel({ word, onWord, onRelatedWord, onExternalLink }: { word: string; onWord: (word: string) => void; onRelatedWord: (word: string) => void; onExternalLink: (url: string) => void }) {
  const [query, setQuery] = useState(word);
  const [result, setResult] = useState<Result>({ word, status: "loading", entries: [] });
  const [retry, setRetry] = useState(0);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setQuery(word); setInvalid(false); }, [word]);
  useEffect(() => {
    if (!word) return;
    const controller = new AbortController();
    let live = true;
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    setResult({ word, status: "loading", entries: [] });
    lookupWord(word, controller.signal).then(entries => {
      if (live) setResult({ word, status: entries.length ? "ready" : "missing", entries });
    }).catch(() => { if (live) setResult({ word, status: "error", entries: [] }); })
      .finally(() => window.clearTimeout(timeout));
    return () => { live = false; controller.abort(); window.clearTimeout(timeout); };
  }, [word, retry]);
  const current: Result = result.word === word ? result : { word, status: "loading", entries: [] };
  const content = useRef<HTMLDivElement>(null);
  useContentMotion(content, `${current.word}-${current.status}`);
  function related(label: string, words: string[]) {
    const unique = [...new Set(words)].filter(value => value.toLowerCase() !== word);
    return <section className="dictionary-related"><h4>{label}</h4>{unique.length ? <div className="dictionary-words">{unique.map(value => <button key={value} disabled={!dictionaryWord(value)} title="Replace the selected word, or look up this word" onMouseDown={event => event.preventDefault()} onClick={() => onRelatedWord(dictionaryWord(value)!)}>{value}</button>)}</div> : <p className="dictionary-muted">No {label.toLowerCase()} listed.</p>}</section>;
  }
  return <div ref={content} className="dictionary-content">
    <form className="dictionary-search" onSubmit={event => { event.preventDefault(); const next = dictionaryWord(query); setInvalid(!next); if (next) { onWord(next); if (next === word) setRetry(value => value + 1); } }}>
      <MagnifyingGlass size={18} aria-hidden="true" />
      <input aria-label="Dictionary word" placeholder="Look up a word" value={query} onChange={event => { setQuery(event.target.value); setInvalid(false); }} aria-invalid={invalid} aria-describedby={invalid ? "dictionary-invalid" : undefined} maxLength={80} />
      <button type="submit" className="icon-button small" aria-label="Look up word"><BookOpen size={18} /></button>
    </form>
    {invalid && <p id="dictionary-invalid" role="alert">Enter one English word.</p>}
    {!word ? <div className="dictionary-empty"><BookOpen size={32} /><h3>A word, explored.</h3><p>Select a word in your note to see its meaning, synonyms, and antonyms. Or look one up above.</p><p className="dictionary-muted">English dictionary · Available offline</p></div> : <>
      <div className="dictionary-heading"><span className="dictionary-eyebrow">ENGLISH DICTIONARY</span><h2>{word}</h2>{current.entries[0]?.phonetic && <p>{current.entries[0].phonetic}</p>}</div>
      {current.status === "loading" && <p role="status" className="dictionary-muted">Looking up “{word}”…</p>}
      {current.status === "missing" && <div role="status"><h3>No entry found</h3><p className="dictionary-muted">Try the base form or check the spelling. Names and technical terms may not be listed.</p></div>}
      {current.status === "error" && <div role="alert"><h3>Dictionary lookup unavailable</h3><p className="dictionary-muted">The service may be unavailable or the request timed out. Try again shortly.</p><button className="dictionary-retry" onClick={() => setRetry(value => value + 1)}><ArrowClockwise size={17} />Try again</button></div>}
      {current.status === "ready" && current.entries.map((entry, entryIndex) => <div key={entryIndex}>
        {entry.meanings.map((meaning, index) => <section className="dictionary-meaning" key={index}>
          <h3>{meaning.partOfSpeech}</h3>
          <ol>{meaning.definitions.map((definition, index) => <li key={index}><p>{definition.definition}</p>{definition.example && <blockquote>{definition.example}</blockquote>}
            {definition.synonyms.length > 0 && related("Synonyms", definition.synonyms)}
            {definition.antonyms.length > 0 && related("Antonyms", definition.antonyms)}
          </li>)}</ol>
          {(meaning.synonyms.length > 0 || !meaning.definitions.some(value => value.synonyms.length)) && related("Synonyms", meaning.synonyms)}
          {(meaning.antonyms.length > 0 || !meaning.definitions.some(value => value.antonyms.length)) && related("Antonyms", meaning.antonyms)}
        </section>)}
        <div className="dictionary-attribution"><button onClick={() => onExternalLink(entry.source)}>{entry.provider} ↗</button>{entry.license && <button onClick={() => onExternalLink(entry.license!.url)}>{entry.license.name} ↗</button>}</div>
      </div>)}
    </>}
    <p className="dictionary-footnote">Select another word to continue exploring.<br />{current.entries[0]?.provider === "WordNet" ? "WordNet 3.1 · On-device lookup" : "WordNet offline · Online fallback for unlisted words"}<br />{(!word || current.entries[0]?.provider !== "WordNet") && <span>Online lookup sends only the word.<br /><button onClick={() => onExternalLink("https://freedictionaryapi.com/")}>FreeDictionaryAPI.com ↗</button></span>}</p>
  </div>;
}
