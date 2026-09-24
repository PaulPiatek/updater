import { expect, mock, test } from "bun:test";
import type { UpgradeItem } from "../src/types";

const CANCEL = Symbol("clack:cancel");
let multiselectResult: unknown = CANCEL;

interface CapturedRequest {
  options: Array<{ value: string; label: string; hint?: string; disabled?: boolean }>;
  initialValues: string[];
}

let lastRequest: CapturedRequest = { options: [], initialValues: [] };

// Mock the TUI so the selection logic can be tested headlessly.
mock.module("@clack/prompts", () => ({
  multiselect: async (opts: CapturedRequest) => {
    lastRequest = { options: opts.options, initialValues: opts.initialValues };
    return multiselectResult;
  },
  isCancel: (value: unknown) => value === CANCEL,
}));

const { selectSources, selectUpgrades } = await import("../src/ui/select");

const items: UpgradeItem[] = [
  { id: "npm:a", source: "npm", name: "a", current: "1.0.0", latest: "2.0.0" },
  { id: "npm:b", source: "npm", name: "b", current: "1.0.0", latest: "1.0.1" },
];

test("selectUpgrades returns null when the user cancels (Escape / Ctrl+C)", async () => {
  multiselectResult = CANCEL;
  expect(await selectUpgrades(items)).toBeNull();
});

test("selectUpgrades maps selected ids back to their items", async () => {
  multiselectResult = ["npm:b"];
  const result = await selectUpgrades(items);
  expect(result?.map((item) => item.id)).toEqual(["npm:b"]);
});

test("selectUpgrades returns an empty array when nothing is selected", async () => {
  multiselectResult = [];
  expect(await selectUpgrades(items)).toEqual([]);
});

test("selectUpgrades prefers an item's hint override", async () => {
  multiselectResult = ["windows-update:x"];
  await selectUpgrades([
    {
      id: "windows-update:x",
      source: "windows-update",
      name: "Some Windows update",
      current: "not installed",
      latest: "KB1",
      hint: "KB1 · 1.5 GB",
    },
  ]);
  expect(lastRequest.options[0]?.hint).toBe("KB1 · 1.5 GB");
});

test("selectSources returns null on cancel", async () => {
  multiselectResult = CANCEL;
  const result = await selectSources([
    { id: "npm", label: "npm", available: true },
  ]);
  expect(result).toBeNull();
});

test("selectSources preselects every available source", async () => {
  multiselectResult = ["npm", "winget"];
  const result = await selectSources([
    { id: "npm", label: "Global npm packages", available: true },
    { id: "winget", label: "Windows Package Manager (winget)", available: true },
  ]);

  expect(result).toEqual(["npm", "winget"]);
  expect(lastRequest.initialValues).toEqual(["npm", "winget"]);
});

test("selectSources disables unavailable sources and skips them in the defaults", async () => {
  multiselectResult = ["npm"];
  await selectSources([
    { id: "npm", label: "npm", available: true },
    { id: "winget", label: "winget", available: false },
  ]);

  const winget = lastRequest.options.find((option) => option.value === "winget");
  expect(winget?.disabled).toBe(true);
  expect(lastRequest.initialValues).toEqual(["npm"]);
});

test("selectSources returns null when no source is available", async () => {
  const result = await selectSources([
    { id: "winget", label: "winget", available: false },
  ]);
  expect(result).toBeNull();
});

test("selectUpgrades locks pinned items and excludes them from the defaults", async () => {
  multiselectResult = ["npm:a"];
  await selectUpgrades([
    { id: "npm:a", source: "npm", name: "a", current: "1.0.0", latest: "2.0.0" },
    {
      id: "npm:b",
      source: "npm",
      name: "b",
      current: "1.0.0",
      latest: "2.0.0",
      pinned: true,
    },
  ]);

  const pinned = lastRequest.options.find((option) => option.value === "npm:b");
  expect(pinned?.disabled).toBe(true);
  expect(pinned?.hint).toContain("pinned");
  expect(lastRequest.initialValues).toEqual(["npm:a"]);
});
