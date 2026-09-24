import { cancel, intro, log, note, outro, spinner } from "@clack/prompts";
import type { Source, UpgradeItem, UpgradeResult } from "./types";
import { createSources } from "./sources";
import { applyConfig, loadConfig } from "./config";
import { selectSources, selectUpgrades } from "./ui/select";

export interface RunOptions {
  dryRun: boolean;
  yes: boolean;
  json: boolean;
  /** Source ids to restrict to; empty means all available sources. */
  sources: string[];
}

const message = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/** Right-hand label for an item, honouring a source-provided `hint`. */
const versionLabel = (item: UpgradeItem): string =>
  item.hint ?? `${item.current} → ${item.latest}`;

/**
 * Waits for the user to press a key before the window can close.
 *
 * Only runs when there is an interactive terminal — never in `--json` mode, and
 * never when stdin/stdout is redirected — so scripted use can't hang waiting for
 * a keypress that will never come.
 */
async function waitForExit(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return;
  const { text, isCancel } = await import("@clack/prompts");
  // A single-character prompt: any key (or Enter) resolves it.
  if (isCancel(await text({ message: "Press Enter to exit" }))) return;
}

export async function run(opts: RunOptions): Promise<number> {
  const code = await runInternal(opts);
  // Interactive runs stay open until acknowledged; scripted runs don't pause.
  if (!opts.json) await waitForExit();
  return code;
}

async function runInternal(opts: RunOptions): Promise<number> {
  if (!opts.json) intro("updater");

  // ---------------------------------------------------------------------------
  // 1. Load config first: it defines the custom `scripts` source.
  // ---------------------------------------------------------------------------
  const config = await loadConfig();
  for (const error of config.errors) {
    if (opts.json) console.error(error);
    else log.warn(error);
  }

  const allSources = createSources(config);

  // ---------------------------------------------------------------------------
  // 2. Resolve which sources are available.
  // ---------------------------------------------------------------------------
  const candidates = allSources.filter(
    (source) => opts.sources.length === 0 || opts.sources.includes(source.id),
  );

  if (candidates.length === 0) {
    log.error(`Unknown source(s): ${opts.sources.join(", ")}`);
    return 1;
  }

  const usable: Source[] = [];
  const availability = new Map<string, boolean>();
  for (const source of candidates) {
    const ok = await source.isAvailable();
    availability.set(source.id, ok);
    if (ok) usable.push(source);
  }

  if (usable.length === 0) {
    log.error("No usable sources found.");
    return 1;
  }

  // ---------------------------------------------------------------------------
  // 3. Let the user choose which sources to scan (skipped for --yes / --json).
  // ---------------------------------------------------------------------------
  let available = usable;
  if (!opts.json && !opts.yes) {
    const ids = await selectSources(
      candidates.map((source) => ({
        id: source.id,
        label: source.title,
        available: availability.get(source.id) ?? false,
      })),
    );

    if (ids === null) {
      cancel("Cancelled.");
      return 130;
    }
    if (ids.length === 0) {
      outro("No sources selected.");
      return 0;
    }

    const wanted = new Set(ids);
    available = usable.filter((source) => wanted.has(source.id));
  }

  // ---------------------------------------------------------------------------
  // 3. Gather upgradable items from every chosen source. In JSON mode we stay
  //    completely silent on stdout so the output stays machine-readable.
  // ---------------------------------------------------------------------------
  const spin = opts.json ? null : spinner();
  spin?.start("Checking for updates…");

  const items: UpgradeItem[] = [];
  const failures: string[] = [];
  // Sources run concurrently: the Windows Update scan is slow and shouldn't
  // hold up npm/winget.
  const listed = await Promise.allSettled(available.map((source) => source.list()));
  listed.forEach((outcome, index) => {
    const source = available[index]!;
    if (outcome.status === "fulfilled") items.push(...outcome.value);
    else failures.push(`${source.title}: ${message(outcome.reason)}`);
  });

  spin?.stop(items.length > 0 ? `Found ${items.length} upgrade(s).` : "Everything is up to date.");

  // ---------------------------------------------------------------------------
  // 4. Apply ignore/pin rules from config.
  // ---------------------------------------------------------------------------
  const { kept: visible, ignored, pinned } = applyConfig(items, config);

  if (!opts.json && ignored + pinned > 0) {
    log.info(`${ignored} ignored · ${pinned} pinned by config`);
  }

  // ---------------------------------------------------------------------------
  // 5. Machine-readable mode: print and exit.
  // ---------------------------------------------------------------------------
  if (opts.json) {
    console.log(JSON.stringify(visible, null, 2));
    for (const failure of failures) console.error(failure);
    return failures.length > 0 ? 1 : 0;
  }

  for (const failure of failures) log.error(failure);

  const missingScripts = visible.filter(
    (item) => item.source === "custom" && item.disabled === true,
  ).length;
  if (missingScripts > 0) {
    log.warn(`${missingScripts} custom script(s) not found — they stay locked.`);
  }

  if (visible.length === 0) {
    if (ignored + pinned > 0) {
      outro(`${ignored + pinned} package(s) hidden by config — nothing to do.`);
    } else {
      outro(failures.length > 0 ? "Finished with errors." : "Nothing to do 🎉");
    }
    return failures.length > 0 ? 1 : 0;
  }

  // Pinned or disabled items must never be upgraded.
  const upgradable = (item: UpgradeItem): boolean =>
    item.pinned !== true && item.disabled !== true;

  // ---------------------------------------------------------------------------
  // 6. Let the user pick (skipped with --yes). Locked items can't be selected.
  // ---------------------------------------------------------------------------
  let selected: UpgradeItem[];
  if (opts.yes) {
    selected = visible.filter(upgradable);
  } else {
    const picked = await selectUpgrades(visible);
    if (picked === null) {
      cancel("Cancelled.");
      return 130;
    }
    selected = picked;
  }
  selected = selected.filter(upgradable);

  if (selected.length === 0) {
    outro("Nothing to do 🎉");
    return 0;
  }

  // ---------------------------------------------------------------------------
  // 7a. Dry run: ask each source what it *would* run, and print it. Sources with
  //     a batch capability describe the whole batch in one entry.
  // ---------------------------------------------------------------------------
  if (opts.dryRun) {
    const results: UpgradeResult[] = [];
    for (const source of available) {
      const group = selected.filter((item) => item.source === source.id);
      if (group.length === 0) continue;

      if (source.upgradeBatch) {
        results.push(...(await source.upgradeBatch(group, { dryRun: true })));
      } else {
        for (const item of group) {
          results.push(await source.upgrade(item, { dryRun: true }));
        }
      }
    }

    const body = results
      .map((result) => `${result.item.name}  (${versionLabel(result.item)})\n  $ ${result.command}`)
      .join("\n\n");

    note(body, "Dry run — no changes made");
    outro(`Would upgrade ${results.length} package(s).`);
    return 0;
  }

  // ---------------------------------------------------------------------------
  // 7b. Real run: execute upgrades per source, reporting each result.
  // ---------------------------------------------------------------------------
  const counts = { ok: 0, failed: 0 };
  let rebootRequired = false;

  const tally = (result: UpgradeResult): void => {
    if (result.ok) counts.ok++;
    else counts.failed++;
    if (result.rebootRequired) rebootRequired = true;
  };

  for (const source of available) {
    const group = selected.filter((item) => item.source === source.id);
    if (group.length === 0) continue;

    // Batch-capable sources (e.g. Windows Update) get one elevated run.
    if (source.upgradeBatch) {
      const batchSpin = spinner();
      batchSpin.start(`Applying ${group.length} ${source.title} item(s)…`);

      const results = await source.upgradeBatch(group, { dryRun: false });
      const failed = results.filter((result) => !result.ok).length;
      if (failed === 0) batchSpin.stop(`${source.title}: ${results.length} done`);
      else batchSpin.error(`${source.title}: ${failed}/${results.length} failed`);

      for (const result of results) {
        tally(result);
        if (result.ok) log.success(`${result.item.name}  (${versionLabel(result.item)})`);
        else log.error(`${result.item.name}: ${result.error ?? "failed"}`);
      }
      continue;
    }

    // Sources that print to the terminal themselves (custom scripts) must run
    // without a spinner, otherwise the two overwrite each other. The script
    // inherits the real stdout/stdin, so its output streams live and prompts
    // work; we just frame it with a header and a result line.
    if (source.runMode === "stream") {
      log.step(source.title);
      for (const item of group) {
        const result = await source.upgrade(item, { dryRun: false });
        tally(result);
        if (result.ok) log.success(`${item.name}  (${versionLabel(item)})`);
        else log.error(`${item.name}: ${result.error ?? "failed"}`);
      }
      continue;
    }

    for (const item of group) {
      const itemSpin = spinner();
      itemSpin.start(`${item.name}  ${versionLabel(item)}`);

      const result = await source.upgrade(item, { dryRun: false });
      tally(result);

      if (result.ok) itemSpin.stop(`${item.name}  ${versionLabel(item)}`);
      else itemSpin.error(`${item.name}: ${result.error ?? "upgrade failed"}`);
    }
  }

  if (rebootRequired) {
    log.warn("A restart is required to finish installing some updates.");
  }

  outro(`Done: ${counts.ok} upgraded, ${counts.failed} failed.`);
  return counts.failed > 0 ? 1 : 0;
}
