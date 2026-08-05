export type Env = {
  DB: D1Database;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  ACCESS_ALLOWED_EMAILS: string;
  /** ローカル開発と統合テストでのみ設定する。本番では未設定。 */
  DEV_BYPASS_EMAIL?: string;
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
