# AGENTS.md

Notes for anyone (human or AI agent) working on this project. Distilled from the
session that built it — the traps, the decisions, and the environment quirks that
aren't obvious from the code.

## Project at a glance

A Bun + TypeScript CLI that upgrades things across several "sources" behind one
interactive picker. Sources: **npm** globals, **winget**, **Windows Update**,
**custom scripts**.

- Entry: `src/index.ts` → `src/runner.ts` orchestrates everything.
- Source contract: `src/types.ts` (`Source`). Registry: `src/sources/index.ts`.
- Config: `src/config.ts` (`ignore`, `pin`, `scripts`).

## Commands

```sh
bun run start        # run from source
bun test             # unit tests (bun:test)
bun run typecheck    # tsc --noEmit (strict)
bun run build:exe    # -> dist/updater.exe
bun run install      # copy exe to ~/.local/bin (asks; --yes to skip)
```

Always run **`bun test` and `bun run typecheck`** before committing. Both are
fast.

## Hard-won lessons

### 1. Prefer stock clack over custom TUI code

We tried to add an in-picker "press `p` to pin" feature. `@clack/prompts`'
`multiselect` has a **closed keymap** — no hook to add keys. Getting a custom key
meant dropping to `@clack/core`'s `MultiSelectPrompt`, which **requires you to
write `render()` yourself**. Reproducing clack's exact layout (guide bars, footer
order, wrapping) is fiddly and drifts from stock output. We removed it.

**Rule: if a UI feature needs custom rendering, don't build it.** Pin/ignore are
config-only by design. The picker is a plain `multiselect` call and must stay
that way.

#### Stop and ask first

If a requested change or feature **doesn't fit the library/architecture** and
would need significant custom work — vendored rendering, hand-rolled terminal
management, fighting a primitive's design — **do not start building it. Stop and
ask the user first**, explaining the trade-off (effort, fragility, maintenance)
and offering a simpler alternative or "skip it".

Real examples from this project where this rule applies:

- **In-GUI pinning** — needed a custom `MultiSelectPrompt.render()`.
- **Per-source progress lines** — needed concurrent clack spinners, which clash.
- **Virtual split-pane output panel for scripts** — needed ConPTY + a headless
  terminal emulator + blitting a viewport.

The user's consistent preference is: **keep it simple and stock, accept a small
functional loss rather than a large pile of custom code.** Don't build custom
scaffolding on your own initiative — surface it and let them decide.

Likewise, **don't add dependencies for convenience** without flagging it (e.g.
`@xterm/headless` was only acceptable in throwaway test harnesses, never in the
app itself).

### 2. clack's `spinner` is single-instance

Tried per-source progress lines with concurrent spinners — they overwrite each
other (no multi-spinner support). Reverted to one `spinner()`. If you ever want
per-source lines, the supported option is `tasks()` (sequential), not parallel
spinners.

### 3. Test interactive output with a real PTY

You cannot drive clack prompts by piping stdin — they need raw mode. To verify
rendering, use **Bun's built-in PTY** (`Bun.spawn(cmd, { terminal: { … } })`,
ConPTY on Windows) and reconstruct the screen with `@xterm/headless`. Note
ConPTY re-encodes output, so strip ANSI before parsing JSON. This is how the
picker render was verified byte-for-byte against stock clack.

### 4. Windows-specific gotchas

- **`.py` has no file association on this machine.** Running a `.py` directly
  fails with `EFTYPE: inappropriate file type or format`. That's why
  `CustomScript` has an **`interpreter`** field — always use it for `.py`.
- **The PATH `python.exe` is the Microsoft Store stub**, not real Python. The
  real one lives at `~/.local/bin/python.exe` (uv-managed). Don't assume
  `python` works.
- **`npm.ps1` is a PowerShell shim**; resolve executables via `Bun.which()` so
  `.cmd` shims launch correctly (`src/proc.ts`).
- **Spawning elevated** for Windows Update: write a `.ps1` to temp, run it via
  `Start-Process -Verb RunAs -Wait`, and read results back from a temp JSON file.
  One elevated process = one UAC prompt for the whole batch (`upgradeBatch`).
- **Console input mode is shared and fragile.** clack leaves the console in raw
  input mode, and an elevated child (UAC) / interactive child can leave it
  changed so later prompts — including a custom script's own `pause`/`input()` —
  can't read keys. `Bun`'s `process.stdin.setRawMode(false)` does **not** restore
  the original mode (it lands on `0x7`, losing flags). The fix is
  `src/console-mode.ts`: snapshot the real `GetConsoleMode` value before an
  `inherit` spawn and write it back exactly with `SetConsoleMode` afterwards
  (via `bun:ffi`). `proc.run()` wraps every `inherit` spawn in
  `withConsoleModeRestored`. Verified: `0x1f7` → `0x1f7` even when the child
  leaves it at raw `0x208`; without the fix it sticks at `0x208`/`0x1f6`.

### 5. Parsing tool output

- **winget has no JSON output** (checked v1.29). Its `upgrade` table is
  fixed-width and every row is padded to the header width, so slice cells at the
  header's token offsets. A narrow console can truncate an `Id` with `…` — that
  row's upgrade then fails with winget's own error. Unit tests cover the
  `< 173.1.0.13333` row shape.
- **npm** exits `1` when outdated packages exist — that's success, not failure.
  `-g --json` gives clean data.
- **Windows Update** emits JSON via PowerShell; Windows PowerShell 5.1's
  `ConvertTo-Json` returns a bare object for one item and an array for many —
  handle both. Set `[Console]::OutputEncoding = UTF8` and strip the BOM.

### 6. Non-interactive scripts must not hang

A `readline` prompt with no TTY spins forever (this happened — an orphaned
`bun run install` ate CPU). `scripts/install.ts` now checks
`process.stdin.isTTY` and exits with a clear message instead of waiting. Any new
interactive script must do the same.

### 7. Config paths and conventions

- User config: `%USERPROFILE%\.config\updater\config.json`, **auto-created** on
  first run. (`~/.config/…` elsewhere.)
- Project override: `./updater.config.json`, **per key** (not deep-merged).
- Rules are `source:pattern` or bare `pattern`; matching is case-insensitive,
  tested against name, full id (`npm:pkg`), and source id. `*` matches `/` too.
- Keep the **icon generated in code** (`scripts/make-icon.ts`) — no image
  libraries. Note `Bun.deflateSync` emits **raw deflate, not zlib**; PNG's IDAT
  needs a zlib wrapper (header + Adler-32) or the image won't decode.

### 8. Style / expectations

- Strict TS, `noUncheckedIndexedAccess` on. Prefer explicit types at boundaries.
- Sources are **self-contained adapters**: they own their parsing and command
  construction. The runner knows nothing tool-specific.
- Keep the UI/runner **source-agnostic** — a new source should need only a new
  file in `src/sources/` plus a registry entry.
- Tests mock `src/proc.ts` / `@clack/prompts`; don't hit the network or the real
  package managers in tests (except the custom-source tests, which use local
  temp `.cmd` files).

## Environment (this machine)

- OS: Windows 11 Pro. Package managers present: `npm`, `winget`, `bun`, `uv`.
  **No** scoop/choco/pipx/cargo/go/gem.
- `~/.local/bin` is on PATH (uv Python shims and the installed `updater.exe`).
- Bun 1.4.2, Node 24.x.
- The project uses `bun.lock` but it's **git-ignored** (deliberate, for now).

## Deliberately not done

- No in-GUI pin toggle (see lesson 1).
- No concurrent per-source spinners (lesson 2).
- No virtual output panel for scripts — rejected as too much custom terminal
  work.
- No `uv` source — `uv` is installed via winget, so winget already updates it.
