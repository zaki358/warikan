# 割り勘アプリ Cloudflare 移行 + 月次モード追加 設計書

作成日: 2026-08-05
対象: `C:\Users\barub\Project\warikan`

---

## 1. 目的

ローカル専用の Flask 割り勘アプリを、Cloudflare 上で動く通常の Web アプリケーションに作り替える。あわせて次の3点を実現する。

1. **クラウド化** — D1 を永続化層とし、どの端末からでも同じデータを見られるようにする
2. **2人限定の公開** — 本人と配偶者の2アカウントだけがアクセスできる
3. **月次割り勘モードの追加** — 支払いの都度記録し、月末に集計して精算する

副次的に、現行実装が抱える既知の不具合（[docs/app-analysis.md](../../app-analysis.md) 7章）のうち、移行に伴って直せるものを直す。

## 2. 決定事項

| # | 項目 | 決定 | 根拠 |
|---|---|---|---|
| 1 | 認証 | Cloudflare Access（workers.dev 上）、許可メール2件 | 認証コードをほぼ書かずに済む。Zero Trust は50ユーザーまで無料 |
| 2 | バックエンド | Hono + TypeScript on Workers | Workers/D1 の第一級サポート。Python Workers は beta で Flask 資産も流用できず、利点がない |
| 3 | フロントエンド | React + Vite（SPA） | 要望どおり。同一 Worker が静的配信 |
| 4 | 配信構成 | 単一 Worker + Static Assets | CORS 不要、Access が守るホスト名が1つで済む |
| 5 | DB | D1 `warikan-db` + 素の prepared statement + 手書き SQL マイグレーション | 既存 `kakei-db` は別アプリのものなので分離する。ORM を挟まない理由は 4.4 節 |
| 6 | 月次の負担割合 | 50:50 固定 | 既存の均等割りロジックをそのまま使える。比率対応は将来拡張 |
| 7 | 月の区切り | カレンダー月（1日〜末日） | 「月末や月初めに計算」という要件に素直に対応 |
| 8 | 締めの扱い | 精算結果をスナップショット保存。支出の編集は常に可能 | 確定後に記録を直したくなることが実際にあるため |
| 9 | 記録項目 | 誰 / いくら / 品目名 / カテゴリ / 日付 | カテゴリはマスタテーブルで後から増やせる |
| 10 | 単発モード | シンプル・品目別とも任意人数を維持 | ログインできるのが2人であることと、割り勘の参加者数は別問題 |
| 11 | サブエージェント | `ui-inspector` と `web-debugger` の2つ | 関心が別。レイアウト所見と修正結果が混ざると判断できなくなる |
| 12 | 既存データ移行 | 不要 | `data/sessions.json` は空配列 |

### 確認済みの環境情報

| 項目 | 値 |
|---|---|
| Cloudflare アカウント | `aa72c68ee5b2decdafd78ebda2da8206`（t.yamazaki.1129@gmail.com） |
| workers.dev サブドメイン | `y-kakeibo` |
| ゾーン（管理ドメイン） | 0件 |
| 既存 Worker | `kakei-dashboard`（bindings: `ACCESS_ALLOWED_EMAILS` secret, `DB` d1） |
| 既存 D1 | `kakei-db`（テーブル0件） |
| ローカル環境 | Node v24.13.1 / npm 11.8.0 / wrangler 4.118.0 / git 2.53.0 |
| git | **未初期化** |
| Playwright MCP | 接続確認済み |

公開 URL は `https://warikan.y-kakeibo.workers.dev` を想定する。

## 3. アーキテクチャ

### 3.1 リポジトリ構成

npm workspaces のモノレポ。

```
warikan/
├─ apps/
│  ├─ web/                  React + Vite + TypeScript
│  │  ├─ src/
│  │  │  ├─ routes/         画面コンポーネント
│  │  │  ├─ features/       monthly/ events/ 単位で state と API 呼び出し
│  │  │  ├─ components/     共通 UI（Card, AmountInput, MemberPicker …）
│  │  │  └─ lib/            api クライアント、フォーマッタ
│  │  └─ vite.config.ts
│  └─ api/                  Hono on Workers
│     ├─ src/
│     │  ├─ index.ts        エントリ。ルータ組み立て
│     │  ├─ middleware/     access.ts（JWT検証）, error.ts
│     │  ├─ routes/         monthly.ts, events.ts, categories.ts, me.ts
│     │  ├─ db/             rows.ts（行の型）, queries/
│     │  └─ migrations/
│     └─ wrangler.jsonc
├─ packages/
│  └─ shared/               型定義 + 精算ロジック（純関数・DB非依存）
│     └─ src/
│        ├─ types.ts
│        └─ settlement.ts
├─ legacy/                  既存 Flask 一式（Phase 7 で削除）
├─ e2e/                     Playwright E2E
├─ docs/
├─ .mcp.json
└─ .claude/agents/
```

**設計上の要点**: 精算ロジックを `packages/shared` の純関数として切り出す。DB も HTTP も Workers ランタイムも知らないので、単体テストが速く、フロントでもプレビュー計算に使い回せる。ファイル単位でも 1ファイル 200〜400行を目安に、機能ごとに分割する。

### 3.2 認証フロー

```
ブラウザ
  │  https://warikan.y-kakeibo.workers.dev
  ▼
Cloudflare Access（ダッシュボードで Worker に対して有効化）
  │  許可メール2件のみ通過。Google ログイン or メールOTP
  │  Cf-Access-Jwt-Assertion ヘッダを付与
  ▼
Worker (Hono)
  │  ① JWKS (https://<team>.cloudflareaccess.com/cdn-cgi/access/certs) で JWT 署名を検証
  │  ② aud クレームが自分の Access アプリ AUD と一致するか確認
  │  ③ email クレームを取り出し ACCESS_ALLOWED_EMAILS と突合
  │  ④ users テーブルから userId を解決し、以降の処理に渡す
  ▼
ハンドラ
```

**ヘッダを検証せずに信じてはならない。** `Cf-Access-Authenticated-User-Email` は Access を経由しないリクエストでは詐称できるため、必ず `Cf-Access-Jwt-Assertion` の署名検証を通す。JWT ライブラリは Workers で動作する `jose` を使う。

検証に失敗した場合は 403 を返し、ユーザーには「アクセス権がありません」とだけ表示する（内部情報は返さない）。JWKS はメモリにキャッシュし、有効期限を持たせる。

`ACCESS_ALLOWED_EMAILS` は secret として設定し、カンマ区切りのメールアドレスを保持する。ソースにメールアドレスを書かない。

### 3.3 環境変数・シークレット

| 名前 | 種別 | 用途 |
|---|---|---|
| `ACCESS_ALLOWED_EMAILS` | secret | 許可メールのカンマ区切り |
| `ACCESS_TEAM_DOMAIN` | var | `<team>.cloudflareaccess.com` |
| `ACCESS_AUD` | secret | Access アプリケーションの Audience Tag |
| `DB` | d1 binding | `warikan-db` |

ローカル開発は `.dev.vars`（gitignore 対象）に置き、Access ヘッダが無い場合は開発用ユーザーとして扱う分岐を `wrangler dev` 時のみ有効にする。この分岐は本番ビルドで確実に無効になるよう、`ACCESS_AUD` が未設定のときだけ通る形にはせず、明示的な `DEV_BYPASS_EMAIL` var の存在で制御する。

## 4. データモデル（D1）

```sql
-- 登録ユーザー（2人）
CREATE TABLE users (
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);

-- カテゴリマスタ
CREATE TABLE categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1
);

-- 月次: 期間
CREATE TABLE monthly_periods (
  id            TEXT PRIMARY KEY,
  year          INTEGER NOT NULL,
  month         INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open',   -- 'open' | 'settled'
  settled_at    TEXT,
  snapshot_json TEXT,                            -- 確定時の集計 + 精算結果
  is_dirty      INTEGER NOT NULL DEFAULT 0,      -- 確定後に支出が変更されたか
  created_at    TEXT NOT NULL,
  UNIQUE (year, month)
);

-- 月次: 支出
CREATE TABLE monthly_expenses (
  id          TEXT PRIMARY KEY,
  period_id   TEXT NOT NULL REFERENCES monthly_periods(id) ON DELETE CASCADE,
  paid_by     TEXT NOT NULL REFERENCES users(id),
  amount      INTEGER NOT NULL,                  -- 円、整数
  item_name   TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id),
  spent_on    TEXT NOT NULL,                     -- YYYY-MM-DD
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_monthly_expenses_period ON monthly_expenses(period_id, spent_on);

-- 単発割り勘（シンプル / 品目別）
CREATE TABLE events (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  mode       TEXT NOT NULL,                      -- 'simple' | 'items'
  total      INTEGER NOT NULL,
  per_person INTEGER NOT NULL,                   -- floor(total / 人数)。表示用
  created_at TEXT NOT NULL
);

CREATE TABLE event_members (
  id       TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name     TEXT NOT NULL,
  paid     INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL
);

CREATE TABLE event_items (
  id                 TEXT PRIMARY KEY,
  event_id           TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  amount             INTEGER NOT NULL,
  paid_by_member_id  TEXT NOT NULL REFERENCES event_members(id) ON DELETE CASCADE,
  position           INTEGER NOT NULL
);

CREATE TABLE event_settlements (
  id             TEXT PRIMARY KEY,
  event_id       TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  from_member_id TEXT NOT NULL REFERENCES event_members(id) ON DELETE CASCADE,
  to_member_id   TEXT NOT NULL REFERENCES event_members(id) ON DELETE CASCADE,
  amount         INTEGER NOT NULL,
  is_paid        INTEGER NOT NULL DEFAULT 0,
  position       INTEGER NOT NULL
);
```

### 4.1 現行からの改善点

| 現行の問題 | 対応 |
|---|---|
| メンバーの識別子が名前文字列。同名が2人いると集計が破綻する | `event_members.id` で識別し、精算は ID 参照にする |
| `MAX_SESSIONS = 5` で履歴が切り捨てられる | 上限を撤廃。D1 に制約する理由がない |
| 金額が float 経由で丸められ、送金合計が理論値とずれる | 全額を整数円で扱う（4.3 節） |
| ウィザード状態が Cookie に載り 4KB 制限に当たりうる | クライアント state に持ち、確定時のみ POST |

### 4.2 `is_dirty` による整合性の担保

「確定するが編集は自由」を安全に実現する仕掛け。

- `POST /settle` — 集計して `snapshot_json` を書き、`status='settled'`, `is_dirty=0`, `settled_at=now` にする
- 確定済み期間に対する支出の追加・更新・削除 API は、**同一トランザクション内で** `is_dirty=1` を立てる
- フロントは `is_dirty=1` のとき結果画面に警告バナーを出す（「記録が変更されています。再計算してください」）と同時に、スナップショットの金額は書き換えない
- 「再計算」を押すと `POST /settle` が再実行され、スナップショットが上書きされる

これにより「表示されている精算額が、いまの記録と一致しているか」が常に一意に判定できる。

### 4.3 カテゴリの初期データ

`食費` / `日用品` / `外食` / `光熱費` / `交通費` / `娯楽` / `その他` をマイグレーションで投入する。`is_active` で非表示にでき、追加は行の挿入だけで済む。

### 4.4 ORM を挟まない理由と、書き込みの原子性

当初 Drizzle ORM を想定していたが、素の D1 prepared statement + 手書き SQL マイグレーションに変更した。

- テーブル7つ、クエリも単純で、ORM が解く問題（複雑な結合、動的クエリ組み立て）が存在しない
- drizzle-kit が出力するマイグレーションは `--> statement-breakpoint` というコメント行で文を区切る。テスト側で使う `readD1Migrations` はコメントを含む分割で[既知の不具合](https://github.com/cloudflare/workers-sdk/issues/7739)があり、統合テスト基盤と噛み合わないリスクがある
- 手書きの番号付き `.sql` は wrangler と `readD1Migrations` の両方がネイティブに扱える

型安全性は、行の型を `apps/api/src/db/rows.ts` に明示し、`.all<Row>()` / `.first<Row>()` の型引数で受けることと、境界での zod 検証で担保する。

**書き込みの原子性**: D1 は対話的トランザクション（`BEGIN` / `COMMIT`）に対応していない。複数文をまとめて原子的に実行する必要がある箇所（支出の変更と `is_dirty=1` の更新など）は `env.DB.batch([...])` を使う。`batch` は暗黙のトランザクションとして実行される。

### 4.5 ユーザー行の自動作成

`users` にメールアドレスをマイグレーションで埋め込むと、個人情報がリポジトリに入る。代わりに**初回アクセス時に自動作成**する。

認証ミドルウェアがメールで `users` を引き、行が無く、かつそのメールが `ACCESS_ALLOWED_EMAILS` に含まれていれば、`display_name` をメールのローカル部として行を作る。表示名は後から `PATCH /api/me` で変更できる。これによりメールアドレスがソースにもマイグレーションにも現れない。

## 5. 精算ロジック

`packages/shared/src/settlement.ts`。DB にも HTTP にも依存しない純関数。

### 5.1 インターフェース

```ts
type Participant = { id: string; name: string; paid: number };  // paid は整数円

type Transfer = { fromId: string; toId: string; amount: number };

type SettlementResult = {
  total: number;
  perPerson: number;                          // floor(total / n)。表示用
  shares: { id: string; share: number }[];    // 各人の負担額（端数込み）
  transfers: Transfer[];
};

function calculateSettlement(participants: Participant[]): SettlementResult;
```

### 5.2 アルゴリズム

現行の貪欲法（[app.py:28](../../../app.py)）を踏襲しつつ、全て整数演算に直す。

```
1. total = Σ paid_i                      （整数）
2. base = floor(total / n)
   remainder = total - base * n           （0 <= remainder < n）
3. 参加者を決定的な順序（name, id の昇順）で並べ、
   先頭 remainder 人の負担額を base + 1、残りを base とする
   → Σ share_i == total が厳密に成立する
4. balance_i = paid_i - share_i           → Σ balance_i == 0 が厳密に成立
5. balance > 0 を creditors（balance 降順, id 昇順）
   balance < 0 を debtors  （balance 昇順, id 昇順）にソート
6. 先頭同士をマッチングし amount = min(credit, -debt) を送金として確定。
   残高が 0 になった側のポインタを進める。両方尽きるまで繰り返す。
```

全ての値が整数なので、現行のような丸め誤差は原理的に発生しない。送金回数は最大で `n - 1` 回。

端数があるとき各人の負担額は `base` と `base + 1` の2種類になる。DB の `events.per_person` は `base`（= `floor(total / n)`）を表示用に保存するだけで、精算の正しさは `shares` と `transfers` が担保する。画面で「一人あたり」を出すときはこの `base` を使う。

参加者が 0 人の場合は `total = 0, shares = [], transfers = []` を返す（現行のゼロ除算を回避）。API 層は参加者 1〜20 人を要求して 0 人を弾くが、純関数側でも防御的に成立させておく。

### 5.3 テストする性質

- Σ transfers（各人の受取 − 支払）== balance_i が全員について成立する
- 送金後の全員の残高が 0
- 送金回数 ≤ n − 1
- 総額の保存: Σ share_i == Σ paid_i == total
- 端数ケース: total が n で割り切れない場合でも上記が全て成立する
- 全員の支払い額が同じ場合、transfers は空
- 参加者 0人 / 1人 のケース
- 現行 Flask 実装と同一入力で同一の送金組み合わせになること（端数ケースを除く）

## 6. API 設計

すべて `/api/*` 配下。認証ミドルウェアを全ルートに適用する。リクエストボディは zod（`@hono/zod-validator`）で境界検証し、失敗時は 400 とフィールド単位のエラーを返す。

レスポンス形式は共通のエンベロープを使う。

```jsonc
{ "ok": true,  "data": { /* ... */ } }
{ "ok": false, "error": { "code": "VALIDATION_ERROR", "message": "…", "fields": { … } } }
```

### 6.1 共通

| メソッド | パス | 内容 |
|---|---|---|
| GET | `/api/me` | `{ userId, email, displayName }`。行が無ければ 4.5 に従い作成 |
| PATCH | `/api/me` | 自分の `display_name` を変更（1〜20文字） |
| GET | `/api/categories` | 有効なカテゴリ一覧 |

### 6.2 月次モード

| メソッド | パス | 内容 |
|---|---|---|
| GET | `/api/monthly` | 月一覧（年月・合計・status・is_dirty） |
| GET | `/api/monthly/:ym` | 指定月の期間情報 + 支出一覧。期間が無ければ暗黙作成 |
| POST | `/api/monthly/:ym/expenses` | 支出を追加 |
| PATCH | `/api/monthly/expenses/:id` | 支出を更新 |
| DELETE | `/api/monthly/expenses/:id` | 支出を削除 |
| POST | `/api/monthly/:ym/settle` | 集計・精算してスナップショット保存（再計算も同じ） |
| GET | `/api/monthly/:ym/result` | スナップショット + `is_dirty` |
| PATCH | `/api/monthly/:ym/result/transfers/:index` | 送金の支払い済みフラグを更新 |

`:ym` は `YYYY-MM` 形式。範囲外の値は 400。

`GET /api/monthly/:ym` は該当期間が無ければ `status='open'` の行を作成して返す。`UNIQUE (year, month)` により並行リクエストでも重複しない。副作用はこの1行の作成のみで、繰り返し呼んでも結果は変わらない。

`settle` のレスポンスに含めるスナップショットの構造:

```jsonc
{
  "total": 84300,
  "perPerson": 42150,
  "byUser":     [{ "userId": "u1", "displayName": "…", "paid": 51000, "share": 42150 }],
  "byCategory": [{ "categoryId": 1, "name": "食費", "amount": 32000 }],
  "transfers":  [{ "fromId": "u2", "toId": "u1", "amount": 8850, "isPaid": false }],
  "settledAt": "2026-08-31T…"
}
```

支払い済みフラグはスナップショット内に持ち、`PATCH /api/monthly/:ym/result/transfers/:index` で更新する。

**再計算時の `isPaid` の扱い**: 再計算後の送金のうち、`fromId` / `toId` / `amount` の3つがすべて一致する送金が旧スナップショットに存在し、それが `isPaid: true` だった場合のみ `true` を引き継ぐ。金額が1円でも変わっていれば `false` に戻す。「すでに渡した」という事実は金額とセットでしか意味を持たないため。

### 6.3 単発モード

| メソッド | パス | 内容 |
|---|---|---|
| GET | `/api/events` | 履歴一覧 |
| POST | `/api/events` | 作成（タイトル・モード・members・items をまとめて受け取り、計算して保存） |
| GET | `/api/events/:id` | 詳細（members / items / settlements） |
| PATCH | `/api/events/:id/settlements/:sid` | 支払い済みフラグの更新 |
| DELETE | `/api/events/:id` | 削除 |

現行の3ステップウィザードはクライアント側の state で進行し、`POST /api/events` は最後に1回だけ呼ぶ。これにより「step1 を経ずに step2 に直アクセスできる」問題が構造的に消える。

### 6.4 バリデーション規則

- `amount` は 0 以上の整数。上限 10,000,000
- `item_name` は 1〜60 文字
- 参加者数は 1〜20
- `spent_on` は当該期間の年月に属する日付であること
- 文字列は全て trim し、空文字は必須項目ではエラー

## 7. 画面設計

現行のスマホ前提 UI（max-width 480px、カード型、角丸16px、アクセント `#5b8dee`、絵文字）を踏襲する。

```
/                     ホーム
                        - 今月の月次サマリカード（合計・自分の負担・未精算バッジ）
                        - 単発割り勘の履歴一覧
                        - 「＋ 新しい割り勘」「📅 今月の記録」への導線
/monthly              当月へリダイレクト
/monthly/:ym          月次: 記録画面
                        - 上部固定の記録追加フォーム
                        - 日付ごとにグルーピングした記録リスト（編集・削除）
                        - 月切替（← 前月 / 次月 →）
                        - 「計算する」ボタン
/monthly/:ym/result   月次: 精算結果
/events/new           単発 step1 相当（タイトル・人数・モード）
/events/new/input     単発 step2 相当（simple / items）
/events/:id           単発 step3 相当（精算結果・支払い済みチェック）
```

### 7.1 月次の記録画面

主用途は「レシートを見ながらの連続入力」。そのため次を満たす。

- フォームを画面上部に固定し、送信後もフォームに留まる（リストへスクロールで飛ばさない）
- 送信後、金額と品目名だけクリアし、**支払者・カテゴリ・日付は直前の値を保持**する（同じ買い物を続けて入れることが多いため）
- 日付の初期値は今日。月をまたぐ入力を避けるため、選択中の年月の範囲に制限する
- 支払者は2人のトグルボタン（プルダウンにしない。タップ1回で切り替わる）

### 7.2 月次の精算結果画面

2人なので送金は常に1行になる。単発の step3 をそのまま流用するのではなく、月次向けの構成にする。

```
今月の合計        ¥84,300
一人あたり        ¥42,150

┌ カテゴリ別内訳 ────────┐
│ 食費      ¥32,000  38% │
│ 日用品    ¥18,500  22% │
│ …                      │
└────────────────────────┘

┌ 支払い状況 ────────────┐
│ 自分   ¥51,000         │
│ 妻     ¥33,300         │
└────────────────────────┘

💸 妻 → 自分  ¥8,850    [ 支払い済み ]
```

`is_dirty` のときは最上部に警告バナーと「再計算する」ボタンを出す。

### 7.3 状態管理

- サーバー状態の取得・更新は TanStack Query。楽観更新はせず、更新後に該当クエリを invalidate する（金額の整合性を優先）
- ウィザードの途中状態のみ `useReducer` でローカルに持つ
- グローバルな状態管理ライブラリは導入しない

## 8. テスト戦略

カバレッジ目標 80%。

| 層 | ツール | 対象 |
|---|---|---|
| ユニット | Vitest | `packages/shared` の精算ロジック、フォーマッタ、バリデーションスキーマ |
| 統合 | Vitest 4.1+ + `@cloudflare/vitest-pool-workers` | Hono の各ルート。実 D1 に近い miniflare 環境でマイグレーションを流して検証 |
| E2E | Playwright | 主要3フロー |

E2E の3フロー:

1. 月次 — 支出を3件記録 → 計算 → 精算額が期待値と一致 → 支払い済みにする
2. 単発シンプル — 3人・金額入力 → 精算結果を確認
3. 単発品目別 — 品目を追加 → 支払者ごとに集計されることを確認

E2E は Access を経由できないため、`DEV_BYPASS_EMAIL` を設定したローカル `wrangler dev` に対して実行する。

統合テストで必ず押さえる異常系:

- Access ヘッダなし → 403
- 許可外メールの JWT → 403
- 署名が不正な JWT → 403
- 存在しない期間 / 支出 ID → 404
- 不正な金額・年月 → 400

## 9. Playwright MCP とサブエージェント

### 9.1 `.mcp.json`

プロジェクト直下に Playwright MCP を宣言し、このプロジェクトを開けば常に使える状態にする。

### 9.2 サブエージェント

`.claude/agents/` に2つ配置する。

| ファイル | 役割 | ツール |
|---|---|---|
| `ui-inspector.md` | スマホ幅(375px)・タブレット幅・PC幅でスクリーンショットを撮り、横スクロール発生・タップ領域44px未満・コントラスト比・見出し階層・フォーカス可視性を報告する。**コードは修正しない** | Read, Glob, Grep, Playwright MCP |
| `web-debugger.md` | コンソールエラーとネットワークリクエストを観察して不具合の再現手順と原因を特定し、修正まで行う | Read, Write, Edit, Bash, Glob, Grep, Playwright MCP |

分ける理由: レイアウトの所見と「直してしまった結果」が同じ報告に混ざると、何が問題だったのか判断できなくなる。`ui-inspector` は所見を出すことに専念させる。

両エージェントとも、対象 URL は起動中のローカル `wrangler dev`（既定 `http://localhost:8787`）を前提とし、URL は呼び出し時に受け取る。

## 10. 実装フェーズ

| # | 内容 | 完了条件 |
|---|---|---|
| 0 | `git init` + 現状コミット。`.mcp.json` とサブエージェント2つを配置。`.gitignore` 整備 | 現状が git 履歴に残っている |
| 1 | モノレポ土台（npm workspaces）+ `packages/shared` の精算ロジック + ユニットテスト | 5.3 の全性質がテストで通る。Flask 版と同一入力で同一結果 |
| 2 | D1 `warikan-db` 作成 + スキーマ・マイグレーション + Hono API + Access 検証ミドルウェア（コードのみ。Cloudflare 側の設定は Phase 5）+ 統合テスト | 8章の異常系を含む統合テストが通る |
| 3 | React フロント — 単発モード（既存機能のパリティ） | 現行と同じことが一通りできる。`ui-inspector` でスマホ幅を確認済み |
| 4 | 月次モード（記録画面・結果画面・`is_dirty` 警告） | 月次の一連の流れが動く |
| 5 | Cloudflare Access 設定 + `warikan.y-kakeibo.workers.dev` へデプロイ | 2人のアカウントでログインでき、第三者は 403 |
| 6 | Playwright E2E 3本 | ローカルで3本ともグリーン |
| 7 | `legacy/` 削除、README 更新、`CLAUDE.md` 更新 | 旧 Flask 実装への参照が残っていない |

各フェーズの終わりに `code-reviewer` を、Phase 2 と 5 の終わりには `security-reviewer` を通す。

## 11. 前提と留意点

### 前提

- Cloudflare Access の有効化（ダッシュボード操作）と、許可メール2件の登録は**利用者本人が行う**。手順は Phase 5 で提示する
- 既存 Worker `kakei-dashboard` には一切手を触れない。D1 も新規に作る
- 月次モードの利用者は `users` テーブルの2行に限る。3人目を増やす想定は現時点でしない

### 本設計で採用した判断（異論があれば差し替え可能）

- 月次の結果画面は単発の step3 を流用せず、7.2 の専用構成にする
- `legacy/` は Phase 7 まで残す。パリティ確認の参照元として使うため

### 将来の拡張余地（今回は作らない）

- 月次の負担割合を 50:50 以外にする（`monthly_periods` に比率列を足す）
- 品目ごとの参加者指定（現状は常に全員均等割り）
- 精算結果の共有（テキストコピー / URL 発行）
- カスタムドメインへの移行（wrangler 設定の変更のみで済む）

## 12. 参照

- 現行実装の解析: [docs/app-analysis.md](../../app-analysis.md)
- [workers.dev routing（Access の有効化について）](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
- [Cloudflare Plans](https://www.cloudflare.com/plans/)
