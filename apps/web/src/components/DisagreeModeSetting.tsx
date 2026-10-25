import type { DisagreeMode } from "../lib/collate";
import { useDisagreeMode } from "../lib/myVote";
import { Radio, RadioGroup } from "./ui/Radio";

/**
 * Where a source you disagree with counts in a two-way race. On the Settings
 * page and beside the "Disagree with" list on Sources; both read one store.
 */
export function DisagreeModeSetting() {
  const [mode, setMode] = useDisagreeMode();
  return (
    <div className="disagree-mode">
      <RadioGroup
        label="In a two-way race, a source you disagree with counts"
        value={mode}
        onChange={(next) => setMode(next as DisagreeMode)}
      >
        <Radio value="choice" variant="card">
          <span>
            <strong>Against what they picked</strong>
            <span className="hint ui-option-note">They back No, so No gets one against.</span>
          </span>
        </Radio>
        <Radio value="side" variant="card">
          <span>
            <strong>For the other side</strong>
            <span className="hint ui-option-note">They back No, so Yes gets one for.</span>
          </span>
        </Radio>
      </RadioGroup>
      <p className="hint">
        Two-way races are Yes/No measures and races with two names on the ballot. With more names,
        it always counts against what they picked: ruling one name out doesn't say who to back. Race
        pages always show what each source said, where they said it.
      </p>
    </div>
  );
}
