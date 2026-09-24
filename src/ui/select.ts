import type { UpgradeItem } from "../types";

export interface CheckboxOption {
  value: string;
  label: string;
  hint?: string;
  disabled?: boolean;
}

/**
 * Generic multi-select built on clack's stock `multiselect`. Arrow keys
 * navigate, space toggles, Enter confirms and Escape (or Ctrl+C) discards.
 * Returns the chosen values, or `null` on cancel.
 *
 * Imported lazily so non-interactive runs never touch the TUI.
 */
async function pickMany(
  message: string,
  options: CheckboxOption[],
  initialValues: string[],
): Promise<string[] | null> {
  const { multiselect, isCancel } = await import("@clack/prompts");

  const selected = await multiselect<string>({
    message,
    options,
    initialValues,
    required: false,
    maxItems: 15,
  });

  return isCancel(selected) ? null : selected;
}

/** Lets the user choose which sources to scan. All available ones are checked. */
export async function selectSources(
  sources: Array<{ id: string; label: string; available: boolean }>,
  message = "Select sources to check",
): Promise<string[] | null> {
  // Only available sources can be checked; unavailable ones are shown greyed out
  // so it is obvious why the list is what it is.
  const enabled = sources.filter((source) => source.available);
  if (enabled.length === 0) return null;

  return pickMany(
    message,
    sources.map((source) => ({
      value: source.id,
      label: source.label,
      disabled: !source.available,
      hint: source.available ? undefined : "not available",
    })),
    enabled.map((source) => source.id),
  );
}

/**
 * Shows the packages/services available for upgrade across the chosen sources.
 *
 * Pinned items (from config) are shown but locked, so it's clear they were
 * intentionally skipped. Ignored ones never reach this list.
 */
export async function selectUpgrades(
  items: UpgradeItem[],
  options: { message?: string } = {},
): Promise<UpgradeItem[] | null> {
  const message = options.message ?? "Select packages to upgrade";
  const byId = new Map(items.map((item) => [item.id, item]));
  const locked = (item: UpgradeItem): boolean =>
    item.pinned === true || item.disabled === true;

  const hintFor = (item: UpgradeItem): string => {
    const base =
      item.hint ??
      (item.current === item.latest
        ? item.current
        : `${item.current} → ${item.latest}`);
    if (item.pinned) return `${base} · pinned`;
    if (item.disabled) return `${base} · not found`;
    return base;
  };

  const selected = await pickMany(
    message,
    items.map((item) => ({
      value: item.id,
      label: item.name,
      hint: hintFor(item),
      disabled: locked(item),
    })),
    // Locked items are shown but never pre-selected or selectable.
    items.filter((item) => !locked(item)).map((item) => item.id),
  );

  if (selected === null) return null;

  return selected
    .map((id) => byId.get(id))
    .filter((item): item is UpgradeItem => item !== undefined);
}
