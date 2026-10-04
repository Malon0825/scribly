import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "./Dialog";
import { AppSelect } from "./AppSelect";
import { AnimatedIcon } from "./AnimatedIcon";
import { brandAsset, brandSearchKey, loadBrandCatalog, type BrandLogo } from "./brandLogos";
import "./brand-logo-picker.css";

type LogoChoice = { icon: BrandLogo; variant: string; darkBackground: boolean };
type Brand = { key: string; icon: BrandLogo; assets: BrandLogo[]; search: string; categories: string[] };
const RECENT_KEY = "notify-recent-brand-logos";
const POPULAR = ["aws", "azure", "googlecloud", "postgresql", "mysql", "redis", "mongodb", "docker", "kubernetes", "github", "cloudflare", "supabase", "kafka", "rabbitmq", "slack", "typescript", "react"];
const ROW_HEIGHT = 120;
function readRecent(): string[] {
  try { const value: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").slice(0, 30) : []; }
  catch { return []; }
}
function groupBrands(icons: BrandLogo[]): Brand[] {
  const groups = new Map<string, BrandLogo[]>();
  for (const icon of icons) { const key = icon.title.normalize("NFKD").toLowerCase().trim(); groups.set(key, [...(groups.get(key) || []), icon]); }
  return [...groups].map(([key, assets]) => {
    assets.sort((a, b) => Number(a.slug.endsWith("-badge")) - Number(b.slug.endsWith("-badge")) || b.variants.length - a.variants.length);
    return { key, icon: assets[0], assets, search: assets.map(brandSearchKey).join(" "), categories: [...new Set(assets.flatMap(a => a.categories))] };
  });
}
export function BrandLogoPicker({ onClose, onInsert, returnFocus }: { onClose: () => void; onInsert: (icon: BrandLogo, variant: string, darkBackground: boolean, signal: AbortSignal) => Promise<void>; returnFocus: () => HTMLElement | null }) {
  const [icons, setIcons] = useState<BrandLogo[]>([]), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0);
  const [error, setError] = useState(""), [query, setQuery] = useState(""), [category, setCategory] = useState("");
  const [view, setView] = useState("popular"), [recent, setRecent] = useState(readRecent);
  const [selectedKey, setSelectedKey] = useState(""), [asset, setAsset] = useState("");
  const [busy, setBusy] = useState(false), [previewFailed, setPreviewFailed] = useState(false), [darkBackground, setDarkBackground] = useState(false);
  const [queue, setQueue] = useState<LogoChoice[]>([]), [message, setMessage] = useState("");
  const [viewport, setViewport] = useState({ width: 480, height: 330, top: 0 });
  const scroll = useRef<HTMLDivElement>(null), insertion = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("");
    void loadBrandCatalog(controller.signal).then(value => { if (!controller.signal.aborted) setIcons(value); })
      .catch(e => { if (!controller.signal.aborted) setError(String(e)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [retry]);
  useEffect(() => () => insertion.current?.abort(), []);
  const brands = useMemo(() => groupBrands(icons), [icons]);
  const categories = useMemo(() => [...new Set(icons.flatMap(icon => icon.categories))].sort(), [icons]);
  const results = useMemo(() => {
    const terms = query.normalize("NFKD").toLowerCase().trim().split(/\s+/).filter(Boolean);
    const found = brands.filter(brand => (!category || brand.categories.includes(category)) && terms.every(term => brand.search.includes(term)) && (view !== "recent" || recent.includes(brand.key)));
    const rank = (brand: Brand) => { const index = POPULAR.findIndex(slug => brand.assets.some(a => a.slug === slug)); return index < 0 ? POPULAR.length : index; };
    return found.sort((a, b) => view === "recent" ? recent.indexOf(a.key) - recent.indexOf(b.key) : (view === "popular" && !terms.length ? rank(a) - rank(b) : 0) || a.icon.title.localeCompare(b.icon.title));
  }, [brands, category, query, view, recent]);
  const selected = results.find(brand => brand.key === selectedKey) || results[0];
  const choose = (brand: Brand) => { setSelectedKey(brand.key); setAsset(`${brand.icon.slug}/default`); setPreviewFailed(false); setDarkBackground(false); };
  useEffect(() => { if (selected) { setAsset(`${selected.icon.slug}/default`); setPreviewFailed(false); setDarkBackground(false); } }, [selected?.key]);
  useEffect(() => { scroll.current?.scrollTo({ top: 0 }); setViewport(v => ({ ...v, top: 0 })); }, [query, category, view]);
  useEffect(() => {
    const element = scroll.current; if (!element) return;
    const observer = new ResizeObserver(() => setViewport(v => ({ ...v, width: element.clientWidth, height: element.clientHeight })));
    observer.observe(element); return () => observer.disconnect();
  }, [loading, icons.length]);
  const columns = Math.max(1, Math.floor((viewport.width - 8) / 112));
  const startRow = Math.max(0, Math.floor(viewport.top / ROW_HEIGHT) - 2);
  const endRow = Math.min(Math.ceil(results.length / columns), Math.ceil((viewport.top + viewport.height) / ROW_HEIGHT) + 2);
  const visible = results.slice(startRow * columns, endRow * columns);
  const currentAsset = selected?.assets.find(icon => asset.startsWith(`${icon.slug}/`)) || selected?.icon;
  const variant = currentAsset && asset.startsWith(`${currentAsset.slug}/`) ? asset.slice(currentAsset.slug.length + 1) : "default";
  const chosen = currentAsset ? { icon: currentAsset, variant, darkBackground } : undefined;
  const queued = selected && queue.some(item => selected.assets.some(icon => icon.slug === item.icon.slug));
  const toggleQueue = () => {
    if (!selected || !chosen || previewFailed || busy) return;
    setQueue(items => queued ? items.filter(item => !selected.assets.some(icon => icon.slug === item.icon.slug)) : [...items, chosen]); setMessage("");
  };
  const insert = async () => {
    const pending = queue.length ? queue : chosen && !previewFailed ? [chosen] : [];
    if (!pending.length || busy) return;
    const controller = new AbortController(); insertion.current = controller; setBusy(true); setError(""); setMessage("");
    let completed = 0;
    try {
      for (const item of pending) {
        await onInsert(item.icon, item.variant, item.darkBackground, controller.signal); controller.signal.throwIfAborted(); completed++;
        setQueue(items => items.filter(entry => entry.icon.slug !== item.icon.slug));
        const brand = brands.find(entry => entry.assets.some(icon => icon.slug === item.icon.slug));
        if (brand) setRecent(previous => { const next = [brand.key, ...previous.filter(key => key !== brand.key)].slice(0, 30); try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* Recent history is optional. */ } return next; });
      }
      setMessage(`${completed} ${completed === 1 ? "component" : "components"} inserted. Keep browsing or close to connect them.`);
    } catch (e) { if (!controller.signal.aborted) setError(`${completed ? `${completed} inserted. ` : ""}${String(e)}`); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };
  return <Dialog title="Brand logos" className="brand-logo-dialog brand-logo-picker" onClose={onClose} returnFocus={returnFocus}>
    <p className="modal-subtitle">Choose brands, add them to your selection, then insert them together.</p>
    <div className="brand-logo-filters">
      <label className="brand-logo-search"><AnimatedIcon kind="search" size={20} /><input aria-label="Search brand logos" placeholder="Search brands, services or categories…" value={query} maxLength={100} onChange={e => setQuery(e.target.value)} /></label>
      <AppSelect label="Logo category" value={category} options={[{ value: "", label: "All categories" }, ...categories.map(value => ({ value, label: value }))]} onChange={setCategory} />
    </div>
    <div className="brand-logo-browse" aria-label="Browse logos">
      {[['popular', 'Popular'], ['recent', 'Recent'], ['all', 'All brands']].map(([value, label]) => <button key={value} aria-pressed={view === value} onClick={() => setView(value)}>{label}</button>)}
      <span className="brand-logo-chip-divider" />
      {[["Cloud", "Cloud"], ["Database", "Databases"], ["Communication", "Messaging"]].filter(([value]) => categories.includes(value)).map(([value, label]) => <button key={value} aria-pressed={category === value} title={`Catalog category: ${value}`} onClick={() => { setCategory(category === value ? "" : value); setView("all"); }}>{label}</button>)}
    </div>
    {loading ? <p role="status">Opening the offline logo catalog…</p> : !icons.length && error ? <button onClick={() => setRetry(n => n + 1)}>Retry catalog</button> : <div className="brand-logo-results">
      <div>
        <p className="brand-logo-count">{results.length.toLocaleString()} brands{view === "popular" && !query && !category ? " · Common architecture tools first" : ""}</p>
        <div ref={scroll} className="brand-logo-window" role="listbox" aria-label="Brands. Arrow keys browse; Space adds to selection." aria-activedescendant={selected && visible.includes(selected) ? `brand-${selected.icon.slug}` : undefined} tabIndex={0} onScroll={e => setViewport(v => ({ ...v, top: e.currentTarget.scrollTop }))} onKeyDown={e => {
          const index = selected ? results.indexOf(selected) : 0;
          let next = index;
          if (e.key === "ArrowRight") next++; else if (e.key === "ArrowLeft") next--; else if (e.key === "ArrowDown") next += columns; else if (e.key === "ArrowUp") next -= columns; else if (e.key === "Home") next = 0; else if (e.key === "End") next = results.length - 1;
          else if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggleQueue(); return; } else return;
          e.preventDefault(); const brand = results[Math.max(0, Math.min(results.length - 1, next))]; if (!brand) return; choose(brand);
          const rowTop = Math.floor(results.indexOf(brand) / columns) * ROW_HEIGHT, el = e.currentTarget;
          if (rowTop < el.scrollTop) el.scrollTop = rowTop; else if (rowTop + ROW_HEIGHT > el.scrollTop + el.clientHeight) el.scrollTop = rowTop + ROW_HEIGHT - el.clientHeight;
        }}>
          <div className="brand-logo-window-content" style={{ height: Math.ceil(results.length / columns) * ROW_HEIGHT }}>
            <div className="brand-logo-window-grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, top: startRow * ROW_HEIGHT }}>
              {visible.map((brand, index) => <button key={brand.key} id={`brand-${brand.icon.slug}`} role="option" aria-setsize={results.length} aria-posinset={startRow * columns + index + 1} tabIndex={-1} className="brand-logo-choice" aria-selected={selected?.key === brand.key} title={`${brand.icon.title} · ${brand.assets.reduce((count, icon) => count + icon.variants.length, 0)} variants`} onClick={() => { choose(brand); scroll.current?.focus({ preventScroll: true }); }}>
                <span className="brand-logo-art"><img src={brandAsset(brand.icon, "default")} alt="" loading="lazy" width="48" height="48" /></span><span>{brand.icon.title}</span>
                {queue.some(item => brand.assets.some(icon => icon.slug === item.icon.slug)) && <span className="brand-logo-queued" aria-label="Added to selection">✓</span>}
              </button>)}
            </div>
          </div>
          {!results.length && <p role="status">{view === "recent" ? "Your recently inserted brands will appear here." : "No brands found. Try another name or category."}</p>}
        </div>
      </div>
      <div className="brand-logo-preview">
        {selected && currentAsset ? <><div className={`brand-logo-art brand-logo-large ${darkBackground ? "brand-logo-art-dark" : ""}`}><img key={`${currentAsset.slug}/${variant}`} src={brandAsset(currentAsset, variant)} alt={`${selected.icon.title} preview`} onError={() => setPreviewFailed(true)} /></div>
          <strong>{selected.icon.title}</strong>
          <AppSelect label="Logo variant" value={`${currentAsset.slug}/${variant}`} disabled={busy} options={selected.assets.flatMap(icon => icon.variants.map(value => ({ value: `${icon.slug}/${value}`, label: `${value === "default" ? "Original" : value.replace(/([A-Z])/g, " $1")}${selected.assets.length > 1 ? ` · ${icon.slug}` : ""}` })))} onChange={value => { setAsset(value); setPreviewFailed(false); }} />
          <label className="brand-logo-background"><input type="checkbox" checked={darkBackground} disabled={busy} onChange={e => setDarkBackground(e.target.checked)} />Dark component background</label>
          <button disabled={busy || previewFailed} aria-pressed={!!queued} onClick={toggleQueue}>{queued ? "Remove from selection" : "Add to selection"}</button>
          <small>Source: theSVG · {currentAsset.license}</small><small>Original proportions and colors. Preview backing is not part of the logo.</small>
          {previewFailed && <p role="alert">This variant could not be displayed. Choose another.</p>}
        </> : <p>Try another search to preview a brand.</p>}
      </div>
    </div>}
    {!!queue.length && <div className="brand-logo-queue" aria-label="Selected components">{queue.map(item => <button key={item.icon.slug} disabled={busy} title={`Remove ${item.icon.title}`} aria-label={`Remove ${item.icon.title} from selection`} onClick={() => setQueue(items => items.filter(entry => entry.icon.slug !== item.icon.slug))}>{item.icon.title}<span aria-hidden="true"> ×</span></button>)}<button disabled={busy} onClick={() => setQueue([])}>Clear selection</button></div>}
    {message && <p role="status" className="brand-logo-message">{message}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="dialog-actions"><small>Offline catalog · Brand marks belong to their owners.</small><button onClick={onClose}>{busy ? "Stop and close" : "Done"}</button><button className="primary" disabled={busy || (!queue.length && (!chosen || previewFailed))} onClick={() => void insert()}><AnimatedIcon kind="image" size={18} />{busy ? "Inserting…" : queue.length ? `Insert ${queue.length} components` : "Insert component"}</button></div>
  </Dialog>;
}
