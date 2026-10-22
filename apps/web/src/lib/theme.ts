import { createLocalStore, useLocalStore } from "./localStore";

/**
 * Light or dark. The stylesheet follows the OS by itself; picking Light or
 * Dark in Settings stamps `data-theme` on <html> to override it (styles.css,
 * top) and points the browser's `theme-color` at the same choice. Kept on
 * this device only. public/theme.js applies a stored choice before the first
 * paint; this takes over once the app runs (test/theme.test.ts checks they agree).
 */

export type ThemePreference = "system" | "light" | "dark";

/** Also read by public/theme.js. */
export const THEME_STORAGE_KEY = "openslate.theme.v1";

export function parseThemePreference(raw: unknown): ThemePreference | undefined {
  return raw === "system" || raw === "light" || raw === "dark" ? raw : undefined;
}

const themeStore = createLocalStore<ThemePreference>(
  THEME_STORAGE_KEY,
  "system",
  parseThemePreference,
);

export function useThemePreference(): [ThemePreference, (next: ThemePreference) => void] {
  return useLocalStore(themeStore);
}

/** Make the page show `preference`. The `theme-color` metas are index.html's. */
export function applyTheme(preference: ThemePreference, doc: Document = document): void {
  const root = doc.documentElement;
  if (preference === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", preference);
  for (const meta of doc.querySelectorAll('meta[name="theme-color"][data-scheme]')) {
    const scheme = meta.getAttribute("data-scheme");
    meta.setAttribute(
      "media",
      preference === "system"
        ? `(prefers-color-scheme: ${scheme})`
        : scheme === preference
          ? "all"
          : "not all",
    );
  }
}

/** Keep the page on the stored choice as it changes, here or in another tab. */
export function syncTheme(): void {
  applyTheme(themeStore.get());
  themeStore.subscribe(() => applyTheme(themeStore.get()));
}
