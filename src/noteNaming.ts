import type { Note, Workspace } from "./types";
import { isBoard } from "./types";

export const mythologyNames = [
  { name: "Anubis", description: "Egyptian god of the underworld." },
  { name: "Baldur", description: "Norse god of light." },
  { name: "Cupid", description: "Roman god of love." },
  { name: "Diana", description: "Roman goddess of the hunt." },
  { name: "Echo", description: "Oread nymph from Greek mythology." },
  { name: "Fenrir", description: "Monstrous Norse wolf." },
  { name: "Gaia", description: "Greek primordial goddess of the Earth." },
  { name: "Hermes", description: "Greek messenger of the gods." },
  { name: "Isis", description: "Egyptian goddess of healing and magic." },
  { name: "Janus", description: "Two-faced Roman god of beginnings and transitions." },
  { name: "Kraken", description: "Legendary Scandinavian sea monster." },
  { name: "Loki", description: "Norse trickster god." },
  { name: "Medusa", description: "Greek gorgon with snakes for hair." },
  { name: "Nix", description: "Greek primordial goddess of the night (Nyx)." },
  { name: "Odin", description: "Allfather of Norse mythology." },
  { name: "Pegasus", description: "Winged divine horse in Greek mythology." },
  { name: "Quetzalcoatl", description: "Aztec feathered serpent god." },
  { name: "Ra", description: "Egyptian sun god." },
  { name: "Siren", description: "Greek creature that lured sailors with music." },
  { name: "Thor", description: "Norse god of thunder." },
  { name: "Uranus", description: "Greek primordial god of the sky." },
  { name: "Valkyrie", description: "Norse figures who choose who dies in battle." },
  { name: "Wodan", description: "Continental Germanic name for Odin." },
  { name: "Xibalba", description: "The Mayan underworld." },
  { name: "Ymir", description: "Primordial giant in Norse creation." },
  { name: "Zeus", description: "Ruler of the Greek Olympian gods." },
] as const;

function mythologyFor(ordinal: number) {
  if (ordinal < 1) return null;
  const myth = mythologyNames[(ordinal - 1) % mythologyNames.length];
  const cycle = Math.floor((ordinal - 1) / mythologyNames.length) + 1;
  return { ...myth, label: `${myth.name}${cycle > 1 ? ` ${cycle}` : ""}` };
}

export function defaultNoteTitle(workspace: Workspace, folderId: string | null, now: Date): Pick<Note, "title" | "autoTitle"> {
  // Use the user's local calendar day, not UTC's potentially different date.
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const folder = workspace.folders.find((f) => f.id === folderId)?.name || "Unfiled notes";
  const date = now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const base = `${folder} · ${date}`;
  let ordinal = 0;
  for (const note of workspace.notes) {
    const naming = note.autoTitle;
    if (naming?.day === day && naming.folderId === folderId)
      ordinal = Math.max(ordinal, naming.ordinal + 1);
  }
  let myth = mythologyFor(ordinal);
  let title = `${base}${myth ? ` · ${myth.label}` : ""}`;
  // Also avoid colliding with matching manually named or older imported notes.
  while (workspace.notes.some((n) => n.folderId === folderId && n.title === title)) {
    ordinal++;
    myth = mythologyFor(ordinal);
    title = `${base}${myth ? ` · ${myth.label}` : ""}`;
  }
  return {
    title,
    autoTitle: { folderId, day, ordinal },
  };
}

export function noteTitleFact(note: Note | undefined) {
  if (isBoard(note)) return null;
  const myth = note?.autoTitle ? mythologyFor(note.autoTitle.ordinal) : null;
  // A custom rename can remove the name without resetting its reserved place.
  return myth && note!.title.endsWith(` · ${myth.label}`) ? myth.description : null;
}
