import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { IconHandle } from '@animateicons/react';
import { PlusIcon } from '@animateicons/react/lucide/plus-icon';
import { WorkflowIcon } from '@animateicons/react/lucide/workflow-icon';
import { PanelLeftIcon } from '@animateicons/react/lucide/panel-left-icon';
import { BookOpenIcon } from '@animateicons/react/lucide/book-open-icon';
import { TargetIcon } from '@animateicons/react/lucide/target-icon';
import { SettingsIcon } from '@animateicons/react/lucide/settings-icon';
import { SunIcon } from '@animateicons/react/lucide/sun-icon';
import { MoonIcon } from '@animateicons/react/lucide/moon-icon';
import { MonitorIcon } from '@animateicons/react/lucide/monitor-icon';
import './animated-icons.css';
import { SearchIcon } from '@animateicons/react/lucide/search-icon';
import { FolderIcon } from '@animateicons/react/lucide/folder-icon';
import { FolderPlusIcon } from '@animateicons/react/lucide/folder-plus-icon';
import { FileTextIcon } from '@animateicons/react/lucide/file-text-icon';
import { ArchiveIcon } from '@animateicons/react/lucide/archive-icon';
import { BoldIcon } from '@animateicons/react/lucide/bold-icon';
import { ItalicIcon } from '@animateicons/react/lucide/italic-icon';
import { ListIcon } from '@animateicons/react/lucide/list-icon';
import { SquareCheckIcon } from '@animateicons/react/lucide/square-check-icon';
import { CodeIcon } from '@animateicons/react/lucide/code-icon';
import { ImageIcon } from '@animateicons/react/lucide/image-icon';
import { PaletteIcon } from '@animateicons/react/lucide/palette-icon';
import { UndoIcon } from '@animateicons/react/lucide/undo-icon';
import { RedoIcon } from '@animateicons/react/lucide/redo-icon';
import { HighlighterIcon } from '@animateicons/react/lucide/highlighter-icon';
import { PencilIcon } from '@animateicons/react/lucide/pencil-icon';
import { EllipsisIcon } from '@animateicons/react/lucide/ellipsis-icon';
import { CopyIcon } from '@animateicons/react/lucide/copy-icon';
import { DownloadIcon } from '@animateicons/react/lucide/download-icon';
import { UploadIcon } from '@animateicons/react/lucide/upload-icon';
import { ExternalLinkIcon } from '@animateicons/react/lucide/external-link-icon';
import { SlidersHorizontalIcon } from '@animateicons/react/lucide/sliders-horizontal-icon';
import { ChevronDownIcon } from '@animateicons/react/lucide/chevron-down-icon';
import { ChevronRightIcon } from '@animateicons/react/lucide/chevron-right-icon';
import { ChevronUpIcon } from '@animateicons/react/lucide/chevron-up-icon';
import { XIcon } from '@animateicons/react/lucide/x-icon';
import { ZoomInIcon } from '@animateicons/react/lucide/zoom-in-icon';
import { AlignLeftIcon } from '@animateicons/react/lucide/align-left-icon';
import { AlignCenterIcon } from '@animateicons/react/lucide/align-center-icon';
import { AlignRightIcon } from '@animateicons/react/lucide/align-right-icon';
import { ArrowUpIcon } from '@animateicons/react/lucide/arrow-up-icon';
import { ArrowLeftIcon } from '@animateicons/react/lucide/arrow-left-icon';
import { ArrowDownIcon } from '@animateicons/react/lucide/arrow-down-icon';
import { ListPlusIcon } from '@animateicons/react/lucide/list-plus-icon';
import { CoffeeIcon } from '@animateicons/react/lucide/coffee-icon';

const icons = { back: ArrowLeftIcon, coffee: CoffeeIcon, add: PlusIcon, board: WorkflowIcon, sidebar: PanelLeftIcon, reference: BookOpenIcon, focus: TargetIcon, settings: SettingsIcon, sun: SunIcon, moon: MoonIcon, system: MonitorIcon, search: SearchIcon, folder: FolderIcon, folderAdd: FolderPlusIcon, note: FileTextIcon, archive: ArchiveIcon, bold: BoldIcon, italic: ItalicIcon, list: ListIcon, checklist: SquareCheckIcon, code: CodeIcon, image: ImageIcon, palette: PaletteIcon, undo: UndoIcon, redo: RedoIcon, highlight: HighlighterIcon, draw: PencilIcon, options: EllipsisIcon, copy: CopyIcon, download: DownloadIcon, upload: UploadIcon, open: ExternalLinkIcon, tools: SlidersHorizontalIcon, down: ChevronDownIcon, right: ChevronRightIcon, up: ChevronUpIcon, close: XIcon, zoom: ZoomInIcon, alignLeft: AlignLeftIcon, alignCenter: AlignCenterIcon, alignRight: AlignRightIcon, moveUp: ArrowUpIcon, moveDown: ArrowDownIcon, weekly: ListPlusIcon };
let media: MediaQueryList | undefined;
const subscribers = new Set<() => void>();
let preferenceTimer: ReturnType<typeof setTimeout> | undefined;
const query = () => media ??= matchMedia('(prefers-reduced-motion: reduce)');
// The bundled Motion hook snapshots its shared preference on mount. Notify
// after the media event batch so its internal cache is current before remount.
const changed = () => {
  clearTimeout(preferenceTimer);
  preferenceTimer = setTimeout(() => { preferenceTimer = undefined; subscribers.forEach(callback => callback()); }, 0);
};
const subscribe = (callback: () => void) => {
  if (!subscribers.size) query().addEventListener('change', changed);
  subscribers.add(callback);
  return () => { subscribers.delete(callback); if (!subscribers.size) { query().removeEventListener('change', changed); clearTimeout(preferenceTimer); preferenceTimer = undefined; } };
};
const snapshot = () => query().matches;

export function AnimatedIcon({ kind, size }: { kind: keyof typeof icons; size: number }) {
  const reduced = useSyncExternalStore(subscribe, snapshot, () => true);
  const host = useRef<HTMLDivElement>(null), handle = useRef<IconHandle>(null);
  useLayoutEffect(() => {
    const button = host.current?.closest<HTMLElement>('button, [data-icon-owner]');
    if (!button || reduced) return;
    let hovered = false, focused = false, active = false;
    const update = () => {
      const next = !button.matches(':disabled, [aria-disabled="true"]') && !button.closest('[inert]') && !document.hidden && (hovered || focused);
      if (active === next) return;
      active = next;
      if (next) handle.current?.startAnimation(); else handle.current?.stopAnimation();
    };
    const enter = (event: PointerEvent) => { if (event.pointerType === 'mouse' || event.pointerType === 'pen') { hovered = true; update(); } };
    const leave = () => { hovered = false; update(); };
    const focus = () => { focused = !!button.querySelector(':focus-visible') || button.matches(':focus-visible'); update(); };
    const blur = (event: FocusEvent) => { if (!button.contains(event.relatedTarget as Node | null)) { focused = false; update(); } };
    const reset = () => { hovered = false; focused = false; update(); };
    const visibility = () => { if (document.hidden) reset(); };
    button.addEventListener('pointerenter', enter); button.addEventListener('pointerleave', leave);
    button.addEventListener('focusin', focus); button.addEventListener('focusout', blur);
    button.addEventListener('dragstart', reset);
    window.addEventListener('blur', reset); document.addEventListener('visibilitychange', visibility);
    return () => {
      button.removeEventListener('pointerenter', enter); button.removeEventListener('pointerleave', leave);
      button.removeEventListener('focusin', focus); button.removeEventListener('focusout', blur);
      button.removeEventListener('dragstart', reset);
      window.removeEventListener('blur', reset); document.removeEventListener('visibilitychange', visibility);
      handle.current?.stopAnimation();
    };
  }, [reduced, kind]);
  const Icon = icons[kind];
  // Remount only this decorative icon when preference changes: a running
  // library timeline is discarded and its complete static pose restored.
  return <div ref={host} className="animated-icon" data-icon={kind} aria-hidden="true">
    <Icon key={`${kind}-${reduced}`} ref={handle} size={size} duration={0.45} isAnimated={false} />
  </div>;
}
