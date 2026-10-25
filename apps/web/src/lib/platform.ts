/**
 * Whether this build is the desktop app (apps/desktop builds the web app with
 * `vite build --mode desktop`). Its pages load from `views://`, not a website.
 */
export const IS_DESKTOP_APP: boolean = import.meta.env?.MODE === "desktop";

/** Where the desktop app's downloads are: the newest GitHub release. */
export const DESKTOP_DOWNLOADS_URL = "https://github.com/cinderblock/openslate/releases/latest";

/** Where the user's data lives, for "stays …" and "never leaves …". */
export const THIS_DEVICE: string = IS_DESKTOP_APP ? "this computer" : "this browser";
