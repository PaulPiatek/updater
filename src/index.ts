#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { run } from "./runner";
import pkg from "../package.json";

const HELP = `
updater — interactive CLI updater

Usage:
  updater [options]

Options:
  -n, --dry-run        Show what would be upgraded without changing anything.
  -y, --yes            Skip the picker and upgrade everything.
      --json           Print upgradable packages as JSON and exit.
      --source <id>    Only use the given source (repeatable).
  -h, --help           Show this help.
  -v, --version        Show the version.

Sources:
  npm                  Globally installed npm packages.
  winget               Windows Package Manager packages.
  windows-update       Pending Windows updates (needs admin to install).
  custom               Scripts defined in the config (shown when configured).

Keybindings in the pickers:
  ↑/↓ navigate   space toggle   enter confirm   esc discard

Interactive flow: choose sources first, then choose packages.
Pinned packages are shown locked; ignored ones are hidden (see config).
`.trim();

async function main(): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: Bun.argv.slice(2),
      options: {
        "dry-run": { type: "boolean", short: "n" },
        yes: { type: "boolean", short: "y" },
        json: { type: "boolean" },
        source: { type: "string", multiple: true },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
      allowPositionals: false,
    });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error("Run `updater --help` for usage.");
    return 2;
  }

  const { values } = parsed;

  if (values.help) {
    console.log(HELP);
    return 0;
  }
  if (values.version) {
    console.log(pkg.version);
    return 0;
  }

  return run({
    dryRun: values["dry-run"] ?? false,
    yes: values.yes ?? false,
    json: values.json ?? false,
    sources: values.source ?? [],
  });
}

process.exitCode = await main();
