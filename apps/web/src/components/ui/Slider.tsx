import { Slider as AriaSlider, SliderFill, SliderThumb, SliderTrack } from "react-aria-components";
import { cx } from "./cx";

/** Draw a tick per step when there are at most this many. */
const MAX_TICKS = 60;

/**
 * Pick a number on a track. Arrow keys step, Page Up/Down jump, Home/End go
 * to the ends. With few enough steps, each one gets a tick mark.
 */
export function Slider({
  min,
  max,
  step = 1,
  value,
  onChange,
  className,
  "aria-label": ariaLabel,
}: {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
  className?: string;
  "aria-label": string;
}) {
  const steps = Math.round((max - min) / step);
  return (
    <AriaSlider
      className={cx("ui-slider", className)}
      minValue={min}
      maxValue={max}
      step={step}
      value={value}
      onChange={onChange}
      aria-label={ariaLabel}
    >
      <SliderTrack className="ui-slider-track">
        {steps > 0 && steps <= MAX_TICKS && (
          <span className="ui-slider-ticks" aria-hidden="true">
            {Array.from({ length: steps + 1 }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: ticks are positional
              <span key={i} style={{ left: `${(i / steps) * 100}%` }} />
            ))}
          </span>
        )}
        <SliderFill className="ui-slider-fill" />
        <SliderThumb className="ui-slider-thumb" />
      </SliderTrack>
    </AriaSlider>
  );
}
