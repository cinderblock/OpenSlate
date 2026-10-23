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

/**
 * Common short forms, by formal given name. A short form may belong to several
 * (Pat: Patricia, Patrick); if a race has both, nothing matches by rule.
 */
const SHORT_FORMS: Record<string, string[]> = {
  alexander: ["alex", "al"],
  alexandra: ["alex", "sandra"],
  alexandre: ["alex"],
  alfred: ["al", "fred"],
  andrew: ["andy", "drew"],
  anthony: ["tony"],
  benjamin: ["ben"],
  catherine: ["cathy", "kate", "katie"],
  charles: ["charlie", "chuck"],
  christopher: ["chris"],
  christine: ["chris", "tina"],
  daniel: ["dan", "danny"],
  david: ["dave"],
  donald: ["don", "donnie"],
  eduardo: ["eddie", "lalo"],
  edward: ["ed", "eddie", "ted"],
  elizabeth: ["liz", "beth", "betsy"],
  francisco: ["frank", "paco", "pancho"],
  frederick: ["fred"],
  gerald: ["gerry", "jerry"],
  gregory: ["greg"],
  jacqueline: ["jackie", "jacky", "jacqui"],
  james: ["jim", "jimmy", "jamie"],
  jeffrey: ["jeff"],
  jennifer: ["jen", "jenny"],
  johnathon: ["john", "johnny", "jon"],
  jonathan: ["jon", "johnny"],
  john: ["johnny", "jack"],
  joseph: ["joe", "joey"],
  katherine: ["kate", "katie", "kathy"],
  kenneth: ["ken", "kenny"],
  lawrence: ["larry"],
  manuel: ["manny"],
  margaret: ["maggie", "peggy"],
  matthew: ["matt"],
  michael: ["mike", "mikey"],
  nicholas: ["nick"],
  patricia: ["pat", "patty", "trish"],
  patrick: ["pat"],
  raymond: ["ray"],
  richard: ["rick", "rich", "dick"],
  robert: ["bob", "bobby", "rob"],
  ronald: ["ron"],
  samuel: ["sam"],
  stephen: ["steve"],
  steven: ["steve"],
  susan: ["sue"],
  thomas: ["tom", "tommy"],
  timothy: ["tim"],
  william: ["bill", "will", "billy"],
};

/** Given name → the formal names it is or is short for. */
const FORMALS = new Map<string, Set<string>>();
for (const [formal, shorts] of Object.entries(SHORT_FORMS)) {
  for (const name of [formal, ...shorts]) {
    const set = FORMALS.get(name) ?? new Set<string>();
    set.add(formal);
    FORMALS.set(name, set);
  }
}

/** Same given name, or one is a short form of the other (Danny / Daniel), or both of one (Dan / Danny). */
function sameGiven(a: string, b: string): boolean {
  if (a === b) return true;
  const fa = FORMALS.get(a);
  const fb = FORMALS.get(b);
  return !!fa && !!fb && [...fa].some((f) => fb.has(f));
}

const toks = (s: string) =>
  strip(s)
    .replace(/\b(jr|sr|dr|ii|iii)\b/g, "")
    .split(" ")
    .filter((t) => t.length > 1);

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
  const [ga = "", ...ra] = toks(a);
  const [gb = "", ...rb] = toks(b);
  return sameGiven(ga, gb) && (sub(ra, rb) || sub(rb, ra)) && Math.min(ra.length, rb.length) >= 1;
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
  if (ta.length >= 2 && tb.length >= 2) {
    const [ga, gb] = [ta[0] ?? "", tb[0] ?? ""];
    const [sa, sb] = [ta.at(-1) ?? "", tb.at(-1) ?? ""];
    if (sa === sb) {
      // Same surname, and one given name starts the other (Mano / Manohar), is among the
      // other's names (David Liu / Long David Liu), or is a typo away (Frederick / Fredrick).
      if (ga.length >= 3 && gb.length >= 3 && (ga.startsWith(gb) || gb.startsWith(ga))) return true;
      if (sub(ta, tb) || sub(tb, ta)) return true;
      if (Math.min(ga.length, gb.length) >= 4 && editDistance(ga, gb) <= 2) return true;
    }
    // Same given name (or a short form of it) and a surname a typo away (Turnkey / Trunkey).
    if (sameGiven(ga, gb) && Math.min(sa.length, sb.length) >= 4 && editDistance(sa, sb) <= 2)
      return true;
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
  const like = names.filter((n) =>
    variants(n).some((v) => variants(choice).some((c) => resembles(c, v))),
  );
  return like.length === 1 ? { name: like[0] as string, sure: false } : undefined;
}
