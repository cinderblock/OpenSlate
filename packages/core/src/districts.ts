/**
 * District ids, the same wherever one is written: in a jurisdiction path
 * (`us/mn/hd-35a`), in a voter's area, in a state's boundary file, and in what
 * the address relay answers. Most districts are numbered; some states letter
 * theirs or name them, and every spelling has to come out the same way or a
 * voter's district won't match the race filed under it.
 */

/**
 * A district's id from what it's called: a number without leading zeros
 * (`07` → `7`), a lettered one in lower case (Minnesota's `35A` → `35a`, a
 * trustee area `B` → `b`), a named one as a slug (Massachusetts' `Third
 * Middlesex` → `third-middlesex`, Vermont's `Orleans-3` → `orleans-3`).
 */
export function districtId(name: string): string {
  if (/^\d+$/.test(name)) return String(Number(name));
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^0+(?=\d)/, "");
}

const byNumberThenName = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/**
 * District ids in the order a list should show them: 2 before 10, 35a before
 * 35b, named ones by name.
 */
export function compareDistrictIds(a: string, b: string): number {
  return byNumberThenName.compare(a, b);
}

/**
 * A legislative district's id from the Census Bureau's name for it (TIGER's
 * `BASENAME`, which its geocoder gives too). A state with one seat in the
 * House has one district, "Congressional District (at Large)": `1`. Land and
 * water in no district ("Congressional Districts not defined") has none.
 */
export function censusDistrictId(basename: string | undefined): string | undefined {
  const name = basename?.trim();
  if (!name || /not defined/i.test(name)) return undefined;
  if (/at large/i.test(name)) return "1";
  return districtId(name) || undefined;
}
