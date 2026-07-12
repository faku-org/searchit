import { fieldLabel } from "../lib/theme";

interface WeightSliderProps {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  min: number;
  max: number;
  step: number;
}

export function WeightSlider({ label, hint, value, onChange, min, max, step }: WeightSliderProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className={fieldLabel}>
        {label}: <span className="font-semibold text-mist-100">{Number(value).toFixed(2)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-navy-700 accent-blue-500"
      />
      <span className="text-[11px] text-mist-500">{hint}</span>
    </label>
  );
}
