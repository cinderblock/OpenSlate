import { type LabelDefinition, type Position, STANCES, type Stance } from "@openslate/core";
import { createLocalStore, useLocalStore } from "./localStore";

/**
 * The user's own words for their positions (SPEC §3.17): "Endorsed",
 * "Recommended", "Watch list". Compose offers them on each pick, and a signed
 * slate carries the ones it uses, in this order, as its legend.
 */
export interface MyLabel {
  label: string;
  /** What it means, published with the slate. */
  description?: string;
  /** The stance a pick takes when given this label. Local only: never published. */
  stance?: Stance;
}

const KEY = "openslate.myLabels.v1";

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

function parseLabels(raw: unknown): MyLabel[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const ok = raw.every(
    (entry) =>
      isRecord(entry) &&
      typeof entry.label === "string" &&
      (entry.description === undefined || typeof entry.description === "string") &&
      (entry.stance === undefined || STANCES.includes(entry.stance as Stance)),
  );
  return ok ? (raw as MyLabel[]) : undefined;
}

export const myLabelsStore = createLocalStore<MyLabel[]>(KEY, [], parseLabels);

export function useMyLabels() {
  return useLocalStore(myLabelsStore);
}

/** Why a label can't be added or renamed to `label`, or undefined when it can. */
export function labelProblem(
  labels: readonly MyLabel[],
  label: string,
  except?: string,
): string | undefined {
  const name = label.trim();
  if (!name) return "a label needs a name";
  if (labels.some((l) => l.label === name && l.label !== except))
    return `"${name}" is already a label`;
  return undefined;
}

/** Add a label at the end; unchanged when `labelProblem` objects. */
export function addLabel(labels: readonly MyLabel[], entry: MyLabel): MyLabel[] {
  const label = entry.label.trim();
  if (labelProblem(labels, label)) return [...labels];
  const description = entry.description?.trim();
  return [
    ...labels,
    {
      label,
      ...(description ? { description } : {}),
      ...(entry.stance ? { stance: entry.stance } : {}),
    },
  ];
}

/** Move the label at `index` one place up (-1) or down (+1). */
export function moveLabel(labels: readonly MyLabel[], index: number, by: -1 | 1): MyLabel[] {
  const to = index + by;
  const next = [...labels];
  if (index < 0 || index >= next.length || to < 0 || to >= next.length) return next;
  [next[index], next[to]] = [next[to] as MyLabel, next[index] as MyLabel];
  return next;
}

/**
 * The `labels` a slate publishes: the ones its positions use, in the user's
 * order, without the local default stance. A position's label that isn't one
 * of the user's labels (removed since) is still listed, after them, so the
 * slate stays valid.
 */
export function labelsFor(
  labels: readonly MyLabel[],
  positions: readonly Pick<Position, "label">[],
): LabelDefinition[] {
  const used = new Set(positions.flatMap((p) => (p.label ? [p.label] : [])));
  const out: LabelDefinition[] = [];
  for (const { label, description } of labels) {
    if (!used.delete(label)) continue;
    out.push({ label, ...(description ? { description } : {}) });
  }
  for (const label of used) out.push({ label });
  return out;
}
