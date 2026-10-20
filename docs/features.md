# Scribly feature drafts

Created: October 9, 2026. Local Context Memory expanded against the version 1.5.0 working tree on the same date.

These are proposals for future work, not implemented features or release commitments. Delivery work remains tracked in [the enhancement plan](enhancement-plan.md); validation belongs in [verification history](../tests/verification.md).

## Local Context Memory

Status: Draft for future exploration. No implementation started.

**Principle: Scribly remembers locally first; AI reasons only when it adds value.**

### Goal

Help users rediscover relevant information from previous notes while writing, without constantly sending their content to an AI service.

### Core experience

1. The user writes normally in the existing editor.
2. After a meaningful pause, roughly 1–2 seconds following a paragraph or substantial edit, Scribly uses the recent prose as context. The timing and minimum context size are starting proposals to tune during implementation.
3. A local embedding model represents that context for semantic search against a local note index.
4. Scribly ranks relevant previous notes, excluding the current note and consolidating multiple matches from the same source.
5. A subtle **Related Memory** card beside the editor shows a source title, date, and relevant excerpt. Weak matches produce no card.
6. The user can open the source or explicitly request deeper reasoning. Automatic suggestions make no OpenAI request, including when matches are weak or absent.

Typing, editor selection, scrolling, focus, and saving must remain independent of retrieval. The card should not steal focus, cover writing controls, or continually rearrange the document. Respect Focus mode and allow automatic suggestions to be disabled.

### Example

Currently writing:

> We should keep Scribly local-first because I don't want user notes stored on our servers.

Related Memory:

> **Local-first architecture · Sep 20**
>
> You previously decided to bundle PostgreSQL locally and avoid requiring a backend.
>
> **Open note** · **Why did we decide this?**

This is illustrative copy. In the local-only experience, display an actual source excerpt or a clearly labeled extractive preview. Do not invent a decision or imply that semantic similarity proves a historical decision.

### Explicit AI interaction

When the user selects **Why did we decide this?**, Scribly retrieves perhaps the top 3–5 relevant local excerpts and sends only the context needed for that question to the configured OpenAI model. The UI must identify the action as remote AI before it is invoked; automatic retrieval never escalates to a remote request.

Example answer:

> **Why this was chosen**
>
> You previously identified three reasons for the local-first architecture: privacy, offline availability, and avoiding server infrastructure.

Each substantive claim must link to the supporting source note/excerpt. Distinguish recorded decisions from inference, disclose conflicting evidence, and say when the retrieved notes do not establish an answer. Opening a citation should use existing note/Reference navigation without replacing the draft being written.

Use a bounded excerpt budget, not only a note-count limit. Include recent editor text only when necessary and disclose it as part of the outgoing context. No configured model or no connection should leave local suggestions and source navigation usable.

### Suggested architecture

```text
Existing Tiptap editor
        |
Meaningful document changes
        |
1–2 second pause + minimum context threshold
        |
Recent prose -> local embedding model
        |
Local semantic search -> rank and deduplicate
        |
Related Memory card
        |                           |
Open source note             Ask / Explain / Compare
                                    |
                           Explicit remote-AI action
                                    |
                         Bounded relevant excerpts
                                    |
                           Configured OpenAI model
                                    |
                            Source-linked answer

Saved note changes -> extract prose -> local embeddings -> local memory index
```

### Recommended first implementation

Build the semantic feature for **Windows desktop first**, using a native CPU embedding runtime, derived tables in the existing PostgreSQL database, and an exact vector scan in Rust. Keep the initial local retrieval and explicit remote reasoning as separate delivery phases.

This avoids a second database service, a Python installation, and a required GPU. A PostgreSQL vector extension is deferred until measured notebook sizes justify its Windows packaging and maintenance cost. These are proposed architecture decisions, not installed dependencies or measured guarantees.

### Inspected integration points

| Existing file | Current responsibility | Planned integration |
| --- | --- | --- |
| [`src/NoteEditor.tsx`](../src/NoteEditor.tsx) | Tiptap transactions, HTML updates, read-only mode, composition-sensitive interactions | Emit bounded recent prose context after meaningful edits; preserve the existing `onChange` save path. |
| [`src/App.tsx`](../src/App.tsx) | Active note, Reference/Dictionary/Meeting ownership, navigation, settings | Own memory visibility and source navigation; pass active note identity to the controller. Ordinary notes and meeting documents use different editor branches. |
| [`src/useWorkspace.ts`](../src/useWorkspace.ts) | Revision-checked save queue and recovery state | Keep note persistence authoritative; memory must not change save status or await inference. |
| [`src/storage.ts`](../src/storage.ts), [`src/workspaceDelta.ts`](../src/workspaceDelta.ts) | Native full/delta saves; browser IndexedDB with a small-notebook local-storage path | Reuse the desktop boundary; keep memory vectors out of workspace payloads, recovery, and portable exports. |
| [`src-tauri/src/database.rs`](../src-tauri/src/database.rs) | `still_workspace`, per-item JSON in `still_notes`, synchronous PostgreSQL client behind `DatabaseState` mutex | Read bounded source snapshots and commit derived chunks in short transactions. Never hold the database mutex during parsing, embedding, vector scans, or HTTP requests. |
| [`src-tauri/src/commands.rs`](../src-tauri/src/commands.rs), [`src-tauri/src/lib.rs`](../src-tauri/src/lib.rs) | Tauri commands and managed state | Notify the native memory service after successful saves; register bounded memory commands and shutdown cleanup. |
| [`src/notebookSearch.ts`](../src/notebookSearch.ts) | Existing literal notebook search | Retain Ctrl+K behavior. A separate local lexical candidate path can supplement semantic retrieval without replacing it. |
| [`src-tauri/src/meeting_auth.rs`](../src-tauri/src/meeting_auth.rs), [`src-tauri/src/meeting_providers.rs`](../src-tauri/src/meeting_providers.rs) | Native protected credentials, model catalog, cancellable requests and response handling | Evaluate extracting only reusable transport/auth pieces for explicit memory reasoning; do not route notebook context through meeting analysis. |
| [`scripts/prepare-postgres.ps1`](../scripts/prepare-postgres.ps1), [`src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json) | Bundled PostgreSQL and installer resources | Package approved local model/runtime assets and notices; retain the frontend's current security boundary. |

### Local embedding runtime and distribution

Use one lazily initialized native embedding session in a managed `MemoryState`. A dedicated bounded worker owns inference; use existing blocking-task conventions for synchronous PostgreSQL work. Prefer interactive queries over background indexing between small batches. Keep one pending query per editor and coalesce older requests instead of building a backlog. Cancellation may discard an already running inference result even when the runtime cannot interrupt it.

Initial evaluation candidate: **`sentence-transformers/all-MiniLM-L6-v2`**, exported to ONNX for CPU inference. Its model card describes 384-dimensional sentence/paragraph embeddings and default truncation beyond 256 word pieces. This makes it a plausible English-first baseline, not a proven best model for Scribly. Include its tokenizer, attention-mask-aware pooling, and normalization; loading an ONNX file alone is insufficient. Evaluate a quantized artifact against its unquantized baseline before choosing it. [Model card](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2)

ONNX Runtime has Windows CPU distributions and explicit DLL deployment guidance. Select and pin a maintained Rust binding only after proving it with Scribly's MSVC build and NSIS installer. Load the runtime from an explicit application-owned path, disable runtime telemetry, and avoid changing system PATH. [ONNX Runtime deployment and telemetry](https://onnxruntime.ai/docs/get-started/with-c.html)

Proposed distribution: an optional local-memory model pack installed when the user enables the feature. Explain the download before starting it; download public model assets only, never notes. Pin artifact revisions and hashes, verify files before activation, retain licenses, and make downloads cancellable. After installation, indexing and retrieval work offline. Missing assets must produce a local setup state, never a cloud-embedding fallback. If installer bundling proves simpler, choose it in the evaluation phase and record the size tradeoff.

Fingerprint the complete embedding pipeline: model revision, tokenizer, quantization, pooling, dimensions, extraction version, and chunking version. A fingerprint change requires re-embedding; never compare incompatible vectors.

### Source eligibility and extraction

Start with saved ordinary text notes: `kind` absent or `note`, not archived, not trashed, and not in a deleted folder. Exclude the active note from results. Exclude templates and boards from the first version. Meeting documents have a dedicated `MeetingDocument` branch and separate provenance; include them in a later explicit phase rather than indexing their generated sections accidentally.

Index headings, paragraphs, blockquotes, and list/checklist prose. Preserve paragraph boundaries, the heading path, and checklist completion state. Ignore code blocks, inline code, image/ink payloads, original-file blocks, attachment metadata, and link destination attributes. Internal-link display text can remain prose; do not follow linked notes during extraction. Imported text already represented as editable prose is eligible; reading original PDF/DOCX/source-file bytes is outside this phase.

Use Tiptap's document model for the active query. For persisted HTML, introduce a native HTML parser only when implementing the extractor; use structural parsing rather than regex removal. Define the same extraction policy in TypeScript and Rust and verify their output with shared representative fixtures. Existing `plainText()` collapses boundaries and includes text unsuitable for this policy, so it cannot directly define memory chunks.

Proposed chunking: paragraph/heading-aware groups targeting 120–180 tokenizer tokens, with 20–30 tokens of overlap when splitting long prose. Respect the selected model's actual input limit, including title/heading prefixes and special tokens. Split oversized paragraphs at sentence/token boundaries without cutting Unicode characters. Keep normalized text and source locators separate so retrieval normalization does not corrupt citation text.

Locator proposal: note ID, source hash, block ordinal/path, and exact excerpt hash. Ordinary paragraphs do not currently have stable persistent block IDs. Do not add IDs throughout saved note HTML for the first version; open the note and find/highlight the excerpt only if its source version still matches. If the note changed, label that fact and open it without claiming an exact highlight.

### Index schema and ownership

Keep `Workspace` schema version 5 and the ordinary note format unchanged. Create derived memory tables through a separate, versioned memory migration. Memory setup failure disables memory with a recoverable error; it must not stop the notebook database from opening.

Proposed logical schema, to finalize during implementation:

| Table | Fields and constraints |
| --- | --- |
| `scribly_memory_meta` | Singleton schema version, active pipeline fingerprint, index generation, and reconciliation progress. |
| `scribly_memory_sources` | `note_id` primary key, saved source hash, last observed workspace revision, pipeline fingerprint, extraction state, indexed time, and bounded error code. |
| `scribly_memory_chunks` | Note ID + pipeline fingerprint + chunk ordinal key; chunk hash, locator JSON, exact excerpt, normalized search text, heading path, and normalized embedding as PostgreSQL `REAL[]`. |

The source hash covers content and retrieval-affecting title/type fields. The workspace revision provides provenance, but changing another note must not force every source to re-embed. Eligibility, current titles, and folder placement come from current `still_notes`/workspace metadata, not stale cached labels. Chunk reuse keys must include the complete model input, including heading prefixes, so changed headings do not reuse the wrong embedding.

Validate vector dimensions, finite values, normalization, and locator shape at the index boundary. Read vectors into a Rust cache for cosine/dot-product ranking; PostgreSQL stores them durably but `REAL[]` does not itself provide indexed nearest-neighbor search. Refresh the cache from committed index generations. Only load text excerpts for the final candidates where possible.

For scale context, 20,000 vectors × 384 dimensions × 4 bytes is about 29.3 MiB of raw vector data, before metadata, runtime memory, and PostgreSQL overhead. This is arithmetic, not a measured Scribly footprint. Validate exact scanning at representative sizes before committing to a supported range. If latency or memory is unacceptable, evaluate a dedicated native connection/cache strategy and then a local approximate index or packaged vector extension; never silently omit older notes to meet a performance target.

### Index lifecycle and consistency

1. On feature enable, reconcile eligible saved notes against indexed source hashes in bounded batches. Start after the editor is ready; never make first-note opening wait for indexing.
2. After `save_workspace` or `save_workspace_delta` commits, enqueue affected source IDs through a non-failing, coalesced notification. Preserve the commands' existing revision return value. Do not compute embeddings or require an index write inside the note-save transaction.
3. The worker copies a bounded source snapshot under the database mutex, releases it, extracts/chunks/embeds, then reacquires it briefly to verify the source hash and eligibility before replacing that note's chunks atomically. A stale job is discarded and rescheduled.
4. A failed or dropped notification is repaired by startup reconciliation and bounded periodic reconciliation while memory is enabled. A full replacement import or backup restore bumps the memory generation and schedules reconciliation; append imports enqueue new IDs. Retry recoverable errors with backoff.
5. Query publication checks candidate hashes and current eligibility against saved sources. The frontend also checks current workspace state, suppressing notes with unsaved edits, new Trash/archive state, or deletion. The remote-send path repeats source validation. Stale index rows cannot authorize sending an obsolete excerpt.
6. Trash, archive, excluded-folder moves, and permanent deletion remove sources from retrieval immediately through eligibility checks and then purge their derived rows/cache. Restore/history restore reindexes current content. Rename updates headings/embedding input; simple reordering does not re-embed.

Index only acknowledged saved source text. Unsaved active text is allowed as a transient local query, but it is not a durable memory source. When saving fails, retrieval may still use the draft query against other saved notes; save failures retain their existing visibility and recovery behavior.

Use brief, bounded DB reads/writes and prioritize saving. If measured contention remains material, introduce a dedicated native connection through the existing PostgreSQL server owner; do not expose credentials or open a second server. Memory shutdown cancels jobs and joins/ends its workers before PostgreSQL closes.

Vectors and duplicate excerpts are local user data. **Disable automatic suggestions** stops automatic queries; **Disable Local Memory** stops queries/indexing and releases runtime/cache resources; **Clear memory index** deletes derived rows and invalidates the current generation. Existing notebook backups may still contain source notes; this does not promise forensic erasure or encryption. Omit derived vectors/excerpts from Scribly's logical portable backups and recovery journal, rebuild after restoration, and preserve user-written notes.

### Query scheduling and ranking

Proposed initial tuning, to validate rather than treat as constants of the product:

- Wait 1.5 seconds after a meaningful prose edit. Query the current paragraph plus enough preceding prose to supply roughly 12 words of context, bounded by the model's tokenizer limit. Typing pauses alone in a title or code block do not trigger memory.
- Compare a normalized context hash; formatting-only edits, caret movement, and identical context do not re-query. Suspend during composition, read-only editing, drawing, Find interactions, and hidden/background-window activity; require a fresh context when resumed.
- Tag requests with active note ID, editor generation, context hash, and index generation. Clear/cancel pending work on note changes, preference changes, unmount, and rebuild. Tauri invoke is not automatically aborted by a browser `AbortController`; the native worker must recognize cancellation/stale generations.
- Compute semantic candidates with normalized vector similarity, optionally unioned with lexical candidates from indexed prose/title terms to recover exact names and acronyms. Start with at most 20 candidates from each path, combine by reciprocal rank fusion, and deduplicate to one best excerpt per note. Do not average incompatible raw keyword and cosine scores.
- Apply a calibrated relevance gate using representative positive and negative examples, with only a small recency/folder tie-break. Semantic similarity is relevance, not confidence that a decision was made. Do not favor only recent notes or invent a percentage certainty.
- Show one best card initially, with at most two additional notes in a disclosure. Stabilize the displayed card until a materially different context or stronger match arrives. A dismissal suppresses that match for the current context session.

Manual **Find related notes** uses the same local pipeline and remains available when automatic suggestions are off. An empty/partial index is identified as such, not reported as proof that no relevant notes exist. If semantics is unavailable, show an explicitly labeled local keyword fallback using existing search conventions; never claim it is semantic search.

### Related Memory UI in Scribly

Use the existing secondary Reference area. When it is already open in its ordinary Reference mode, place a compact Related Memory section above the read-only reference content. Keep the section bounded so it does not consume the reader. Do not create a fourth grid column, open Reference automatically, or replace an explicitly selected reference note.

When Reference is closed, or Dictionary/Meeting owns the area, keep results in the controller and show only a quiet availability control near the existing Reference controls. Opening memory is explicit and returns to the prior panel owner when dismissed. In Focus mode, suppress automatic cards/badges; manual access can explicitly leave Focus. At compact widths, use the existing responsive panel behavior rather than a floating card over the document.

**Open in Reference** is the primary writing-preserving source action; **Open note** is an explicit navigation action that uses the normal save/recovery path. Use note titles and clearly labeled creation/update dates, never an invented decision date. Remote actions read **Explain with AI** / **Why did we decide this? · Online** and identify the selected provider/model before use.

Controls are keyboard reachable, Escape dismisses the memory view or explanation and restores focus, and local retrieval never steals selection or focus. Announce manual results and errors accessibly; avoid a live announcement for every automatic refresh. Reuse solid surfaces, theme tokens, Phosphor icons, panel ownership, and existing motion/reduced-motion helpers. No editor scaling or typing animation is required. Validate Light, Dark, Notebook, responsive widths, and reduced motion when implementing.

### Proposed native/frontend contracts

Names and shapes below are design contracts, not existing commands. Introduce only what each phase needs.

| Proposed operation | Purpose and boundary |
| --- | --- |
| `memory_status` / `memory_set_preferences` | Local enabled/setup/index state and persisted device preferences. Return progress, not note excerpts in diagnostics. |
| `memory_query` | Bounded query prose, active note ID, and request generation -> current source IDs, locators, excerpts, ranking metadata, and completeness state. Local only. |
| `memory_cancel_query` | Invalidate a request generation; coalescing prevents per-keystroke IPC. |
| `memory_rebuild` / `memory_clear` | Explicit local index management and generation invalidation. |
| `memory_prepare_explanation` | Resolve selected source IDs against current saved notes and construct a bounded outgoing-context preview. This operation makes no remote request. |
| `memory_explain` / `memory_cancel_explanation` | Submit an explicit prepared-context handle and configured model; recheck sources, stream progress, validate answer/citations, support cancellation. |

Proposed frontend modules: `memory.ts` for typed desktop/preview adapters, `useLocalMemory.ts` for query/visibility ownership, `memoryContext.ts` for editor extraction, and `RelatedMemory.tsx` for presentation. A small Tiptap extension may observe prose changes; it should not dispatch document mutations just to deliver context. Proposed native modules: `memory.rs` for managed state/commands and `memory_index.rs` for extraction/indexing/ranking; split the explicit reasoning path only when that phase lands.

Store memory preferences in a dedicated local, versioned configuration rather than adding derived state to `Workspace`. Proposed defaults: feature off until enabled, automatic suggestions on after enable, active ordinary notes only, answers session-only. Preferences contain no account secrets. Reuse the existing native protected credential owner if the account path is supported; do not copy tokens into React, note content, local storage, or memory tables.

### Explicit reasoning, bounded context, and citations

Before sending, show a reviewable context preview with the provider/model, question, selected source titles/excerpts, and any recent draft text included. Start with up to five chunks across three to five notes, roughly 3,000 excerpt tokens total, plus at most 256 query-context tokens and a bounded question. These are proposed caps; enforce a hard UTF-8 byte ceiling as well, and budget instructions/output against the selected model. A character count is not an exact token count. Drop lower-ranked chunks locally rather than allowing server-side truncation to select evidence.

Preparation returns an opaque, short-lived handle to that exact source snapshot. At send time, validate generation, eligibility, and source hashes again. If anything changed, require a refreshed preview rather than silently substituting or expanding the outgoing context. Cancellation stops local streaming/future work but cannot retract bytes already sent.

Existing meeting code uses native `reqwest`, Responses requests with `store:false`, protected credentials, and cancellation tokens. Reuse proven mechanisms through a small shared boundary when justified; keep separate memory permissions, request IDs/events, context budgets, and result ownership. Meeting analysis's full-transcript prompts and automatic-notes behavior are unsuitable for memory.

Verify the registered account/scopes and model catalog support notebook reasoning before promising the existing ChatGPT connection works here. No hard-coded newest model, provider switch, paid fallback, or automatic retry that sends more context. Use only the provider/model the user configured for this action. Missing authorization leaves local memory operational.

Give each prepared excerpt a request-local source ID. Require structured plain-text claims with source IDs, validate IDs against the supplied set in Rust, and render them safely in React with actual local links. Treat note text as untrusted evidence, never instructions; give the model no tools that can read additional notes or edit the notebook. Reject malformed/unknown citations instead of displaying authoritative links. A valid source ID checks provenance, not whether the claim is logically supported; review answer quality with grounded and conflicting examples.

Each claim cites its evidence. Label inference and disagreement; unsupported questions return an explicit insufficient-evidence answer. Answers remain session-only initially. Copying or inserting an answer requires an explicit user action, and insertion follows normal editing/undo/save behavior. If a source later changes or is deleted, mark its citation stale/unavailable without reusing a new note's contents as old evidence.

Use `store:false` where supported, but do not advertise it as zero retention: OpenAI API abuse-monitoring and other retention controls are separate. Confirm the applicable account/provider policy before rollout, including the current subscription path. [Official OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data)

### Privacy rules

- Do not send keystrokes, automatic memory queries, or the whole notebook to OpenAI.
- Keep extraction, embeddings, retrieval, ranking, and the memory index local by default.
- Send only the minimum relevant excerpts when the user explicitly requests AI reasoning.
- Clearly indicate remote AI actions and the context that will leave the device.
- Allow automatic memory suggestions to be disabled without disabling ordinary editing or manual note search.
- Exclude Trash from retrieval and remote context. Define archive and folder scope before rollout.
- Avoid retaining note excerpts in diagnostic logs; local embeddings/indexes are also user data and need a clear removal/rebuild policy.

### Browser-preview behavior

First version: desktop semantic retrieval; browser preview presents an honest desktop-only/setup state and can use the existing local literal search as a labeled fallback. Do not create fake embeddings, send preview text to an embedding API, or require native commands from Vite. Demo memory cards may use explicit sample fixtures solely for UI development.

Later parity can evaluate a worker-based browser embedding runtime and an IndexedDB index. That phase must separately account for WASM assets/CSP, browser storage quotas, multi-tab revision changes, cache cleanup, and equivalent extraction. Share DTOs and ranking rules where useful; do not install browser inference dependencies before that phase is needed.

### Failure behavior

| Condition | Required behavior |
| --- | --- |
| Model absent/corrupt or download interrupted | Offer setup/retry; continue writing and literal search. No remote fallback. |
| Initial indexing/rebuild incomplete | Show local progress on demand and identify partial results; keep completed compatible sources usable. |
| Embedding/index/DB error | Show memory-specific error/retry; preserve save/error/recovery status and notes. |
| Edit/switch/delete while a query is running | Discard stale results; never reopen a previous note's card or publish an ineligible source. |
| Source changes after preview | Block the stale remote submission and prepare a fresh preview locally. |
| Remote offline/unauthorized/rate-limited | Keep source cards usable; show error and explicit retry with the same bounded context. |
| Remote cancellation/malformed citations | Retain the draft and source cards; label partial output or withhold invalid final claims. Do not insert answers automatically. |

### Delivery phases and acceptance gates

All phases are **Not started**. No dates or delivery estimates are committed.

| Phase | Deliverable | Gate before moving on |
| --- | --- | --- |
| 0 — Prove the native path | Model/runtime/license selection, packaged Windows CPU prototype, extraction fixtures, representative relevance/performance sample | Offline inference on target hardware; measured runtime/installer cost; deterministic tokenizer/pooling behavior; no source text or telemetry network traffic. Record evidence in existing verification history. |
| 1 — Build a safe local index | Separate memory migration, managed worker, post-save notifications, chunk reuse, restart reconciliation, clear/rebuild controls | Save/recovery behavior survives index failure; stale jobs cannot commit; edit/trash/delete/restore/import change eligibility correctly; index remains rebuildable. |
| 2 — Manual local retrieval | Query contract, vector/lexical ranking, relevance calibration, source opening/highlighting | Relevant known notes rank above distractors; weak/empty matches are quiet; Unicode/rich-text locators resolve safely; no remote request. |
| 3 — Quiet automatic memory | Meaningful-pause scheduling, cancellation, Reference integration, preferences and accessibility | Rapid typing/note switching cannot publish stale results; no focus/selection theft; panel owners and Focus mode respected; measured typing/save responsiveness. |
| 4 — Explicit AI explanations | Bounded context preview, validated provider access, cancellation, structured cited answers | Only explicit send invokes AI; outgoing context equals reviewed context; unknown citations rejected; unsupported/conflicting answers are handled; no automatic insertion or wider-context retry. |
| 5 — Extend the foundation | Meeting provenance, Ask Scribly, decision/action history, optional archive/folder scope, browser parity | Each addition defines its source permissions and provenance, and passes only the newly affected checks. |

Deliver phases 1–3 without phase 4 if local rediscovery is already useful. Future capabilities include **Ask Scribly**, decision history, meeting-to-note connections, forgotten action items, related-note suggestions, and “What have I previously written about this?” A meeting connection must cite transcript evidence and distinguish generated summaries from user-authored decisions; an unfinished checklist alone does not establish a forgotten commitment.

### Performance and focused validation

Proposed evaluation sets: 100, 1,000, and 5,000 eligible notes, with short/long prose, dense lists, Unicode, exclusions, and roughly 20,000 chunks at the larger representative size. Record actual counts rather than summing overlapping runs. Use synthetic/local fixtures; do not make benchmark notebooks a runtime product limit.

Initial targets, **unmeasured**: warm retrieval p95 below 300ms after the debounce; zero model loading in the critical editor-startup path; bounded cancellable batches; no noticeable typing stalls or material autosave regression relative to the same baseline workload. Record CPU, peak memory, index size, model/runtime download size, cold startup, and foreground-save contention. If the native exact-scan approach misses these targets, revise the architecture before adding automatic suggestions.

Follow the existing focused testing policy: inspect available tests first; add meaningful extraction/ranking and stale-generation/index consistency cases when implemented. Run targeted save/recovery/import/deletion cases only when their paths are touched. Run `npm run build` once after final frontend changes and applicable Cargo checks/targeted native tests for Rust changes. Use preview mocks for UI state, but verify the actual native worker, packaged model/DLL paths, and PostgreSQL lifecycle in Windows WebView2; browser tests cannot establish desktop inference or privacy.

Remote-phase tests should inspect outgoing payloads with a mocked transport for exact excerpt budgets, explicit-send gating, revalidation, cancellation, and citation rejection. Any live provider quality check is separately authorized and uses synthetic excerpts. Test automatic-query traffic independently of existing online dictionary and Datamuse requests; enabling memory must add no note-related remote traffic of its own.

### Remaining decisions

- [NEEDS INPUT] Final model, quantized artifact, Rust binding, model-pack distribution, minimum supported Windows hardware, and language scope after phase 0 measurements.
- [NEEDS INPUT] Approval of proposed opt-in defaults, ordinary-note-only scope, Reference-area placement, and session-only answers.
- [NEEDS INPUT] Calibrated relevance gates, exact supported notebook/chunk range, and whether a later approximate index is justified.
- [NEEDS INPUT] Provider/account entitlement for notebook reasoning and final context/token/byte limits.
- [NEEDS INPUT] Later meeting/archive/folder/browser scope and whether users need portable memory preferences.

This expansion is source/documentation review only. The architecture, schemas, commands, UI behavior, thresholds, and performance targets above are proposed; no model, index, UI, or remote reasoning path has been implemented or runtime-validated.

## Offline grammar checking with Harper

Status: Deferred; not a current priority. Revisit when writing assistance becomes a priority.

Goal: optional, quiet English grammar/spelling suggestions while preserving local note privacy and normal editing.

Candidate: [Automattic Harper](https://github.com/automattic/harper), using [harper.js](https://writewithharper.com/docs/harperjs/introduction) and a background [WorkerLinter](https://writewithharper.com/docs/harperjs/linting) shared by the desktop webview and browser preview.

Proposed first version: an on/off preference, temporary underlines, individual undoable fixes, Ignore, and custom words. Check after a short typing pause; skip code and read-only Reference. Findings must remain outside saved HTML and exports, and never automatically change a note.

Work to revisit:

- Map extracted prose and Harper offsets safely to Tiptap positions across formatting, links, lists, line breaks, and Unicode/emoji.
- Reject stale findings on edits and note switches; respect composition, selection, keyboard access, and undo grouping.
- Bundle the worker and WebAssembly locally, review the desktop CSP permission for WebAssembly, and verify packaged WebView2 behavior.
- Evaluate English-only suitability, rule noise, custom-word persistence, bundle size, memory, and long-note latency.
- Recheck the current Harper API/license, pin the selected version, and add the required third-party attribution.

The earlier feasibility review was source/documentation review only. No dependency was installed, prototype built, or runtime compatibility measured.
