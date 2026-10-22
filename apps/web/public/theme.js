// Applies the Settings → Appearance choice before anything paints: index.html
// loads this as a plain blocking script at the top of <head> (CSP allows no
// inline script). Does what applyTheme in src/lib/theme.ts does, which takes
// over once the app runs; test/theme.test.ts checks the two agree. No choice,
// or "system": nothing to do, the CSS follows the OS by itself.
(() => {
  let theme;
  try {
    theme = JSON.parse(localStorage.getItem("openslate.theme.v1"));
  } catch {
    return;
  }
  if (theme !== "light" && theme !== "dark") return;
  document.documentElement.setAttribute("data-theme", theme);
  for (const meta of document.querySelectorAll('meta[name="theme-color"][data-scheme]')) {
    meta.setAttribute("media", meta.getAttribute("data-scheme") === theme ? "all" : "not all");
  }
})();
