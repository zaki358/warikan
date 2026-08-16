import { useState } from "react";

import { Button } from "../../components/Button.js";
import { MAX_DISPLAY_NAME } from "../../lib/limits.js";
import type { UserSummary } from "../../lib/types.js";

type Props = {
  user: UserSummary;
  isSubmitting: boolean;
  onSubmit: (displayName: string) => void;
};

/**
 * 1人分の表示名編集行。
 *
 * 入力・ボタンのアクセシブル名に現在の表示名を入れる。2行とも
 * 「名前」「保存」だと読み上げでも自動テストでも行を区別できず、
 * 取り違えて相手の名前を上書きする不具合を検知できない
 * （CLAUDE.md「繰り返す行のボタン・ラベル」の方針）。
 */
export function UserNameRow({ user, isSubmitting, onSubmit }: Props) {
  const [value, setValue] = useState(user.displayName);

  const trimmed = value.trim();
  const canSubmit = trimmed.length > 0 && trimmed !== user.displayName && !isSubmitting;

  return (
    <form
      className="form-group"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit) return;
        onSubmit(trimmed);
      }}
    >
      <label htmlFor={`name-${user.userId}`}>{user.displayName} の表示名</label>
      <div className="row2">
        <input
          id={`name-${user.userId}`}
          type="text"
          value={value}
          maxLength={MAX_DISPLAY_NAME}
          onChange={(event) => setValue(event.target.value)}
        />
        <Button
          type="submit"
          size="sm"
          disabled={!canSubmit}
          aria-label={`${user.displayName} の表示名を保存`}
        >
          {isSubmitting ? "保存中…" : "保存"}
        </Button>
      </div>
    </form>
  );
}
