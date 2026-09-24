# updater

An interactive CLI updater. It upgrades **globally installed npm packages**,
**Windows Package Manager (winget)** packages, **Windows Update** software
updates, and runs your own **custom update scripts**.

Everything is driven by one terminal flow: pick which *sources* to scan, pick
which *upgrades* to apply, done. The selection UI and runner are source-agnostic,
so more package managers can be added later (brew, pip, …).

Built with [Bun](https://bun.sh) + TypeScript and
[`@clack/prompts`](https://github.com/bombshell-dev/clack) for the terminal UI.

## What it does

- **Lists** everything that has an update available, across the sources you
  choose.
- Lets you **pick** individually what to upgrade (all checked by default; every
  row shows `current → latest`).
- **Applies** the selection, reporting success/failure per item.
- Understands **ignore** and **pin** rules so you can hide or lock packages.
- Can **run your own scripts** as a source.
- Also works **non-interactively** (`--json`, `--yes`) for scripting.

## Requirements

- [Bun](https://bun.sh) 1.4+ (for development / running from source).
- The tools for whichever sources you use: `npm`, `winget`, PowerShell (all
  present on a standard Windows box).
- The standalone `.exe` needs none of these to *run* — only the tools used by
  the sources themselves.

## Usage

```sh
bun run start                 # interactive: pick sources, pick packages, upgrade
bun run start --dry-run       # show the list and the commands, change nothing
bun run start --yes           # skip the pickers, upgrade everything
bun run start --json          # machine-readable list, no TUI
bun run start --source npm    # restrict to one source (repeatable)
bun run start --source winget
bun run start --source windows-update
bun run start --help
```

`npm run start` / `bun run start` are equivalent; you can also call
`bun src/index.ts` directly. When installed as an exe, `updater [options]` works
the same way (see [Standalone executable](#standalone-executable)).

### Flags

| Flag              | Alias | Meaning                                                |
| ----------------- | ----- | ------------------------------------------------------ |
| `--dry-run`       | `-n`  | List and select as usual, but print commands, run none |
| `--yes`           | `-y`  | Skip both pickers and upgrade everything               |
| `--json`          |       | Print the upgradable items as JSON and exit (no TUI)   |
| `--source <id>`   |       | Only use this source (repeatable)                      |
| `--help`          | `-h`  | Show help                                              |
| `--version`       | `-v`  | Show the version                                       |

### Picker keybindings

The program asks you to pick **sources** first, then **packages** — both use the
same checkbox list:

| Key         | Action                     |
| ----------- | -------------------------- |
| `↑` / `↓`   | navigate                   |
| `space`     | toggle the highlighted row |
| `enter`     | confirm selection          |
| `esc`/`^C`  | discard and exit (code 130)|

Every item is checked by default; each package row shows `current → latest`.
Sources that are not installed are greyed out and cannot be checked.

### Exit codes

| Code | Meaning                                     |
| ---- | ------------------------------------------- |
| `0`  | success (or nothing to do / nothing picked) |
| `1`  | one or more upgrades failed, or source error|
| `2`  | invalid command-line usage                  |
| `130`| cancelled by the user                       |

## Configuration

Optional config files control which items are hidden or locked:

| Path                                  | Scope                          |
| ------------------------------------- | ------------------------------ |
| `%USERPROFILE%\.config\updater\config.json` | user-wide default (auto-created) |
| `./updater.config.json`               | project folder, overrides user |

### Where the config lives

The user config is created automatically on first run at:

```
%USERPROFILE%\.config\updater\config.json      (Windows)
~/.config/updater/config.json                  (other platforms)
```

If a `./updater.config.json` exists in the current folder it overrides the user
config **per key** (`ignore`, `pin` and `scripts` are replaced wholesale, not
merged).

Each file may set any of the keys `ignore`, `pin` and `scripts` — see
`updater.config.example.json`.

```json
{
  "ignore": ["npm:@types/*", "winget:Ubisoft.Connect"],
  "pin": ["npm:npm-check-updates", "windows-update:*"]
}
```

- **ignore** — the item disappears from the list entirely (you won't see it).
- **pin** — the item is shown but **locked**: it is greyed out with a `pinned`
  hint and can never be selected or upgraded.

If a rule matches both lists, **ignore wins**.

### Custom scripts

You can expose your own update executables as a **Custom scripts** category.
Add an entry to the `scripts` array:

```json
{
  "scripts": [
    {
      "name": "update-all",
      "path": "C:\\Users\\me\\scripts\\update-all.cmd"
    },
    {
      "name": "drivers",
      "path": "C:\\Users\\me\\tools\\drivers\\update.ps1",
      "args": ["-Silent"],
      "cwd": "C:\\Users\\me\\tools\\drivers"
    }
  ]
}
```

| Field         | Required | Meaning                                                                 |
| ------------- | -------- | ----------------------------------------------------------------------- |
| `path`        | yes      | The executable. Absolute, or relative to the config file's directory.   |
| `name`        | no       | Label in the picker. Defaults to the executable's file name.            |
| `interpreter` | no       | Run `path` with this program, e.g. a Python executable.                 |
| `args`        | no       | Arguments passed to the executable (array, invoked without a shell).    |
| `cwd`         | no       | Working directory. **Defaults to the executable's own folder.**          |

Notes:

- Each script is one "run me" row in the picker (like a package). There is no
  version to compare, so every configured script is always listed.
- The executable is started **in its own directory** unless you set `cwd`, and
  is invoked **directly** (no shell), so arguments are passed verbatim.
- **Use `interpreter` for script types Windows can't execute directly**, e.g.
  `.py` when no file association is registered. For example, to run a Python
  script with a project's virtualenv:
  ```json
  {
    "name": "ImageAI",
    "path": "G:\\ImageAI\\update.py",
    "interpreter": "G:\\ImageAI\\ComfyUI\\venv\\Scripts\\python.exe"
  }
  ```
  The command then becomes `<interpreter> <path> <args>`.
- **Output and input are live.** Scripts inherit the real terminal: their output
  streams straight to you as they run and they can prompt for input (the
  spinner is paused while they run so nothing is overwritten). The runner prints
  a `Custom scripts` header, then the script's output, then a success/failure
  line.
- Because the terminal stays open for the whole run, a script does **not** need
  a `pause` / `Read-Host` / `input("...")` at the end — remove those, they only
  block waiting for a keypress. (If you do keep one, it will receive your real
  input and continue when you press Enter.)
- If the executable doesn't exist it is shown **greyed out and locked**
  (`· not found`), so typos are obvious instead of failing at run time.
- If no scripts are configured, the "Custom scripts" category is not shown.
- Scripts can be ignored or pinned like anything else: `custom:<name>`,
  or `custom:*` for all of them.

### Rule syntax

A rule is `source:pattern`, or just `pattern`:

- `npm:@types/*` — every `@types/*` package from the npm source
- `winget:Ubisoft.Connect` — one specific winget package (by id)
- `npm:*` — everything from npm (works for scoped names too)
- `npm` — bare source id, same as `npm:*`
- `@opencode/cli` — bare pattern, matches that package name on any source

`*` matches any characters (including `/`) and `?` matches one character.
Matching is case-insensitive. A rule is tested against the item's name, its
full id (e.g. `npm:npm-check-updates`) and its source id.

## Development

```sh
bun install
```

### npm / bun scripts

All targets in `package.json` and what they do:

| Target              | Command                                                        | Purpose                                                                 |
| ------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `start`             | `bun run src/index.ts`                                         | Run the updater from source (the normal dev entry point).               |
| `test`              | `bun test`                                                     | Run the unit test suite (`tests/`, [bun:test](https://bun.sh/docs/cli/test)). |
| `typecheck`         | `tsc --noEmit`                                                 | Strict type check; no output files.                                     |
| `icon`              | `bun run scripts/make-icon.ts`                                 | Regenerate `assets/icon.ico` (multi-size ICO, drawn in code — no image libs). |
| `build:exe`         | `bun build --compile … ./src/index.ts`                         | Build the standalone `dist/updater.exe` with icon + Windows metadata.   |
| `install`           | `bun run scripts/install.ts`                                   | Copy `dist/updater.exe` to `%USERPROFILE%\.local\bin` (asks first; `--yes` skips). |

Run any of them with `bun run <target>`, e.g. `bun run test` or
`bun run build:exe`.

### Typical workflows

**Developing:**
```sh
bun run start        # run it
bun run test         # while iterating
bun run typecheck    # before committing
```

**Shipping the executable:**
```sh
bun run icon         # only if you changed the icon script
bun run build:exe    # -> dist/updater.exe
bun run install      # -> %USERPROFILE%\.local\bin\updater.exe (asks to confirm)
```

`install` writes to a temp file and then renames, so re-installing over a
currently-running `updater.exe` is safe, and it warns if the target directory is
not on your `PATH`. With no interactive terminal it refuses to prompt — use
`bun run install --yes`.

### Standalone executable

`bun run build:exe` produces a self-contained Windows exe (no Bun/Node needed to
run it):

```sh
bun run build:exe   # -> dist/updater.exe  (~82 MB)
```

It uses `bun build --compile` plus:

- `--windows-icon=assets/icon.ico` — the app icon (see `bun run icon`).
- `--windows-title`, `--windows-publisher`, `--windows-version`,
  `--windows-description` — Windows file properties shown in Explorer.

The exe is fully featured: all sources, the interactive pickers and the elevated
Windows Update batch work exactly as under `bun run start`. Notes:

- **Size (~82 MB)** — that's the embedded Bun runtime, the price of zero runtime
  dependencies.
- **SmartScreen** may warn on first run because the exe is unsigned; choose
  "More info → Run anyway".
- Development still uses `bun run start`; the exe is just a build artifact
  (`dist/` is git-ignored).

## Architecture

```
src/
  index.ts          CLI entry, flag parsing, help/version
  runner.ts         discover sources -> gather -> config -> select -> apply
  proc.ts           Bun.spawn helper for running commands
  config.ts         ignore/pin/scripts from user + project config files
  types.ts          UpgradeItem / Source / UpgradeResult
  ui/select.ts      generic checkbox picker (source-agnostic)
  sources/
    index.ts        source registry (built-ins + config-driven custom)
    npm.ts          global npm packages
    winget.ts       Windows Package Manager packages
    windows-update.ts  Windows Update software updates
    custom.ts       user-defined executables from config
scripts/
  make-icon.ts      generates assets/icon.ico
  install.ts        installs the built exe into ~/.local/bin
assets/
  icon.ico          app icon (generated)
tests/              bun:test unit tests
```

### Adding a source

Implement the `Source` interface in `src/types.ts` and register it in
`src/sources/index.ts`:

```ts
import type { Source } from "../types";

export const mySource: Source = {
  id: "my",
  title: "My package manager",

  async isAvailable() {
    /* return false if the tool is missing */
    return true;
  },

  async list() {
    // return UpgradeItem[] — one entry per available upgrade
    return [];
  },

  async upgrade(item, { dryRun }) {
    // return { item, ok, command } — and, when !dryRun, actually run it
  },
};
```

The picker, runner, `--dry-run`, `--json` and `--yes` all work automatically
once the source is registered. Optional extras on the interface:

- `runMode?: "spinner" | "stream"` — use `stream` if the source prints to the
  terminal itself (the runner then pauses its spinner so the two don't clash).
  The `custom` source uses this.
- `upgradeBatch(items, opts)` — implement when the work is better done in one
  shot (one process, one UAC prompt), as `windows-update` does.

### Source notes

- **npm** — uses `npm outdated -g --json`; upgrades with `npm install -g <pkg>@latest`.
- **winget** — winget has no JSON output, so its fixed-width `winget upgrade`
  table is parsed (`src/sources/winget.ts`). Rows are sliced using the header's
  column offsets, which is reliable because winget pads every line to the same
  width. If a very narrow console truncates a package `Id` with an ellipsis, the
  upgrade for that row will fail with winget's own error; widen the terminal if
  that happens. Upgrades run with `--silent --disable-interactivity
  --accept-package-agreements --accept-source-agreements`.
- **windows-update** — uses the built-in Windows Update Agent COM API
  (`Microsoft.Update.Session`) through PowerShell, since `wuauclt`/`UsoClient`
  are deprecated no-ops and the `PSWindowsUpdate` module is an extra dependency.
  Listing is **software updates only** (no drivers) and works **without admin**.
  Installing needs admin, so when you apply Windows Update items the runner
  spawns **one elevated PowerShell process → a single UAC prompt** for the whole
  batch (the `upgradeBatch` capability on `Source`). If you decline UAC, that
  batch fails cleanly. Some updates only take effect after a restart, which the
  summary warns about. Note: the reported download size comes from WUA and can
  overstate the real download.
- **New sources** can implement the optional `upgradeBatch(items, opts)` method
  when their work is better done in one shot (one process, one prompt, etc.),
  and set `runMode: "stream"` when they write to the terminal directly.
