# Feature Roadmap

Forward-looking product/engineering proposals for Eigennamen Online, plus the
recorded **finish-or-delete** disposition of every half-built feature the review
found already sitting in the codebase.

This file is the home that `docs/HARDENING_PLAN.md` and
`docs/IMPROVEMENT_PLAN.md` (item **F7**) point at: it captures the first
codebase review's named feature proposals — which otherwise lived only in a
departed session's context — and gives each half-built feature a documented
decision instead of leaving it stranded between "shipped" and "removed."

Nothing here is a committed schedule. Severity/priority for the *defects* that
touch these areas is tracked in the two plan documents; this file is about
*direction*, not remediation. When a proposal is picked up, promote it to a
tranche in the normal way (branch → gates → draft PR) and cross-link the PR
back here.

---

## A. Proposed features

The first review surfaced four feature-level ideas. None is a bug; each is an
opportunity, sized here so a future session can pick one up without re-deriving
the context.

### A1. Custom word-list library (a real backing for `wordListId`)

**Idea:** A server-side library of named, reusable word lists that rooms can
select by id, seeded from the bundled `public/locales` wordlists and extensible
with host-curated lists.

**Why:** Today two parallel custom-word paths exist. The **array** path
(`options.wordList`, forwarded from the host's active Settings-menu list — see
CLAUDE.md "Multiplayer custom word lists") works end-to-end. The **id** path
(`wordListId`) is validated, typed, stored, documented, and *never read*
(IMPROVEMENT_PLAN **F4**) — an API consumer sending a valid id silently gets the
default list. A word-list library is the feature that would make the id path
mean something: pick "NYT-style", "kids", "sci-fi", a saved custom list, etc.,
without shipping the whole array on every `game:start`.

**Rough scope:** a small `wordListService` (Redis hash keyed by id, seeded at
boot from `public/locales`), consulted by `resolveGameWords` when
`options.wordList` is absent; a picker in the setup/settings UI; admin CRUD for
shared lists. Pairs naturally with the **semantic-map** work (A4) — a saved list
is exactly where a prepared `npm run bots:map` artifact should attach so bots
stay strong on it.

**Related:** IMPROVEMENT_PLAN F4 (the dangling `wordListId`), BOT_SEMANTIC_MAPS.

### A2. Post-game recap / match summary

**Idea:** An end-of-game (and end-of-match) recap screen: per-team timeline of
clues and guesses, the assassin near-misses, best/worst clue by cards-hit,
match-score progression across rounds, and a shareable replay link.

**Why:** The data already exists — game history, the replay engine, and
per-round match scores are all persisted and already power the replay modal
(`history-replay.ts`) and the match scoreboard. A recap is mostly a
*presentation* layer over data the server already emits; it turns the existing
replay/history plumbing into a feature players actually see at the moment they
most want it (right after "game over").

**Rough scope:** a recap view assembled from the existing replay/history payloads
and match-score snapshots; reuse the shared-replay-link flow (already fixed in
A9). No new server state; primarily frontend + a couple of derived selectors.

**Related:** the replay/history subsystem, match-mode scoring.

### A3. Redis-backed bot & coordination state (scale-out readiness)

**Idea:** Move the per-room/per-IP coordination state that is currently plain
in-process `Map`s onto Redis so the server is correct behind a load balancer
with more than one instance.

**Why:** This is the feature-shaped framing of the tracked scaling gap. The bot
controller's in-flight guard, the connection tracker's per-IP counters, socket
rate limiting, and turn-timer pause/resume/stop liveness all assume a single
process. `fly.toml` deliberately pins one machine today, so it's latent — but it
is the single biggest blocker to horizontal scale.

**Rough scope:** tracked in detail across HARDENING_PLAN **P2-1** (socket rate
limiting → Redis), **P2-2** (turn-timer cross-instance liveness — the A11 expiry
guard already landed the safety half), and **P2-3** (bot controller in-flight
guard + connection tracker counters → Redis). This roadmap entry exists so the
*product* goal ("run more than one machine") has a name; the engineering steps
live in those items.

**Related:** HARDENING_PLAN P2-1, P2-2 (partial), P2-3, P2-5.

### A4. Multilingual semantic maps for bots

**Idea:** Extend the offline LLM-built semantic map (`npm run bots:map`,
`semantics/mapBackend.ts`) so bots play at full table-quality strength on
non-English custom lists across all four supported languages.

**Why:** Bots already degrade to lexical similarity on unprepared lists and
recover full strength when a per-list semantic map exists — but the tooling and
docs (BOT_SEMANTIC_MAPS) are English-centric. German/Spanish/French rooms with
custom lists get the weaker lexical fallback. Building language-aware maps closes
that gap and directly complements the word-list library (A1): a saved list in
any language ships with its map.

**Rough scope:** language parameter through `build-semantic-map.mjs` and
`mapBackend.ts`; per-language concept/reference curation; validation via the
existing `npm run bots:analyze` clue-diagnostics harness per language.

**Related:** A1 (word-list library), BOT_SEMANTIC_MAPS, BOT_EMBEDDINGS,
INTELLIGENT_BOTS_SPEC.

---

## B. Half-built feature dispositions (IMPROVEMENT_PLAN Phase F)

Each of the F-items below is a feature that is **partially wired** in the
codebase today — carrying either real runtime cost or a misleading API surface.
The plan specifies both a *finish* and a *delete* path for each; the table
records the recommended disposition and current status. "Recommended" is a
maintainer decision — this is the recorded default, not a fait accompli.

| Item | Feature | Recommended disposition | Status |
|------|---------|-------------------------|--------|
| **F1** | Game pause/resume (server-complete, no frontend) | **Finish** — host-only Pause/Resume UI + client wiring + `GAME_PAUSED` error + i18n; also fix the resume-path timer that restarts without an expiry callback | **Shipped** (finish path — pause button, board overlay, client wiring, i18n ×4, resume-timer callback fixed) |
| **F2** | `allowSpectators` (accepted/persisted, enforced nowhere) | **Finish with F6** — decide as one spectator-policy story; enforce at the join boundary + add the settings toggle | **Shipped** (join-boundary enforcement via `SPECTATORS_NOT_ALLOWED` + host settings toggle; F6 approval UI is the next tranche) |
| **F3** | Admin audit log + SSE stats (no dashboard UI) | **Finish (audit), decide (SSE)** — wire the audit endpoint into `admin.html`; the polling-vs-EventSource choice is independent | Planned |
| **F4** | `wordListId` (validated/typed/stored, always null) | **Finish via A1** — back it with the word-list library above; otherwise delete from schemas/types/spec (keep the storage field nullable) | Planned |
| **F5** | Idle detection (per-event Redis write, no reader) | **Delete** — remove the `lastSeen` eval, `getIdlePlayers`, and `PLAYER_IDLE_WARNING`; first move the player-key TTL refresh that bot seats rely on into `atomicRefreshTtl.lua` | Delete path in flight (IMPROVEMENT_PLAN F5 / PR #519) |
| **F6** | Spectator approval flow (server + E2E, no UI) | **Finish with F2** — spectator "request to join" control + host approval queue; upgrade `spectator-approval.spec.js` from raw-protocol to UI-driven | Planned |

**Cross-cutting note:** F1/F2/F6 are one coherent "spectator & pause" product
story — pause/resume, who may spectate, and how a spectator becomes a player all
touch the same lobby/role surfaces. Deciding them together avoids three
half-overlapping UI passes. F4 is best resolved *with* the word-list library
(A1) rather than in isolation.

---

## See also

- [docs/IMPROVEMENT_PLAN.md](IMPROVEMENT_PLAN.md) — the F-series defect/gap
  entries (F1–F7) with full finish/delete specifications.
- [docs/HARDENING_PLAN.md](HARDENING_PLAN.md) — Phase 2 scale-out items (P2-1…5)
  behind proposal A3.
- [docs/BOT_SEMANTIC_MAPS.md](BOT_SEMANTIC_MAPS.md),
  [docs/BOT_EMBEDDINGS.md](BOT_EMBEDDINGS.md),
  [docs/INTELLIGENT_BOTS_SPEC.md](INTELLIGENT_BOTS_SPEC.md) — background for
  proposals A1 and A4.
