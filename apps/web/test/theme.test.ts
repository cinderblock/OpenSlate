import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  applyTheme,
  parseThemePreference,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "../src/lib/theme";

// The theme lives in three places that must agree: the token blocks at the top
// of styles.css, index.html's critical CSS and theme-color metas, and the boot
// script public/theme.js next to applyTheme (lib/theme.ts).

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const styles = stripComments(read("../src/styles.css"));
const indexHtml = read("../index.html");
const bootScript = read("../public/theme.js");

function declarations(css: string, pattern: RegExp): Map<string, string> {
  const body = css.match(pattern)?.[1];
  if (body === undefined) throw new Error(`no block matches ${pattern}`);
  const map = new Map<string, string>();
  for (const declaration of body.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon < 0) continue;
    map.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim());
  }
  return map;
}

/** The light block, the OS-dark block and the picked-dark block of a stylesheet. */
function themeBlocks(css: string, root: string) {
  const r = root.replace(/[:[\]]/g, "\\$&");
  return {
    light: declarations(css, new RegExp(`(?:^|\\n)\\s*${r} \\{([^}]*)\\}`)),
    systemDark: declarations(
      css,
      new RegExp(
        `@media \\(prefers-color-scheme: dark\\) \\{\\s*${r}:not\\(\\[data-theme="light"\\]\\) \\{([^}]*)\\}`,
      ),
    ),
    pickedDark: declarations(css, new RegExp(`${r}\\[data-theme="dark"\\] \\{([^}]*)\\}`)),
  };
}

const tokens = themeBlocks(styles, ":root");
const critical = themeBlocks(
  stripComments(indexHtml.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? ""),
  "html",
);
const themes = { light: tokens.light, dark: tokens.pickedDark } as const;

/** Everything after the theme blocks. */
const rules = styles.slice(styles.indexOf("}", styles.indexOf(':root[data-theme="dark"]')) + 1);

/** Each filled background and the text colour (a token or a literal) that goes on it. */
const fillText: Record<string, string> = {
  "--accent": "--on-accent",
  "--ok": "--on-ok",
  "--bad": "--on-bad",
  "--warn": "--on-warn",
  "--fill-lean-for": "#fff",
  "--fill-lean-against": "#fff",
};

const customProperties = (block: Map<string, string>) =>
  [...block.keys()].filter((k) => k.startsWith("--")).sort();

describe("styles.css theme tokens", () => {
  test("dark from the OS and dark picked in Settings are the same", () => {
    expect([...tokens.systemDark]).toEqual([...tokens.pickedDark]);
  });

  test("every token has a light and a dark value", () => {
    expect(customProperties(tokens.pickedDark)).toEqual(customProperties(tokens.light));
    expect(tokens.light.get("color-scheme")).toBe("light");
    expect(tokens.pickedDark.get("color-scheme")).toBe("dark");
  });

  test("shadows and backdrops outside the theme blocks use the tokens", () => {
    // A dark-only rgb(0 0 0 / 0.5) is too heavy on the light page: use
    // var(--shadow) or var(--backdrop, <fallback>) (::backdrop needs the fallback).
    const raw = [...rules.matchAll(/(var\(--[\w-]+,\s*)?rgba?\([^)]*\)/g)]
      .filter((m) => !m[1])
      .map((m) => m[0]);
    expect(raw).toEqual([]);
  });

  const textTokens = [
    "--text",
    "--muted",
    "--accent",
    "--ok",
    "--bad",
    "--warn",
    "--lean-for",
    "--lean-against",
    "--jws-header",
    "--jws-payload",
    "--jws-signature",
  ];
  for (const [mode, block] of Object.entries(themes)) {
    test(`${mode} text colours clear 4.5:1 on the backgrounds`, () => {
      const failures: string[] = [];
      for (const text of textTokens) {
        for (const ground of ["--bg", "--surface", "--surface-2"]) {
          const ratio = contrast(token(block, text), token(block, ground));
          if (ratio < 4.5) failures.push(`${text} on ${ground}: ${ratio.toFixed(2)}`);
        }
      }
      expect(failures).toEqual([]);
    });

    test(`${mode} text on a filled colour clears 4.5:1`, () => {
      const failures: string[] = [];
      for (const [fill, text] of Object.entries(fillText)) {
        const ratio = contrast(colour(block, text), token(block, fill));
        if (ratio < 4.5) failures.push(`${text} on ${fill}: ${ratio.toFixed(2)}`);
      }
      expect(failures).toEqual([]);
    });
  }

  test("a filled colour's text is its partner", () => {
    // Every rule that fills with one of these sets that fill's text colour,
    // except the few fills that never hold text.
    const textless = new Set([
      ".triage-fill",
      ".bubble-endorse",
      ".ui-switch[data-selected] .ui-switch-track",
      ".ui-checkbox[data-selected] .ui-checkbox-box",
      ".ui-progress-fill",
    ]);
    const wrong: string[] = [];
    for (const [, selector = "", body = ""] of rules.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const fill = body.match(/(?:^|;)\s*background:\s*var\((--[\w-]+)\)\s*(?:;|$)/)?.[1];
      if (fill === undefined || !(fill in fillText)) continue;
      const name = selector.trim();
      if (textless.has(name)) continue;
      const text = body.match(/(?:^|;)\s*color:\s*([^;]+?)\s*(?:;|$)/)?.[1];
      const expected = fillText[fill]?.startsWith("--") ? `var(${fillText[fill]})` : fillText[fill];
      if (text?.toLowerCase() !== expected) wrong.push(`${name}: ${text ?? "no color"}`);
    }
    expect(wrong).toEqual([]);
  });
});

describe("index.html paints the right theme before the stylesheet loads", () => {
  test("critical CSS matches the tokens", () => {
    for (const [name, block] of Object.entries(critical)) {
      const source = tokens[name as keyof typeof tokens];
      expect({ name, ...Object.fromEntries(block) }).toEqual({
        name,
        "color-scheme": source.get("color-scheme"),
        background: source.get("--bg"),
        color: source.get("--text"),
      });
    }
  });

  test("the installed app's splash and title bar use each theme's background", () => {
    const manifestColors = read("../vite.config.ts").match(/const manifestColors[\s\S]*?\n\};/);
    const colors = [...(manifestColors?.[0] ?? "").matchAll(/(\w+): "(#[0-9a-f]+)"/g)];
    const light = token(themes.light, "--bg");
    const dark = token(themes.dark, "--bg");
    expect(colors.map((m) => `${m[1]} ${m[2]}`)).toEqual([
      `theme_color ${light}`,
      `background_color ${light}`,
      `theme_color ${dark}`,
      `background_color ${dark}`,
    ]);
  });

  test("theme-color metas follow the OS with each theme's background", () => {
    expect(themeColorMetas()).toEqual([
      {
        content: token(themes.light, "--bg"),
        media: "(prefers-color-scheme: light)",
        "data-scheme": "light",
      },
      {
        content: token(themes.dark, "--bg"),
        media: "(prefers-color-scheme: dark)",
        "data-scheme": "dark",
      },
    ]);
  });

  test("the boot script loads before the critical CSS, as a classic script", () => {
    const script = indexHtml.indexOf('<script src="/theme.js"></script>');
    expect(script).toBeGreaterThan(-1);
    expect(script).toBeLessThan(indexHtml.indexOf("<style>"));
  });
});

describe("public/theme.js and applyTheme agree", () => {
  const stored: Array<string | null> = [
    null,
    '"system"',
    '"light"',
    '"dark"',
    '"sepia"',
    "not json",
  ];
  for (const raw of stored) {
    test(`stored ${raw}`, () => {
      const booted = fakeDocument();
      runBootScript(booted, raw);
      const applied = fakeDocument();
      applyTheme(storedPreference(raw), applied as unknown as Document);
      expect(booted.state()).toEqual(applied.state());
    });
  }

  test("System after a pick puts the page back as index.html had it", () => {
    const doc = fakeDocument();
    const initial = doc.state();
    applyTheme("dark", doc as unknown as Document);
    expect(doc.state()).not.toEqual(initial);
    applyTheme("system", doc as unknown as Document);
    expect(doc.state()).toEqual(initial);
  });

  test("a pick points theme-color at that theme only", () => {
    const doc = fakeDocument();
    applyTheme("light", doc as unknown as Document);
    expect(doc.state()).toEqual({
      theme: "light",
      media: { light: "all", dark: "not all" },
    });
  });
});

function token(block: Map<string, string>, name: string): string {
  const value = block.get(name);
  if (value === undefined) throw new Error(`missing ${name}`);
  return value;
}

/** A token's value, or a literal #rgb / #rrggbb colour as #rrggbb. */
function colour(block: Map<string, string>, value: string): string {
  if (value.startsWith("--")) return token(block, value);
  return value.length === 4 ? `#${[...value.slice(1)].map((c) => c + c).join("")}` : value;
}

function themeColorMetas(): Array<Record<string, string>> {
  return [...indexHtml.matchAll(/<meta name="theme-color"([^>]*)\/>/g)].map((m) =>
    Object.fromEntries([...(m[1] ?? "").matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]])),
  );
}

class FakeElement {
  private attributes: Map<string, string>;
  constructor(attributes: Record<string, string> = {}) {
    this.attributes = new Map(Object.entries(attributes));
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value));
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
}

/** Just enough of index.html's <head> for the two theme appliers. */
function fakeDocument() {
  const documentElement = new FakeElement();
  const metas = themeColorMetas().map((attributes) => new FakeElement(attributes));
  return {
    documentElement,
    querySelectorAll: (selector: string) => {
      if (selector !== 'meta[name="theme-color"][data-scheme]') {
        throw new Error(`unexpected selector ${selector}`);
      }
      return metas;
    },
    state: () => ({
      theme: documentElement.getAttribute("data-theme"),
      media: Object.fromEntries(
        metas.map((m) => [m.getAttribute("data-scheme"), m.getAttribute("media")]),
      ),
    }),
  };
}

function runBootScript(doc: ReturnType<typeof fakeDocument>, raw: string | null): void {
  const localStorage = { getItem: (key: string) => (key === THEME_STORAGE_KEY ? raw : null) };
  new Function("document", "localStorage", bootScript)(doc, localStorage);
}

function storedPreference(raw: string | null): ThemePreference {
  try {
    return parseThemePreference(raw === null ? null : JSON.parse(raw)) ?? "system";
  } catch {
    return "system";
  }
}

/** WCAG 2 contrast ratio of two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = Number.parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}
