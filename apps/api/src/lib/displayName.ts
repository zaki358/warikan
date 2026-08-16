import { z } from "zod";

/**
 * 表示名の上限。API のバリデーションと apps/web/src/lib/limits.ts の
 * クライアント側チェックで値を一致させること。
 */
export const MAX_DISPLAY_NAME = 20;

export const displayNameSchema = z.object({
  displayName: z.string().trim().min(1).max(MAX_DISPLAY_NAME),
});

export const DISPLAY_NAME_ERROR = `表示名は1〜${MAX_DISPLAY_NAME}文字で入力してください`;
