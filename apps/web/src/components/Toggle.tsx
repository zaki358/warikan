type Option = { value: string; label: string };

type Props = {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  label: string;
};

/**
 * 2〜3択の切り替え。プルダウンにするとタップ2回になるため、
 * 支払者の選択はこれを使う（設計書 §7.1）。
 */
export function Toggle({ options, value, onChange, label }: Props) {
  return (
    <div role="radiogroup" aria-label={label} className="toggle">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={option.value === value ? "toggle-option is-active" : "toggle-option"}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
