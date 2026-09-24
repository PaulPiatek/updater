/**
 * Installs the compiled updater.exe into the user's local bin directory
 * (`$HOME/.local/bin`, falling back to `%USERPROFILE%\.local\bin`).
 *
 * Asks for confirmation before touching anything. Pass `--yes` to skip the
 * prompt (useful for scripted installs).
 *
 * Run: bun run scripts/install.ts [--yes]
 */
import { copyFile, mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

const SOURCE = join(process.cwd(), "dist", "updater.exe");
const ASSUME_YES = Bun.argv.includes("--yes") || Bun.argv.includes("-y");

function home(): string {
  return process.env.USERPROFILE ?? process.env.HOME ?? "";
}

function binDir(): string {
  return join(home(), ".local", "bin");
}

/** Whether `dir` is present in PATH (case-insensitive on Windows). */
function isOnPath(dir: string): boolean {
  const parts = (process.env.PATH ?? "").split(";").filter(Boolean);
  const normalise = (value: string): string =>
    value.replace(/[\\/]+$/, "").toLowerCase();
  return parts.some((part) => normalise(part) === normalise(dir));
}

async function confirm(question: string): Promise<boolean> {
  // With no interactive stdin (piped, redirected, or run from a service) there
  // is nobody to answer, so don't wait forever — make the caller use --yes.
  if (!process.stdin.isTTY && !ASSUME_YES) {
    console.error(
      "✖ Not an interactive terminal. Re-run with `--yes` to install without confirmation.",
    );
    process.exit(1);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === "" || answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

const source = Bun.file(SOURCE);
if (!(await source.exists())) {
  console.error(`✖ ${SOURCE} not found. Run \`bun run build:exe\` first.`);
  process.exit(1);
}

const dir = binDir();
const target = join(dir, "updater.exe");

if (!(await confirm(`Install ${SOURCE} to ${target}? [Y/n] `))) {
  console.log("Cancelled.");
  process.exit(0);
}

await mkdir(dir, { recursive: true });

// Write to a temp name first, then rename, so a running `updater.exe` that is
// locked on Windows isn't left half-overwritten.
const staging = `${target}.new`;
try {
  await copyFile(SOURCE, staging);
  await rm(target, { force: true });
  await rename(staging, target);
} catch (err) {
  await rm(staging, { force: true }).catch(() => {});
  console.error(`✖ Failed to install: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

const sizeMB = (source.size / 1024 / 1024).toFixed(1);
console.log(`✔ Installed updater.exe (${sizeMB} MB) to ${dir}`);

if (!isOnPath(dir)) {
  console.log(`\n⚠ ${dir} is not on your PATH. Add it to run \`updater\` from anywhere.`);
}
