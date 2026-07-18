import "./RangeFilter.css";

interface RangeOption {
  value: string;
  label: string;
}

const OPTIONS: RangeOption[] = [
  { value: "10d", label: "10d" },
  { value: "15d", label: "15d" },
  { value: "30d", label: "30d" },
];

interface RangeFilterProps {
  value: string;
  onChange: (value: string) => void;
}

export default function RangeFilter({ value, onChange }: RangeFilterProps) {
  return (
    <div className="range-filter" role="group" aria-label="Trend range">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`range-filter__option${value === opt.value ? " range-filter__option--active" : ""}`}
          onClick={() => onChange(opt.value)}
          aria-pressed={value === opt.value}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
