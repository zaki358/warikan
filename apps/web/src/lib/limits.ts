/**
 * API 側の zod スキーマ（apps/api/src/routes/events.ts, monthly.ts）と対になる値。
 * **片方だけ変えない。** 画面で弾くのは、フォームを埋めきってから
 * 汎用の 400 を返されるのを避けるため。最終的な検証は常にサーバ側で行う。
 */
export const MAX_AMOUNT = 10_000_000;
export const MAX_ITEMS = 200;
export const MAX_DISPLAY_NAME = 20;
