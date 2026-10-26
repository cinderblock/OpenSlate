/**
 * A link from data (a slate, a guide, a catalog) as an `href`, or undefined
 * unless it's an http(s) URL. Slates and guides are schema-checked for this
 * (SPEC §3.13), but a catalog index isn't, and a `javascript:` link would run
 * in this origin, where the signing keys are.
 */
export function httpHref(uri: string | undefined): string | undefined {
  if (!uri || !/^https?:/i.test(uri)) return undefined;
  try {
    return new URL(uri).href;
  } catch {
    return undefined;
  }
}
