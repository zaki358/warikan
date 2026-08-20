import { z } from "zod";

/**
 * 表示名の上限。API のバリデーションと apps/web/src/lib/limits.ts の
 * クライアント側チェックで値を一致させること。
 */
export const MAX_DISPLAY_NAME = 20;

/**
 * 制御文字（Cc）と書式文字（Cf）。ゼロ幅スペースや双方向制御文字（RLO など）が
 * ここに入る。`trim()` は空白しか落とさないので、これらは素通りしてしまう。
 *
 * 貼り付けたテキストに紛れ込むと、名前が壊れて見えたり読み上げが狂ったりする。
 * 表示名に入れて嬉しい文字は1つも無いので、保存する前に落とす。
 */
const INVISIBLE = /[\p{Cc}\p{Cf}]/gu;

export const displayNameSchema = z.object({
  // 落としてから長さを見る。見えない文字だけの入力は空になり min(1) で弾かれる。
  displayName: z
    .string()
    .transform((value) => value.replace(INVISIBLE, "").trim())
    .pipe(z.string().min(1).max(MAX_DISPLAY_NAME)),
});

export const DISPLAY_NAME_ERROR = `表示名は1〜${MAX_DISPLAY_NAME}文字で入力してください`;

/** エラー応答の `fields` に載せる短い説明。上限を変えたら自動で追従する。 */
export const DISPLAY_NAME_FIELD_ERROR = `1〜${MAX_DISPLAY_NAME}文字`;
