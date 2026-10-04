import type { Workspace, Note } from "./types";
const task = (text: string, checked = false) =>
  `<li data-type="taskItem" data-checked="${checked}"><p>${text}</p></li>`;
export function initialWorkspace(): Workspace {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const stamp = (d: Date) => d.toISOString();
  const note = (
    id: string,
    folderId: string | null,
    title: string,
    content: string,
    date = now,
  ): Note => ({
    id,
    folderId,
    title,
    content,
    createdAt: stamp(date),
    updatedAt: stamp(date),
    archived: false,
  });
  return {
    theme: "system",
    activeId: "daily",
    referenceId: "previous",
    folders: [
      { id: "work", name: "Work logs" },
      { id: "data", name: "Data integration" },
      { id: "meetings", name: "Meetings" },
      { id: "personal", name: "Personal" },
    ],
    notes: [
      note(
        "daily",
        "work",
        "Daily log",
        `<h2>Completed</h2><ul data-type="taskList">${task("Added runtime history for monitored streams.", true)}${task("Verified pause thresholds against peak activity.", true)}${task("Improved error details for failed intervals.", true)}</ul><h2>Monitoring</h2><ul><li><p>Checked replication and reload services.</p></li><li><p>Reviewed source and destination row counts.</p></li></ul><h2>Follow up</h2><ul data-type="taskList">${task("Investigate duplicate rows in RMS CDC.")}</ul><p></p>`,
      ),
      note(
        "previous",
        "work",
        `Daily log · ${yesterday.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
        "<h2>Datastream</h2><p>Added 6-hour, 12-hour, and 24-hour views.<br>Prioritized failed and paused streams.</p><h2>Reconciliation</h2><p>Reviewed Wincor CDC against production.<br>Checked POS Wholesale CDC counts.</p>",
        yesterday,
      ),
      note(
        "weekly",
        "work",
        "Weekly update",
        "<h2>This week</h2><p>Bring together the work that matters.</p><h2>Next week</h2><p></p>",
      ),
      note(
        "cdc",
        "data",
        "CDC checklist",
        `<h2>Before a reload</h2><ul data-type="taskList">${task("Check replication lag.")}${task("Compare source and destination counts.")}${task("Record the reload window.")}</ul>`,
      ),
      note(
        "stream",
        "data",
        "Datastream findings",
        "<h2>Observations</h2><p>Keep findings and useful queries here.</p>",
      ),
      note(
        "reconciliation",
        "data",
        "Reconciliation notes",
        "<h2>Reconciliation</h2><p>Track discrepancies and the steps used to resolve them.</p>",
      ),
      note(
        "meeting",
        "meetings",
        "Team catch-up",
        "<h2>Agenda</h2><p>Updates, questions, and next steps.</p>",
      ),
      note(
        "ideas",
        "personal",
        "Little ideas",
        "<p>A place for thoughts that need a little room.</p>",
      ),
      note(
        "welcome",
        null,
        "Welcome to Still",
        "<h2>A little space to think.</h2><p>Write as simply as you would in Notepad. Your notes save automatically on this laptop.</p><h2>Make yourself at home</h2><ul><li><p>Create a note with Ctrl+N.</p></li><li><p>Find anything with Ctrl+K.</p></li><li><p>Keep another note beside you with Reference.</p></li><li><p>Hide distractions with Focus (Ctrl+Shift+F).</p></li></ul>",
      ),
    ],
  };
}
