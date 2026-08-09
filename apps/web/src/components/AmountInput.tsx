import { MAX_AMOUNT } from "../lib/limits.js";

type Props = {
  id: string;
  value: number | "";
  onChange: (value: number | "") => void;
  placeholder?: string;
  disabled?: boolean;
};

/**
 * 金額は整数（円）。小数と負値を入力段階で弾く。
 * 空欄は "" として保持し、0 と区別する（未入力のまま送信させないため）。
 */
export function AmountInput({ id, value, onChange, placeholder, disabled }: Props) {
  return (
    <input
      id={id}
      type="number"
      inputMode="numeric"
      min={0}
      max={MAX_AMOUNT}
      step={1}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event) => {
        const raw = event.target.value;
        if (raw === "") {
          onChange("");
          return;
        }

        const parsed = Number(raw);
        if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_AMOUNT) return;
        onChange(parsed);
      }}
    />
  );
}
