import { memoByString } from "./memoByString";

/**
 * Ordering names the way ballots do: by last name, in an alphabet that may be
 * a drawn one, and rotated from one district to the next. Pure; unit-tested in
 * test/ballotOrder.test.ts. Which alphabet and how far to rotate is each
 * region's law (`ballotOrder.ts`).
 */

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v", "md", "phd", "esq"]);
const PARTICLES = new Set([
  "de",
  "del",
  "della",
  "la",
  "le",
  "van",
  "von",
  "der",
  "da",
  "di",
  "du",
  "st",
]);

/** Letters only, accents dropped, upper case. */
function letters(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
}

/**
 * A name's sort parts: last name, then first, then the rest. "Xavier Becerra"
 * → BECERRA, XAVIER. Nicknames in quotes or parentheses, suffixes (Jr., III)
 * and a trailing comma's part are left out; a particle before the last name
 * ("Kevin de León") belongs to it.
 */
export const sortParts: (name: string) => readonly string[] = memoByString((name) => {
  const words = name
    .replace(/"[^"]*"|“[^”]*”|\([^)]*\)/g, " ")
    .split(/[\s,]+/)
    .filter((word) => letters(word) !== "");
  while (words.length > 1 && SUFFIXES.has(letters(words.at(-1) ?? "").toLowerCase())) words.pop();
  if (words.length === 0) return [letters(name)];
  let lastStart = words.length - 1;
  while (
    lastStart > 1 &&
    PARTICLES.has((words[lastStart - 1] ?? "").toLowerCase().replace(/\.$/, ""))
  )
    lastStart--;
  const last = letters(words.slice(lastStart).join(""));
  const [first = "", ...middle] = words.slice(0, lastStart);
  return [last, letters(first), letters(middle.join(""))];
});

/** Compare two names by a drawn alphabet: last name, then first, then middle, letter by letter. */
export function compareByAlphabet(alphabet: string, a: string, b: string): number {
  const rank = (letter: string) => alphabet.indexOf(letter);
  const pa = sortParts(a);
  const pb = sortParts(b);
  for (let part = 0; part < Math.max(pa.length, pb.length); part++) {
    const x = pa[part] ?? "";
    const y = pb[part] ?? "";
    for (let i = 0; i < Math.min(x.length, y.length); i++) {
      const diff = rank(x[i] as string) - rank(y[i] as string);
      if (diff !== 0) return diff;
    }
    if (x.length !== y.length) return x.length - y.length;
  }
  return 0;
}

/** Move the first `offset` names to the end: a ballot rotation, once per district. */
export function rotate<T>(list: T[], offset: number): T[] {
  if (list.length === 0) return list;
  const n = ((offset % list.length) + list.length) % list.length;
  return [...list.slice(n), ...list.slice(0, n)];
}
