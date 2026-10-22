import { type ThemePreference, useThemePreference } from "../lib/theme";
import { Segmented } from "./ui/Segmented";

/** Settings panel for light or dark: the device's setting unless the user picks one. */
export function AppearancePanel() {
  const [theme, setTheme] = useThemePreference();

  return (
    <section className="panel">
      <h2>Appearance</h2>
      <div className="card">
        <Segmented<ThemePreference>
          label="Theme"
          value={theme}
          onChange={setTheme}
          options={[
            { id: "system", label: "System" },
            { id: "light", label: "Light" },
            { id: "dark", label: "Dark" },
          ]}
        />
        <p className="hint">
          System follows your device's light or dark setting. Your choice is kept in this browser
          only.
        </p>
      </div>
    </section>
  );
}
