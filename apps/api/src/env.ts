export type Env = {
  DB: D1Database;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  ACCESS_ALLOWED_EMAILS: string;
  /** ローカル開発と統合テストでのみ設定する。本番では未設定。 */
  DEV_BYPASS_EMAIL?: string;
  /**
   * 外部アプリ（家計簿ダッシュボード）からの Service Binding 経由の呼び出しを認証する共有トークン。
   * `wrangler secret put INTERNAL_API_TOKEN` で登録する。
   * 未設定なら /api/internal/* は 403 で閉じる（= 連携のキルスイッチ）。
   */
  INTERNAL_API_TOKEN?: string;
};

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
};

export type AppEnv = {
  Bindings: Env;
  Variables: { user: AuthUser };
};
