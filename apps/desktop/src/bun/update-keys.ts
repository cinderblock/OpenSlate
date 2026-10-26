// The keys whose signature the app accepts on an update (see
// update-signature.ts). Every install trusts exactly the keys it was built
// with, so a change here reaches users only through an update signed by a key
// they already trust.
//
// - release: signs each release in GitHub Actions (the
//   OPENSLATE_UPDATE_SIGNING_KEY secret of the desktop-release environment,
//   available only to desktop-v* tags).
// - recovery: kept offline by the maintainer. Signs an update that replaces
//   the release key if it's ever lost or leaked.
//
// A test build (OPENSLATE_TEST_UPDATE_KEY at build time, electrobun.config.ts)
// trusts its test key instead, and nothing else.
declare const OPENSLATE_TEST_UPDATE_KEY: string | undefined;

export const TRUSTED_UPDATE_KEYS: readonly string[] =
  typeof OPENSLATE_TEST_UPDATE_KEY === "string" && OPENSLATE_TEST_UPDATE_KEY
    ? [OPENSLATE_TEST_UPDATE_KEY]
    : [
        "ed25519:BzKVTftwYGSDUf6CzqGmbBykFMrSN4tCcfFaTmrT6eEX", // release
        "ed25519:Hmpghduf2yLhjUsmsYgcBokTQKG9jLZ5SBmVUmyZZHyz", // recovery
      ];
