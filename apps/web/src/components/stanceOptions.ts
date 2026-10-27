import { STANCES, type Stance } from "@openslate/core";
import type { SelectOption } from "./ui/Select";

/** Stances as Compose names them: what the user publishes. */
export const STANCE_LABEL: Record<Stance, string> = {
  endorse: "Endorse",
  oppose: "Oppose",
  lean_for: "Lean for",
  lean_against: "Lean against",
  neutral: "Neutral",
  abstain: "Abstain",
};

export const STANCE_OPTIONS: SelectOption<Stance>[] = STANCES.map((stance) => ({
  id: stance,
  label: STANCE_LABEL[stance],
  className: `stance-opt-${stance}`,
}));
