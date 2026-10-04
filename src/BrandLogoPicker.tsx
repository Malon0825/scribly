import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "./Dialog";
import { AppSelect } from "./AppSelect";
import { AnimatedIcon } from "./AnimatedIcon";
import { brandAsset, brandSearchKey, loadBrandCatalog, type BrandLogo } from "./brandLogos";

const PAGE_SIZE = 48;
export function BrandLogoPicker({ onClose, onInsert, returnFocus }: { onClose: () => void; onInsert: (icon: BrandLogo, variant: string, darkBackground: boolean, signal: AbortSignal) => Promise<void>; returnFocus: () => HTMLElement | null }) {
  const [icons, setIcons] = useState<BrandLogo[]>([]), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0);
  const [error, setError] = useState(""), [query, setQuery] = useState(""), [category, setCategory] = useState("");
  const [page, setPage] = useState(0), [selected, setSelected] = useState<BrandLogo | null>(null), [variant, setVariant] = useState("default");
  const [busy, setBusy] = useState(false), [previewFailed, setPreviewFailed] = useState(false);
  const [darkBackground, setDarkBackground] = useState(false);
  const insertion = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("");
    void loadBrandCatalog(controller.signal).then(value => { if (!controller.signal.aborted) setIcons(value); })
      .catch(e => { if (!controller.signal.aborted) setError(String(e)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [retry]);
  useEffect(() => () => insertion.current?.abort(), []);
  const indexed = useMemo(() => icons.map(icon => ({ icon, key: brandSearchKey(icon) })), [icons]);
  const categories = useMemo(() => [...new Set(icons.flatMap(icon => icon.categories))].sort(), [icons]);
  const results = useMemo(() => {
    const terms = query.normalize("NFKD").toLowerCase().trim().split(/\s+/).filter(Boolean);
    return indexed.filter(({ icon, key }) => (!category || icon.categories.includes(category)) && terms.every(term => key.includes(term))).map(({ icon }) => icon);
  }, [indexed, query, category]);
  const choose = (icon: BrandLogo) => { setSelected(icon); setVariant("default"); setError(""); setPreviewFailed(false); setDarkBackground(false); };
  const insert = async () => {
    if (!selected || busy || previewFailed) return;
    const controller = new AbortController(); insertion.current = controller; setBusy(true); setError("");
    try { await onInsert(selected, variant, darkBackground, controller.signal); if (!controller.signal.aborted) onClose(); }
    catch (e) { if (!controller.signal.aborted) setError(String(e)); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };
  return <Dialog title="Brand logos" className="brand-logo-dialog" onClose={onClose} returnFocus={returnFocus}>
    <p className="modal-subtitle">Find a brand or cloud service. Insert a labeled component, then connect it with arrows.</p>
    <div className="brand-logo-filters">
      <label className="brand-logo-search"><AnimatedIcon kind="search" size={20} /><input aria-label="Search brand logos" placeholder="Search brands, services or categories…" value={query} maxLength={100} onChange={e => { setQuery(e.target.value); setPage(0); }} /></label>
      <AppSelect label="Logo category" value={category} options={[{value:"",label:"All categories"},...categories.map(value => ({value,label:value}))]} onChange={value => { setCategory(value); setPage(0); }} />
    </div>
    {loading ? <p role="status">Opening the offline logo catalog…</p> : <>
      {!icons.length && error ? <button onClick={() => setRetry(n => n + 1)}>Retry catalog</button> : <>
      <div className="brand-logo-results">
        <div className="brand-logo-grid" aria-label="Logo results">
          {results.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(icon => <button key={icon.slug} className="brand-logo-choice" data-brand-slug={icon.slug} disabled={busy} aria-label={`Choose ${icon.title} (${icon.slug})`} title={icon.slug} aria-pressed={selected?.slug === icon.slug} onClick={() => choose(icon)}>
            <span className="brand-logo-art"><img src={brandAsset(icon, "default")} alt="" loading="lazy" width="48" height="48" /></span><span>{icon.title}</span>
          </button>)}
          {!results.length && <p className="brand-logo-empty" role="status">No logos found. Try another name or category.</p>}
        </div>
        <div className="brand-logo-preview">
          {selected ? <><div className={`brand-logo-art brand-logo-large ${darkBackground ? "brand-logo-art-dark" : ""}`}><img key={`${selected.slug}/${variant}`} src={brandAsset(selected, variant)} alt={`${selected.title} preview`} onError={() => setPreviewFailed(true)} /></div>
            <strong>{selected.title}</strong>
            <AppSelect label="Logo variant" value={variant} disabled={busy} options={selected.variants.map(value => ({value,label:value === "default" ? "Original" : value.replace(/([A-Z])/g," $1")}))} onChange={value => { setVariant(value); setPreviewFailed(false); }} />
            <label className="brand-logo-background"><input type="checkbox" checked={darkBackground} disabled={busy} onChange={e => setDarkBackground(e.target.checked)} />Dark component background</label>
            <small>Source: theSVG · {selected.license}</small>
            <small>Logo proportions and colors are preserved. Inserted as a PNG with an editable component label.</small>
            {previewFailed && <p role="alert">This variant could not be displayed. Choose another.</p>}
          </> : <p>Choose a logo to preview it.</p>}
        </div>
      </div>
      <div className="brand-logo-pagination"><span role="status">{results.length.toLocaleString()} logos · Page {page + 1} of {Math.max(1, Math.ceil(results.length / PAGE_SIZE))}</span><button aria-label="Previous logo page" disabled={!page} onClick={() => setPage(n => n - 1)}>Previous</button><button aria-label="Next logo page" disabled={(page + 1) * PAGE_SIZE >= results.length} onClick={() => setPage(n => n + 1)}>Next</button></div>
      </>}
    </>}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="dialog-actions"><small>theSVG · Offline catalog · Brand marks belong to their owners.</small><button onClick={onClose}>Cancel</button><button className="primary" disabled={!selected || busy || previewFailed} onClick={() => void insert()}><AnimatedIcon kind="image" size={18} />{busy ? "Inserting…" : "Insert component"}</button></div>
  </Dialog>;
}
