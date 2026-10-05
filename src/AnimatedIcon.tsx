import {
  Plus, Graph, SidebarSimple, BookOpen, CrosshairSimple, GearSix, Sun, Moon, Monitor,
  MagnifyingGlass, Folder, FolderPlus, FileText, Archive, TextB, TextItalic, ListBullets,
  CheckSquare, Code, Image, Palette, ArrowCounterClockwise, ArrowClockwise, Highlighter,
  PencilSimple, DotsThree, Copy, DownloadSimple, UploadSimple, ArrowSquareOut,
  SlidersHorizontal, CaretDown, CaretRight, CaretUp, X, MagnifyingGlassPlus,
  TextAlignLeft, TextAlignCenter, TextAlignRight, ArrowUp, ArrowDown, ListPlus,
} from '@phosphor-icons/react';

const icons = {
  add: Plus, board: Graph, sidebar: SidebarSimple, reference: BookOpen, focus: CrosshairSimple,
  settings: GearSix, sun: Sun, moon: Moon, system: Monitor, search: MagnifyingGlass,
  folder: Folder, folderAdd: FolderPlus, note: FileText, archive: Archive,
  bold: TextB, italic: TextItalic, list: ListBullets, checklist: CheckSquare, code: Code,
  image: Image, palette: Palette, undo: ArrowCounterClockwise, redo: ArrowClockwise,
  highlight: Highlighter, draw: PencilSimple, options: DotsThree, copy: Copy,
  download: DownloadSimple, upload: UploadSimple, open: ArrowSquareOut, tools: SlidersHorizontal,
  down: CaretDown, right: CaretRight, up: CaretUp, close: X, zoom: MagnifyingGlassPlus,
  alignLeft: TextAlignLeft, alignCenter: TextAlignCenter, alignRight: TextAlignRight,
  moveUp: ArrowUp, moveDown: ArrowDown, weekly: ListPlus,
};

// Retain the shared wrapper contract; writing controls use a quiet, static icon.
export function AnimatedIcon({ kind, size = 20 }: { kind: keyof typeof icons; size?: number }) {
  const Icon = icons[kind];
  return <div className="animated-icon" data-icon={kind} aria-hidden="true"><Icon size={size} weight="regular" /></div>;
}
