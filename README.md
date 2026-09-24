# updater

An interactive CLI updater. It upgrades **globally installed npm packages**,
**Windows Package Manager (winget)** packages and **Windows Update** software
updates; the selection UI and runner are source-agnostic so more package
managers can be added later (brew, pip, …).

Built with [Bun](https://bun.sh) + TypeScript and
[`@clack/prompts`](https://github.com/bombshell-dev/clack) for the terminal UI.

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
`bun src/index.ts` directly.

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

Optional config files control which packages are hidden or locked:

| Path                            | Scope                          |
| ------------------------------- | ------------------------------ |
| `%APPDATA%/updater/config.json` | user-wide default              |
| `./updater.config.json`         | project folder, overrides user |

### Where the config lives

The user config is created automatically on first run at:

```
%USERPROFILE%\.config\updater\config.json      (Windows)
~/.config/updater/config.json                  (other platforms)
```

If a `./updater.config.json` exists in the current folder it overrides the user
config **per key** (`ignore` and `pin` are replaced wholesale, not merged).

Each file may set either or both keys. See `updater.config.example.json`.

```json
{
  "ignore": ["npm:@types/*", "winget:Ubisoft.Connect"],
  "pin": ["npm:npm-check-updates", "windows-update:*"]
}
```

- **ignore** — package disappears from the list entirely (you won't see it).
- **pin** — package is shown but **locked**: it is greyed out with a `pinned`
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
bun test          # unit tests
bun run typecheck # tsc --noEmit
```

## Standalone executable

Build a self-contained Windows exe (no Bun/Node needed to run it):

```sh
bun run build:exe   # -> dist/updater.exe  (~82 MB)
```

This uses `bun build --compile` with the app metadata and icon:

- `assets/icon.ico` — regenerate with `bun run icon` (a self-contained script,
  no image libraries needed).
- `--windows-title/--windows-publisher/--windows-version/--windows-description`
  set the exe's properties.

The exe is fully featured: all sources, the interactive pickers and the
elevated Windows Update batch work exactly as under `bun run start`. Note the
size (~82 MB) — that's the embedded Bun runtime, the price of zero runtime
dependencies. SmartScreen may warn on first run because the exe is unsigned.

Development still uses `bun run start`; the exe is just a build artifact.

## Architecture

```
src/
  index.ts          CLI entry, flag parsing, help/version
  runner.ts         discover sources -> gather -> config -> select -> apply
  proc.ts           Bun.spawn helper for running commands
  config.ts         ignore/pin rules from user + project config files
  types.ts          UpgradeItem / Source / UpgradeResult
  ui/select.ts      generic checkbox picker (source-agnostic)
  sources/
    index.ts        source registry (built-ins + config-driven custom)
    npm.ts          global npm packages
    winget.ts       Windows Package Manager packages
    windows-update.ts  Windows Update software updates
    custom.ts       user-defined executables from config
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
once the source is registered.

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
  when their work is better done in one shot (one process, one prompt, etc.).

For a longer-lived follow-up, sources are the natural place to plug in a config
file (which sources are enabled, pinned packages, etc.).
