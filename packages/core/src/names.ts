/**
 * Candidate-name matching (SPEC §3.11): whether a name an endorser wrote is a
 * name on the ballot listing. Two names are the same person when they differ
 * only in punctuation/accents/hyphens, middle names or initials, a Jr. suffix,
 * or a common nickname, including a nickname the ballot prints in parentheses
 * or quotes ("Donald P. (Don) Wagner", 'Nicholas "Nick" Schultz'). A name that
 * only *resembles* a ballot name (a typo, an unusual short form) is offered as
 * a suggestion, never taken as certain.
 */

export const strip = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const nick: Record<string, string> = {
  sam: "samuel",
  steve: "steven",
  sue: "susan",
  joe: "joseph",
  ray: "raymond",
  dan: "daniel",
  mike: "michael",
  bob: "robert",
  bill: "william",
  jim: "james",
  tom: "thomas",
  chris: "christopher",
  dave: "david",
  tony: "anthony",
  nick: "nicholas",
  don: "donald",
};

const toks = (s: string) =>
  strip(s)
    .replace(/\b(jr|sr|dr|ii|iii)\b/g, "")
    .split(" ")
    .filter((t) => t.length > 1)
    .map((t) => nick[t] ?? t);

// A nickname in (parentheses), "straight quotes", “curly quotes” or ‘curly singles’.
// A lone apostrophe (O’Brien) never opens one.
const quoted = /^(.*?)\s*(?:\(([^)]+)\)|"([^"]+)"|“([^”]+)”|‘([^’]+)’)\s*(.*)$/;

/**
 * The forms a name goes by: as written, without the quoted nickname ("Donald P. Wagner"),
 * and with the nickname in place of the given names ("Don Wagner").
 */
export function variants(name: string): string[] {
  const m = quoted.exec(name);
  if (!m) return [name];
  const before = m[1] ?? "";
  const nickname = m[2] ?? m[3] ?? m[4] ?? m[5] ?? "";
  const after = m[6] ?? "";
  return [name, `${before} ${after}`.trim(), `${nickname} ${after}`.trim()];
}

const sub = (a: string[], b: string[]) => a.every((t) => b.includes(t));

function sameForm(a: string, b: string) {
  if (strip(a).replace(/ /g, "") === strip(b).replace(/ /g, "")) return true; // DJ/D.J., hyphens, accents
  const ta = toks(a);
  const tb = toks(b);
  return ta[0] === tb[0] && (sub(ta, tb) || sub(tb, ta)) && Math.min(ta.length, tb.length) >= 2;
}

export function samePerson(a: string, b: string): boolean {
  return variants(a).some((va) => variants(b).some((vb) => sameForm(va, vb)));
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++)
      row[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    prev = row;
  }
  return prev[b.length] ?? 0;
}

/** Looks like a misspelling of, or a less usual short form of, the same name. */
function resembles(a: string, b: string) {
  const ta = toks(a);
  const tb = toks(b);
  // Same surname, and one given name starts the other (Mano / Manohar) or is
  // among the other's names (David Liu / Long David Liu).
  if (ta.length >= 2 && tb.length >= 2 && ta.at(-1) === tb.at(-1)) {
    const [ga, gb] = [ta[0] ?? "", tb[0] ?? ""];
    if (ga.length >= 3 && gb.length >= 3 && (ga.startsWith(gb) || gb.startsWith(ga))) return true;
    if (sub(ta, tb) || sub(tb, ta)) return true;
  }
  // A typo or two (Gonzalez / Gonzales, Bourisquot / Boursiquot).
  return editDistance(ta.join(""), tb.join("")) <= 2;
}

export interface BallotMatch {
  /** The ballot's spelling. */
  name: string;
  /**
   * `true` when the names are the same person by the rules above, safe to rewrite
   * unattended. `false` for a resemblance a human should confirm.
   */
  sure: boolean;
}

/** The ballot name `choice` most likely means, if exactly one fits. */
export function matchBallotName(choice: string, ballot: Iterable<string>): BallotMatch | undefined {
  const names = [...ballot];
  if (names.includes(choice)) return { name: choice, sure: true };
  const same = names.filter((n) => samePerson(choice, n));
  if (same.length === 1) return { name: same[0] as string, sure: true };
  if (same.length > 1) return undefined;
  const like = names.filter((n) => variants(n).some((v) => resembles(choice, v)));
  return like.length === 1 ? { name: like[0] as string, sure: false } : undefined;
}
