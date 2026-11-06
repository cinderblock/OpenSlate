import type { DecodedSlate } from "./collate";
import type { KnownIdentity } from "./db";

/** Firsthand sources named by the user's nickname for the issuer, where they've set one. */
export function withNicknames(
  slates: DecodedSlate[],
  contacts: Array<Pick<KnownIdentity, "publicKey" | "displayName">>,
): DecodedSlate[] {
  const nicknames = new Map(
    contacts.filter((c) => c.displayName?.trim()).map((c) => [c.publicKey, c.displayName?.trim()]),
  );
  if (nicknames.size === 0) return slates;
  return slates.map((slate) => {
    const nickname = slate.source.secondhand ? undefined : nicknames.get(slate.source.signerKey);
    return nickname ? { ...slate, source: { ...slate.source, name: nickname } } : slate;
  });
}
