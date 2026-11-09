# 割り勘 (warikan) — 技術構成ドキュメント

> [tech-stack.html](tech-stack.html) の Markdown 版（GitHub 上で読むためのもの）。

夫婦2人で使う割り勘アプリ。Cloudflare Workers 上で API と SPA を1つの Worker から配信する、npm workspaces のモノレポ。

`TypeScript 7` · `Node.js 24 / npm 11` · `Hono 4` · `React 19` · `Vite 8` · `Cloudflare Workers + D1` · `SQL (SQLite方言)`

姉妹編:
- [全体構成図](architecture-overview.md) — 各プログラムの役割とつながりを示した俯瞰図。
- [プログラムの動作順番](program-flow.md) — 起動から画面表示、入力から精算までを順を追って説明した文書。

## 目次

1. [使用している言語](#lang)
2. [フォルダ構成](#structure)
3. [プログラムの流れ](#flow)
4. [API エンドポイント](#endpoints)
5. [データベース（Cloudflare D1）](#database)
6. [ライブラリとフレームワーク](#libraries)
7. [インストールされているツール・実行環境](#tools)
8. [設計上の制約](#constraints)

<a id="lang"></a>

## 1. 使用している言語

| 言語 | 使用箇所 | 備考 |
|---|---|---|
| **TypeScript** | アプリケーションコードのすべて（99ファイル） | `strict` + `noUncheckedIndexedAccess` + `verbatimModuleSyntax`。ES2022 / ESM。ビルドは各ツールが行い `tsc` は型検査専用（`noEmit`） |
| **TSX (JSX)** | `apps/web` の React コンポーネント | React 19 の自動 JSX ランタイム |
| **SQL** | `apps/api/migrations/*.sql` と D1 クエリ | SQLite 方言。金額カラムはすべて `INTEGER`（円） |
| **CSS** | `apps/web/src/styles.css` | 素の CSS 1枚。CSS フレームワークは不使用 |
| **HTML** | `apps/web/index.html` | Vite のエントリ。SPA のマウント先 `#root` のみ |
| **JSONC** | `apps/api/wrangler.jsonc` | コメント付き JSON。Worker の設定 |

> [!NOTE]
> **Python (Flask) は現在使っていない**
> 元は Flask 実装だったが移行完了に伴い削除済み。`docs/app-analysis.md` に旧実装の解析記録だけが残る。

<a id="structure"></a>

## 2. フォルダ構成

npm workspaces で 4 パッケージ。依存の向きは `shared → api / web` の一方向のみで、`shared` は DB にも HTTP にも依存しない。
末尾に `[gitignore]` と付けた項目は `.gitignore` 対象（生成物・ローカル設定）。

### 2-1. ルート

```text
warikan/
├── apps/                     アプリケーション本体（workspaces）
│   ├── api/                  @warikan/api   Hono + Cloudflare Workers + D1
│   └── web/                  @warikan/web   React + Vite の SPA
├── packages/
│   └── shared/               @warikan/shared 精算ロジック（純関数）と共通型
├── e2e/                      @warikan/e2e   Playwright の E2E テスト
├── docs/                     設計書・実装計画・解析記録・本ドキュメント
├── .claude/                  プロジェクト固有のサブエージェント定義
├── .mcp.json                Playwright MCP サーバーの宣言
├── CLAUDE.md                Claude Code 向けの開発ガイド（規約の一次情報）
├── README.md
├── package.json             workspaces 定義と横断スクリプト（test / typecheck）
├── package-lock.json        全ワークスペースの依存を1ファイルで固定
├── tsconfig.base.json       全パッケージが継承する共通 TS 設定
├── .gitignore
├── node_modules/            npm workspaces のホイスト先（ルートに集約） [gitignore]
├── .wrangler/               ローカル D1 の実体と Worker のキャッシュ [gitignore]
├── .playwright-mcp/         サブエージェントが吐くスナップショット・画像 [gitignore]
└── .superpowers/            ワークフロー支援用の作業ディレクトリ
```

> [!NOTE]
> **ワークスペースは4つだが、パッケージのルートは3階層に散っている**
> `package.json` の `workspaces` は `["packages/*", "apps/*", "e2e"]`。`e2e` だけがルート直下にあるのは、アプリでもライブラリでもなく「起動済みのアプリを外から叩くもの」だから。

### 2-2. 各パッケージの責務

#### @warikan/shared — `packages/shared/src/`

DB にも HTTP にも依存しない純粋な計算層。API と Web の両方から import される。

- `settlement.ts` — 精算アルゴリズム本体。`computeShares()` が負担額と端数配分、`calculateSettlement()` が貪欲マッチングで送金リストを作る
- `compareStr()` — ロケール非依存のコードユニット比較。`localeCompare` は環境の ICU 差で端数配分先がぶれるため不使用
- `types.ts` — `Participant` / `Share` / `Transfer` / `SettlementResult`
- `index.ts` — 公開 API の再エクスポート

#### @warikan/api — `apps/api/src/`

Hono のルータ。Cloudflare Workers 上で動き、`/api/*` を処理して残りは静的 SPA に委ねる。

- `index.ts` — エントリ。ミドルウェア登録とルータのマウント
- `middleware/auth.ts` — Cloudflare Access の JWT を JWKS で検証
- `middleware/errors.ts` — 例外を共通エラーエンベロープへ変換
- `routes/` — `me` / `users` / `categories` / `monthly` / `events`
- `db/` — D1 アクセス層（`users` / `events` / `monthly` / `categories` / `rows`）
- `services/settle.ts` — 月次の精算スナップショット生成。shared の計算結果に表示名やカテゴリ内訳を合成
- `lib/` — `response`（エンベロープ）/ `ids` / `ym` / `displayName`
- `env.ts` — Bindings と `c.var.user` の型定義
- `migrations/` — D1 のスキーマとカテゴリ初期データ

#### @warikan/web — `apps/web/src/`

React 19 の SPA。ビルド成果物 `dist/` を Worker の assets が配信する。

- `main.tsx` — `QueryClientProvider` と `BrowserRouter` を張るブートストラップ
- `App.tsx` — ルート定義。イベント作成ウィザードの状態を `useReducer` で保持（旧実装の Cookie 依存を排除）
- `routes/` — `Home` / `MonthlyRecord` / `MonthlyResult` / `EventNew` / `EventInput` / `EventDetail` / `Settings`
- `features/` — 機能単位の UI と TanStack Query の `queries.ts`（events / monthly / users）
- `components/` — `AmountInput` / `Button` / `Card` / `ErrorBanner` / `Toggle`
- `lib/` — `api`（fetch ラッパ）/ `queryKeys`（キーの唯一の出所）/ `format` / `ym` / `limits` / `types`

#### @warikan/e2e — `e2e/`

Playwright のシナリオテスト。起動済みの `wrangler dev`（ポート 8788）に対して実行する。

- `event-simple.spec.ts` / `event-items.spec.ts` / `monthly.spec.ts`
- `helpers/` — DB リセット、イベント生成、ロケータ
- `global-setup.ts` — 実行前の初期化

### 2-3. packages/shared — 精算ロジック

```text
packages/shared/
├── package.json             exports は "." → ./src/index.ts のみ（ビルド無しで直接参照）
├── tsconfig.json
├── vitest.config.ts
└── src/
    ├── index.ts             公開 API の再エクスポート（この層の唯一の入口）
    ├── settlement.ts        computeShares / calculateSettlement / compareStr
    ├── types.ts             Participant / Share / Transfer / SharesResult / SettlementResult
    ├── settlement.test.ts             代表ケースの単体テスト
    ├── settlement.properties.test.ts  fast-check による不変条件テスト
    ├── settlement.parity.test.ts      旧 Flask 実装との出力一致テスト
    ├── smoke.test.ts
    └── __fixtures__/
        └── flask-parity.json          旧実装の入出力を固定したフィクスチャ
```

ビルド成果物を持たず、`src/index.ts` を api と web が直接 import する。そのため `D1Database` や `Request` といったランタイム固有の型を一切参照できず、純関数であることが構造的に保証される。

### 2-4. apps/api — Hono の API

```text
apps/api/
├── package.json
├── tsconfig.json
├── vitest.config.ts         @cloudflare/vitest-pool-workers を指定（workerd 上で実行）
├── wrangler.jsonc           Worker 名・D1 バインディング・assets の振り分け
├── .dev.vars.example        ローカル用の環境変数のひな形（実体 .dev.vars は gitignore）
├── worker-configuration.d.ts wrangler が生成する型定義 [gitignore]
├── migrations/              wrangler d1 migrations apply が順に適用
│   ├── 0001_init.sql        全8テーブルとインデックス
│   └── 0002_categories.sql  カテゴリ初期データ7件
├── src/
│   ├── index.ts             エントリ。onError → /api/health → accessAuth → 各ルータ → notFound
│   ├── env.ts               Bindings（DB, ACCESS_*）と c.var.user の型
│   ├── middleware/          全リクエスト共通の前後処理
│   │   ├── auth.ts          Cf-Access-Jwt-Assertion を JWKS 検証し users 行を解決
│   │   └── errors.ts        例外を { ok:false, error } へ変換
│   ├── routes/              HTTP の入出力とバリデーション（zod）だけを持つ層
│   │   ├── me.ts            GET/PATCH /api/me
│   │   ├── users.ts         GET /api/users, PATCH /api/users/:id
│   │   ├── categories.ts    GET /api/categories
│   │   ├── monthly.ts       月次の期間・支出・締め・結果（8本）
│   │   └── events.ts        単発イベントの CRUD と送金フラグ（5本）
│   ├── db/                  D1 への SQL を閉じ込める層。routes は SQL を書かない
│   │   ├── rows.ts          テーブル行の型（*Row）。DB スキーマとの唯一の接点
│   │   ├── users.ts         findUserByEmail / createUser / listUsers / 表示名更新
│   │   ├── categories.ts    listActiveCategories
│   │   ├── monthly.ts       期間と支出の読み書き。原子性が要る箇所は DB.batch()
│   │   └── events.ts        イベント・メンバー・品目・送金の読み書き
│   ├── services/            db と shared をまたぐ業務ロジック
│   │   └── settle.ts        buildSnapshot(): 精算結果に表示名とカテゴリ内訳を合成
│   └── lib/                 依存を持たない小物
│       ├── response.ts      ok() / fail() — 共通エンベロープの生成
│       ├── ids.ts           ID 採番と nowIso()
│       ├── ym.ts            "2026-08" ↔ { year, month } の相互変換と検証
│       └── displayName.ts   表示名の正規化・バリデーション
└── test/                    workerd 上で実際の D1 を使う統合テスト
    ├── apply-migrations.ts  テスト前に migrations/ を流し込む
    ├── helpers.ts           認証済みリクエストの生成など
    ├── env.d.ts             テスト用 Bindings の型
    ├── auth.test.ts / errors.test.ts / health.test.ts
    ├── me.test.ts / users.test.ts / categories.test.ts / events.test.ts
    └── monthly-period.test.ts / monthly-expense.test.ts / monthly-settle.test.ts
```

層は **routes → services → db** の一方向。`routes` は SQL を書かず、`db` は HTTP を知らない。`services` はこの2つと `shared` をまたぐ場合にだけ置く（現状 `settle.ts` の1本）。

### 2-5. apps/web — React の SPA

```text
apps/web/
├── index.html               Vite のエントリ。#root と main.tsx の読み込みのみ
├── package.json
├── tsconfig.json
├── vite.config.ts           outDir=dist / dev の /api を localhost:8787 へプロキシ
├── vitest.config.ts         jsdom 環境、test-setup.ts を読み込む
├── dist/                    ビルド成果物。Worker の assets がこれを配信する [gitignore]
└── src/
    ├── main.tsx             QueryClientProvider + BrowserRouter + StrictMode
    ├── App.tsx              ルート定義とウィザード状態（useReducer）
    ├── styles.css           全画面のスタイル（.container の max-width: 480px など）
    ├── test-setup.ts        @testing-library/jest-dom の登録
    ├── smoke.test.tsx
    ├── routes/              1画面 = 1ファイル。隣に .test.tsx を置く
    │   ├── Home.tsx                 トップ。月次への導線とイベント履歴
    │   ├── MonthlyRecord.tsx        月次の支出記録（/monthly/:ym）
    │   ├── MonthlyResult.tsx        月次の精算結果（/monthly/:ym/result）
    │   ├── EventNew.tsx             イベント作成ウィザード 1画面目（モード選択）
    │   ├── EventInput.tsx           同 2画面目（金額入力）
    │   ├── EventDetail.tsx          イベント詳細と送金チェック
    │   └── Settings.tsx             表示名の編集
    ├── features/            機能ドメイン単位。UI と TanStack Query をセットで置く
    │   ├── events/
    │   │   ├── SimpleInput.tsx      シンプルモードの入力欄
    │   │   ├── ItemsInput.tsx       品目別モードの入力欄
    │   │   ├── wizardReducer.ts     ウィザードの状態遷移（純関数・テスト対象）
    │   │   └── queries.ts           useQuery / useMutation の定義
    │   ├── monthly/
    │   │   ├── ExpenseForm.tsx      支出の追加・編集フォーム
    │   │   ├── ExpenseList.tsx      支出一覧
    │   │   ├── ResultView.tsx       精算結果の表示
    │   │   └── queries.ts
    │   └── users/
    │       ├── UserNameRow.tsx      表示名1件分の編集行
    │       └── queries.ts
    ├── components/          ドメインを持たない汎用パーツ
    │   ├── AmountInput.tsx  金額入力（整数のみ受け付ける）
    │   ├── Button.tsx / Card.tsx / Toggle.tsx / ErrorBanner.tsx
    └── lib/
        ├── api.ts           fetch ラッパ。エンベロープを剥がしエラーを例外化
        ├── queryKeys.ts     クエリキーの唯一の出所（invalidate 漏れ防止）
        ├── types.ts         API レスポンスの型
        ├── format.ts        金額・日付の表示整形
        ├── ym.ts            todayYm() など年月ユーティリティ
        └── limits.ts        参加者数の上限などの定数
```

`routes/`（画面）→ `features/`（機能）→ `components/`（汎用）→ `lib/`（無依存）の順に依存が細くなる。テストは対象と同じディレクトリに `*.test.tsx` として置き、離れた `__tests__/` は作らない。

### 2-6. e2e — Playwright

```text
e2e/
├── package.json
├── tsconfig.json
├── playwright.config.ts     webServer は使わない（後述の理由）
├── global-setup.ts          実行前の初期化
├── event-simple.spec.ts     シンプルモードの一連の操作
├── event-items.spec.ts      品目別モードの一連の操作
├── monthly.spec.ts          月次の記録から締めまで
└── helpers/
    ├── db.ts                テスト間で D1 の状態をリセット
    ├── events.ts            イベントを事前に作るユーティリティ
    └── locators.ts          共通のロケータ定義
```

> [!NOTE]
> **webServer を使わない理由**
> Windows では wrangler を落としても子の `workerd` が残り、Playwright がプロセスツリーを親から落とす保証がない。そのため**先に手で起動した `wrangler dev`（ポート 8788）に対して**実行する。8787 は別プロジェクトが常駐しているため避けている。

### 2-7. docs / .claude

```text
docs/
├── app-analysis.md          移行前の Flask 実装の解析記録（既知の問題と対処）
├── tech-stack.html          本ドキュメント（HTML 版）
├── tech-stack.md            本ドキュメント（Markdown 版）
├── tech-stack.css           HTML 版ドキュメントのスタイル
├── architecture-overview.html / .md   全体構成図
├── program-flow.html / .md            プログラムの動作順番
└── superpowers/
    ├── specs/
    │   └── 2026-08-05-warikan-cloudflare-design.md   設計書
    └── plans/
        ├── 2026-08-05-warikan-phase1-foundation-api.md   基盤と API
        ├── 2026-08-07-warikan-phase2-react-frontend.md   フロントエンド
        └── 2026-08-09-warikan-phase3-deploy-e2e.md       デプロイと E2E

.claude/
├── agents/
│   ├── ui-inspector.md      スマホ/タブレット/PC 幅でレイアウトを検査。コードは修正しない
│   └── web-debugger.md      ブラウザで再現する不具合を追跡し原因を特定して修正する
└── settings.local.json      ローカル専用の設定 [gitignore]
```

### 2-8. 生成物と gitignore

| パス | 正体 | 消してよいか |
|---|---|---|
| `node_modules/` | 依存パッケージ（ルートにホイスト） | 可。`npm install` で復元 |
| `apps/web/dist/` | Vite のビルド成果物。Worker が配信する実体 | 可。`npm run build -w @warikan/web` で復元 |
| `.wrangler/` | ローカル D1 の実体と Worker のキャッシュ | 可。ただしローカルのデータは消える（マイグレーション再適用が必要） |
| `apps/api/worker-configuration.d.ts` | wrangler が生成する型定義 | 可。ただし無いと `typecheck` が落ちる |
| `apps/api/.dev.vars` | ローカルの環境変数（秘密情報） | **不可**。`.dev.vars.example` から手で作る |
| `.playwright-mcp/` | サブエージェントのスクショ・スナップショット | 可 |
| `coverage/` / `playwright-report/` / `test-results/` | テストの成果物 | 可 |

> [!TIP]
> **新しい clone / worktree で最初にやること**
> `npm install` → `cp apps/api/.dev.vars.example apps/api/.dev.vars` → `npm run migrate:local -w @warikan/api`。この3つのどれかを飛ばすと、`typecheck` や `wrangler dev` が一見無関係なエラーで落ちる。

<a id="flow"></a>

## 3. プログラムの流れ

ここは経路の要約。**どのファイルがどの順番で動くのか**を1手ずつ追ったものは [プログラムの動作順番](program-flow.md) にある。

### 3-1. リクエストの経路

```text
ブラウザ
  │
  ├─ Cloudflare Access（許可メール2件のみ通過、JWT を付与）
  │
  ▼
Cloudflare Worker（1つ）
  ├─ /api/*  → run_worker_first で Hono が処理
  │            accessAuth → ルータ → db/ → D1（SQLite）
  │            レスポンスは { ok:true, data } / { ok:false, error }
  │
  └─ それ以外 → Asset Worker が apps/web/dist の SPA を返す
                （not_found_handling: single-page-application）
```

> [!WARNING]
> **run_worker_first は落とせない**
> この指定を外すと `/api/health` まで SPA の HTML を返して API が全滅する。しかも vitest は Asset Worker を再現しないため、壊してもテストは全部通ってしまう。assets の振り分けを変えたら `wrangler dev` で手検証すること。

### 3-2. 精算アルゴリズム（packages/shared）

```text
1. total     = Σ 各人の立て替え額
2. base      = floor(total / 人数)          ← 全員の基本負担額
3. remainder = total - base × 人数           ← 1円未満に割れない端数
4. 端数は名前（同名なら id）のコードユニット昇順で、先頭から1円ずつ配る
5. balance   = 立て替え額 - 負担額           ← 正が債権者、負が債務者
6. 債権者と債務者を金額の大きい順に並べ、貪欲に突き合わせて送金を作る
   → 送金回数は最大で「人数 − 1」回
```

全工程が整数（円）演算のため、送金額の合計と各人の過不足は厳密に一致する。浮動小数点は金額計算に一切使わない。

### 3-3. 割り勘の3モード

| モード | 参加者 | 入力内容 | 主な実装 |
|---|---|---|---|
| シンプル | 任意 1〜20人 | 参加者ごとに立て替え額を直接入力 | `features/events/SimpleInput.tsx` |
| 品目別 | 任意 1〜20人 | 品目・金額・支払者を記録し支払者ごとに合算 | `features/events/ItemsInput.tsx` |
| 月次 | 登録済みの2人固定 | 支払いの都度記録し、月末に集計して精算（50:50） | `routes/MonthlyRecord.tsx` / `services/settle.ts` |

### 3-4. 月次の締め

「計算」を押すと精算結果を `snapshot_json` にスナップショット保存し、期間を `status='settled'` にする。その後も支出の編集は自由で、確定済み期間の支出が変わると `is_dirty=1` が立ち、画面に再計算を促す警告が出る。

<a id="endpoints"></a>

## 4. API エンドポイント

`/api/health` 以外はすべて `accessAuth` を通る。レスポンスは共通エンベロープ。

| メソッド | パス | 役割 |
|---|---|---|
| `GET` | `/api/health` | 疎通確認（認証不要） |
| `GET` | `/api/me` | ログイン中ユーザーの取得 |
| `PATCH` | `/api/me` | 自分の表示名の変更 |
| `GET` | `/api/users` | ユーザー一覧 |
| `PATCH` | `/api/users/:id` | 相手の表示名の変更 |
| `GET` | `/api/categories` | 有効カテゴリ一覧 |
| `GET` | `/api/monthly` | 月次期間の一覧 |
| `GET` | `/api/monthly/:ym` | 指定月の期間と支出 |
| `POST` | `/api/monthly/:ym/expenses` | 支出の追加 |
| `PATCH` | `/api/monthly/expenses/:id` | 支出の更新 |
| `DELETE` | `/api/monthly/expenses/:id` | 支出の削除 |
| `POST` | `/api/monthly/:ym/settle` | 締め（スナップショット保存） |
| `GET` | `/api/monthly/:ym/result` | 精算結果の取得 |
| `PATCH` | `/api/monthly/:ym/result/transfers/:index` | 送金の支払い済みフラグ |
| `GET` | `/api/events` | イベント一覧 |
| `POST` | `/api/events` | イベント作成＋精算計算 |
| `GET` | `/api/events/:id` | イベント詳細 |
| `DELETE` | `/api/events/:id` | イベント削除 |
| `PATCH` | `/api/events/:id/settlements/:settlementId` | 送金の支払い済みフラグ |

<a id="database"></a>

## 5. データベース（Cloudflare D1）

D1 は SQLite ベース。対話的トランザクション非対応のため、複数文を原子的に実行する箇所は `env.DB.batch([...])` を使う。

| テーブル | 役割 | 主なカラム |
|---|---|---|
| `users` | 許可メールのユーザー2名 | id, email(UNIQUE), display_name |
| `categories` | 月次支出のカテゴリ | id, name(UNIQUE), sort_order, is_active |
| `monthly_periods` | 月次の期間と締め状態 | year, month(UNIQUE), status, snapshot_json, is_dirty |
| `monthly_expenses` | 月次の個別支出 | period_id, paid_by, amount, category_id, spent_on |
| `events` | 単発の割り勘イベント | title, mode, total, per_person |
| `event_members` | イベント参加者と立て替え額 | event_id, name, paid, position |
| `event_items` | 品目別モードの明細 | event_id, name, amount, paid_by_member_id |
| `event_settlements` | 算出された送金リスト | from_member_id, to_member_id, amount, is_paid |

<a id="libraries"></a>

## 6. ライブラリとフレームワーク

### ランタイム依存（本番のコードに入るもの）

| パッケージ | バージョン | 所属 | 役割 |
|---|---|---|---|
| `hono` | ^4.13.0 | api | Workers 向けの軽量 Web フレームワーク。ルーティング・ミドルウェア・型付き Context |
| `jose` | ^6.2.8 | api | Cloudflare Access の JWT を JWKS で検証（`createRemoteJWKSet` / `jwtVerify`） |
| `zod` | ^4.4.3 | api | リクエストボディのスキーマ検証。境界での入力バリデーション |
| `react` / `react-dom` | ^19.2.8 | web | UI ライブラリ。`createRoot` + StrictMode |
| `react-router` | ^8.3.0 | web | SPA ルーティング。v8 なので `react-router-dom` は使わず全て `react-router` から import |
| `@tanstack/react-query` | ^5.101.4 | web | サーバー状態の管理。楽観更新はせず、更新後に該当クエリを invalidate |

### 開発・テスト用の依存

| パッケージ | バージョン | 役割 |
|---|---|---|
| `typescript` | ^7.0.2 | 型検査（`tsc --noEmit`）。ルートに1つ、全ワークスペース共通 |
| `vite` | ^8.2.1 | web の開発サーバーと本番バンドラ |
| `@vitejs/plugin-react` | ^6.0.5 | Vite の React プラグイン（JSX 変換・Fast Refresh） |
| `vitest` | ^4.1.10 | ユニット／統合テストランナー。3ワークスペースすべてで使用 |
| `@cloudflare/vitest-pool-workers` | ^0.20.2 | vitest を実際の workerd 上で走らせ、D1 バインディング込みで API をテストする |
| `@vitest/coverage-v8` | ^4.1.10 | カバレッジ（後述の制約あり） |
| `@testing-library/react` | ^16.3.2 | React コンポーネントのテスト |
| `@testing-library/user-event` | ^14.6.3 | 実ユーザーに近い操作のシミュレート |
| `@testing-library/jest-dom` | ^7.0.0 | DOM 向けのカスタムマッチャ |
| `jsdom` | ^29.1.1 | web のテスト環境 |
| `fast-check` | ^4.9.0 | Property-based テスト。精算ロジックの不変条件（送金合計＝過不足）を検証 |
| `@playwright/test` | ^1.62.1 | E2E テスト |
| `wrangler` | ^4.119.0 | Workers の CLI。dev サーバー・デプロイ・D1 マイグレーション |
| `@cloudflare/workers-types` | ^5.x | `D1Database` などランタイム型定義 |
| `@types/react` / `@types/react-dom` / `@types/node` | — | 型定義 |

<a id="tools"></a>

## 7. インストールされているツール・実行環境

| ツール | 種類 | 用途 |
|---|---|---|
| **Node.js 24.13.1** | ランタイム | 開発時のツール実行環境（本番の実行環境ではない） |
| **npm 11.8.0** | パッケージマネージャ | workspaces でモノレポを管理 |
| **Vite 8** | ビルドツール | web の dev サーバー（ポート 5173、`/api` を localhost:8787 へプロキシ）と本番ビルド |
| **Wrangler 4** | CLI | `wrangler dev` でローカル Worker 起動、`wrangler deploy`、`wrangler d1 migrations apply` |
| **TypeScript 7 (tsc)** | 型検査 | コード生成はせず型検査のみ |
| **Vitest 4** | テストランナー | shared / api / web の3ワークスペース |
| **Playwright** | E2E | ブラウザ自動操作。ポート 8788 の wrangler dev を叩く |
| **Cloudflare Workers** | 実行基盤 | 本番のサーバーレス実行環境（workerd） |
| **Cloudflare D1** | データベース | SQLite ベースのマネージド DB（`warikan-db`） |
| **Cloudflare Access** | 認証 | ドメイン全体を保護し、許可メール2件のみ通す |
| **Playwright MCP** | 開発支援 | `.mcp.json` で宣言。`ui-inspector` / `web-debugger` サブエージェントが使用 |

### 主なコマンド

```bash
npm install                              # 依存のインストール
npm run migrate:local -w @warikan/api    # ローカル D1 にマイグレーション適用
npm run dev -w @warikan/api              # Worker を起動（http://localhost:8787）
npm run dev -w @warikan/web              # Vite dev サーバー（http://localhost:5173）
npm run build -w @warikan/web            # SPA を apps/web/dist へビルド
npm test                                 # 全ワークスペースのテスト
npm run typecheck                        # 全ワークスペースの型検査
npm run test:e2e                         # Playwright（起動済み wrangler dev 前提）
```

<a id="constraints"></a>

## 8. 設計上の制約

| 制約 | 理由 |
|---|---|
| 金額はすべて整数（円）。浮動小数点を使わない | 丸め誤差で送金合計と過不足がずれるのを防ぐ |
| `localeCompare` 禁止、`compareStr` を使う | 環境の ICU データ差で端数の配分先が変わるため |
| 複数文の原子実行は `env.DB.batch([...])` | D1 が対話的トランザクション非対応 |
| API レスポンスは共通エンベロープ | `{ok:true,data}` / `{ok:false,error:{code,message,fields?}}` に統一 |
| 1ファイル 200〜400行を目安、800行を上限 | 1ファイル1責務を保つ |
| クエリキーは `lib/queryKeys.ts` からのみ取る | invalidate 漏れを防ぐ |
| react-router は v8。`react-router-dom` を使わない | v8 で import 元が統合された |
| 繰り返す行のボタンには行を識別できる名前を入れる | 全行同名だと読み上げでも自動テストでも並べ替え不具合を検知できない |
| 実在のメールアドレスをコードに書かない | テストは `me@example.com` / `partner@example.com` |
| `Cf-Access-Authenticated-User-Email` ヘッダを信用しない | Access を経由しないリクエストで詐称できる。必ず JWT を検証する |

> [!WARNING]
> **テストで検証できないこと**
> ① 静的配信 — vitest は Asset Worker を再現しないので `assets` の振り分けを壊してもテストは通る。
> ② レイアウト — jsdom はスタイルを解決しないので幅・折り返し・横スクロールは一切見えない。
> どちらも `wrangler dev` を起動して実物で確認するしかない。

> [!NOTE]
> **カバレッジの制約**
> v8 プロバイダは workerd 上で動かない（`node:inspector/promises` を解決できない）。計測するときは `@vitest/coverage-istanbul` を入れて `--coverage.provider=istanbul` を使う。

---

割り勘 (warikan) — 技術構成ドキュメント / 生成日 2026-08-18
参照: `CLAUDE.md`、`docs/superpowers/specs/`（設計書）、`docs/superpowers/plans/`（実装計画）
