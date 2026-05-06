# nigels-app-v2 project principles

> The document that governs repo organization, documentation, and the
> development workflow. The agent reads it first in every session via
> the link from [`CLAUDE.md`](../CLAUDE.md). Do not duplicate its
> contents into `CLAUDE.md` — only link to it.
>
> Related docs: [`CLAUDE.md`](../CLAUDE.md) • [`README.md`](../README.md) • [`docs/BACKLOG.md`](BACKLOG.md)

## 0. Context

* **Product**: Nägels Online — a PWA card game (Expo Web target).
* **Stack**: Expo (React Native + Web) + TypeScript + Supabase + Zustand.
* **App languages**: EN / RU / ES (i18n).
* **Conversation language with the agent**: Russian.
* **Language of all written artifacts** (code, file names, commit messages, PR descriptions, **and all documentation under the repo**): English. Russian/Spanish only inside `src/i18n/locales/`.

## 1. Files as sources of truth

Each key file has a single role; other files only link to it.

| File | Role | Audience |
|---|---|---|
| `CLAUDE.md` | Agent instructions: stack, run, links into `docs/` | Agent |
| `README.md` | Product description, features, how to run | External developer |
| `docs/BACKLOG.md` | Kanban board: Backlog / In Progress / Done | Author + agent |
| `docs/<topic>.md` | Extended documentation per topic | Agent on deep dives |

`PROJECT_STATUS.md` is intentionally absent — `docs/BACKLOG.md` with
its three columns covers the same role, and maintaining two state
snapshots would lead to drift.

## 2. Living-documentation discipline

Documentation is a living manifest, updated in the same session as
the code or state change.

| What happened | What to update |
|---|---|
| New feature merged | `README.md` (Features), `docs/BACKLOG.md` (Done) |
| Stack / run command changed | `CLAUDE.md` (Stack, Run), `README.md` (Getting Started) |
| New task / bug fixed | `docs/BACKLOG.md` |
| Architectural decision | new file in `docs/` + link from `CLAUDE.md` |

These are triggers, not pre-commit blockers. Agent discipline, not a
hook (yet). If a trigger is missed, fix it in the next session at the
first reminder.

## 3. Cross-links between documents

* Every non-trivial document starts with a "Related docs" block.
* Relative paths only: `[name](file.md)`, from subfolders `[name](../file.md)`.
* Link to a specific section: `[name](file.md#anchor)`.
* `CLAUDE.md` links into `docs/` selectively; `docs/` files do **not**
  link back to `CLAUDE.md` (avoids cycles in Obsidian-style navigation).
* When a file is renamed — `grep` the repo and fix every link.

## 4. Keep CLAUDE.md lean

* Target size: ≤ 200 lines.
* Do not duplicate `README.md` or `docs/principles.md`.
* Delete stale content. `CLAUDE.md` is not a changelog.
* Principles are not copied here — link to this file instead.

## 5. Commit discipline

* **Cadence**: at least one commit per 6 hours of active work.
  Exploratory/debugging branches may go longer without a commit if
  nothing ship-worthy came out of them.
* **Message language**: English.
* **Format**: Conventional Commits — `feat:`, `fix:`, `docs:`,
  `refactor:`, `chore:`, `test:`.
* **Atomicity**: one commit = one logical change. Do not mix a
  refactor with a feature.
* Documentation lands in the same commit as the code it describes (see §2).
* **Forbidden**: `--no-verify`, force-push to `main`, WIP commits
  without a follow-up squash.
* **Push to remote** — only when the author explicitly asks.

### Force-push — why "forbidden", and what to do instead

If a working branch has moved ahead of `main` while `main` itself has
gained its own unique commits — **do not force-push the working
branch HEAD onto main**. Instead:

1. Bring `main`'s commits **into** the working branch: `git merge main`,
   or `git cherry-pick <hash>` for specific commits if a merge is too
   conflict-heavy.
2. Resolve conflicts inside the working branch (that's where the
   current code lives).
3. Fast-forward `main` to the working branch — `--force` is no longer
   needed.
4. Delete the working branch.

Force-push is acceptable only if (a) the missing commits on `main`
are **physically** reproduced via cherry-pick, and (b) the author has
explicitly OK'd `--force-with-lease`.

## 6. Container workflow

Deliberately not used on this machine — Docker Desktop adds 2–3 GB of
RAM overhead, Expo hot-reload through bind-mounts on macOS is
unreliable, and the existing native setup (`npx expo start --port
8081` + Vercel build) already gives one-clone-setup via `.env.example`.

If a third contributor appears in the future, or the project moves to
a less loaded machine, revisit.

## 7. Repo-root cleanliness

The following are allowed at the repo root:

* configs (`*.config.{js,ts}`, `babel.config.js`, `metro.config.js`, etc.)
* `package.json`, `package-lock.json`
* `README.md`, `CLAUDE.md`
* `.env.example`, `.gitignore`, `.dockerignore`, `LICENSE`
* `app.json`, `index.js` (Expo entry point)

Screenshots, videos, random files do not belong at the root:

* UI references → `reference_UI_screenshots/`
* Archive of stray screenshots → `docs/media/archive/` with meaningful names
* Random junk → `rm`

`.gitignore` contains anchored patterns (`/Screenshot*`, `/IMG_*`,
`/Telegram*`, `/*.mov`, etc.) — junk is filtered automatically.

## 8. Acceptance criteria

Every task has measurable completion criteria. Without criteria, the
task hasn't started.

* **UI tasks**: manual check in the browser at 6.1″–6.7″ (golden path
  + edge cases). The `npm run demo` / `demo:6players` / `demo:sp`
  demos serve as smoke checks for regressions.
* **Game logic**: rules in `supabase/functions/_shared/engine/rules.ts`
  change together with their tests.
* **Documentation**: walk through the §2 triggers — are they all closed?

## 9. Self-improvement and memory

Two memory layers, no duplication:

* **`~/.claude-personal/projects/<...>/memory/`** — *personal* layer.
  Author preferences, past incidents, agent feedback across sessions.
  Not committed to the repo.
* **`docs/principles.md`** and `docs/<topic>.md` — *shared* layer.
  Versioned in git, visible to anyone reading the repo. Applies to
  every contributor.

When the author corrects the agent's approach:

1. Fix the immediate problem.
2. If the lesson generalizes to future sessions, record it in exactly
   one of the two layers depending on its nature. Before writing —
   `grep` existing entries to avoid duplication.

## 10. Boundaries

* Do not push to remote without an explicit ask.
* Do not edit other projects of the user.
* Do not disable pre-commit hooks. If a hook fails — fix the cause.
* Do not delete `.env.local`, `node_modules`, `supabase/.branches`
  without confirmation — they may hold uncommitted state.
