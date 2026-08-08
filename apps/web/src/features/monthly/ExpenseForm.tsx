import { useState } from "react";

import { AmountInput } from "../../components/AmountInput.js";
import { Button } from "../../components/Button.js";
import { Toggle } from "../../components/Toggle.js";
import { clampToMonth, daysInMonth, parseYm, todayIso } from "../../lib/ym.js";
import type { ExpenseInput } from "./queries.js";

type Props = {
  ym: string;
  users: { userId: string; displayName: string }[];
  categories: { id: number; name: string }[];
  defaultPaidBy: string;
  onSubmit: (input: ExpenseInput) => void;
  isSubmitting: boolean;
};

export function ExpenseForm({
  ym,
  users,
  categories,
  defaultPaidBy,
  onSubmit,
  isSubmitting,
}: Props) {
  // 連続入力のため、支払者・カテゴリ・日付は送信後も保持する（設計書 §7.1）。
  const [paidBy, setPaidBy] = useState(defaultPaidBy);
  const [categoryId, setCategoryId] = useState<number | null>(categories[0]?.id ?? null);
  const [spentOn, setSpentOn] = useState(() => clampToMonth(todayIso(), ym));

  // 毎回変わるものだけクリアする。
  const [amount, setAmount] = useState<number | "">("");
  const [itemName, setItemName] = useState("");

  const parsed = parseYm(ym);
  const min = `${ym}-01`;
  const max = parsed
    ? `${ym}-${String(daysInMonth(parsed.year, parsed.month)).padStart(2, "0")}`
    : `${ym}-28`;

  const canSubmit = amount !== "" && itemName.trim().length > 0 && !isSubmitting;

  const submit = () => {
    if (!canSubmit) return;

    onSubmit({
      paidBy,
      amount: amount as number,
      itemName: itemName.trim(),
      categoryId,
      spentOn,
    });

    setAmount("");
    setItemName("");
  };

  return (
    <form
      className="card"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="form-group">
        <span className="form-label">支払った人</span>
        <Toggle
          label="支払った人"
          options={users.map((user) => ({ value: user.userId, label: user.displayName }))}
          value={paidBy}
          onChange={setPaidBy}
        />
      </div>

      <div className="row2">
        <div className="form-group">
          <label htmlFor="amount">金額</label>
          <AmountInput id="amount" value={amount} onChange={setAmount} placeholder="1200" />
        </div>

        <div className="form-group">
          <label htmlFor="spent-on">日付</label>
          <input
            id="spent-on"
            type="date"
            value={spentOn}
            min={min}
            max={max}
            onChange={(event) => setSpentOn(clampToMonth(event.target.value, ym))}
          />
        </div>
      </div>

      <div className="form-group">
        <label htmlFor="item-name">品目</label>
        <input
          id="item-name"
          type="text"
          value={itemName}
          maxLength={60}
          placeholder="牛乳と卵"
          onChange={(event) => setItemName(event.target.value)}
        />
      </div>

      <div className="form-group">
        <label htmlFor="category">カテゴリ</label>
        <select
          id="category"
          value={categoryId ?? ""}
          onChange={(event) =>
            setCategoryId(event.target.value === "" ? null : Number(event.target.value))
          }
        >
          <option value="">未分類</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </div>

      <Button type="submit" disabled={!canSubmit}>
        {isSubmitting ? "記録中…" : "記録する"}
      </Button>
    </form>
  );
}
