# 割り勘アプリ Plan 2（React フロントエンド）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**作成日:** 2026-08-07
**対応する設計書:** [2026-08-05-warikan-cloudflare-design.md](../specs/2026-08-05-warikan-cloudflare-design.md) の Phase 3〜4（§7 画面設計）
**前提:** Plan 1（[2026-08-05-warikan-phase1-foundation-api.md](./2026-08-05-warikan-phase1-foundation-api.md)）が完了していること。API 13エンドポイントが動き、107 tests が通っている状態から始める。

**Goal:** React SPA を作り、Plan 1 の API を使って3モード（シンプル・品目別・月次）すべてをブラウザから操作できるようにする。同一 Worker から静的配信する。

**Architecture:** `apps/web` は Vite + React + TypeScript の SPA。サーバー状態は TanStack Query が持ち、楽観更新はせず invalidate で追従する。ビルド成果物を `apps/api` の Worker が Static Assets として配信し、`/api/*` だけ Worker のハンドラに回す。グローバル状態管理ライブラリは入れない。

**Tech Stack:** React 19 / react-router 8 / TanStack Query 5 / Vite 8 / Vitest 4 + Testing Library / TypeScript 7

---

## Global Constraints

すべてのタスクの要件に、以下が暗黙に含まれる。

- 金額はすべて**整数（円）**。表示のときだけ `¥12,345` に整形する。浮動小数点を金額計算に使わない
- 文字列比較は `localeCompare` を使わず、`@warikan/shared` の `compareStr`（コードユニット比較）を使う
- API レスポンスは共通エンベロープ `{ ok: true, data }` / `{ ok: false, error: { code, message, fields? } }`。**必ず `ok` を見てから `data` を触る**
- 実在のメールアドレスをソース・テストに書かない。テストは `me@example.com` / `partner@example.com` を使う
- ファイルは1つの責務に絞る。200〜400行を目安、800行を上限とする
- **既存のテストを壊さない。** Plan 1 の 107 tests は常に通ったままにする
- 型チェック（`npm run typecheck`）を常に通す
- スマホ前提。`max-width: 480px` の1カラム。タップ領域は 44px 以上
- **`wrangler deploy` / `migrate:remote` / `wrangler secret put` / `--remote` 系は実行しない。** 本番反映は Plan 3 の範囲
- `apps/api/src` と `apps/api/migrations` は変更しない。唯一の例外は Task 2 の `wrangler.jsonc`（assets 設定）

### 実測済みの前提（推測で書き換えないこと）

Plan 2 を書く時点で、次を実際にインストール・実行して確認した。

| 項目 | 実測値 |
|---|---|
| `react` / `react-dom` | 19.2.8 |
| `react-router` | **8.3.0**（v7 ではない。`react-router-dom` は不要で、すべて `react-router` から import する） |
| `@tanstack/react-query` | 5.101.4 |
| `vite` | 8.2.1 |
| `vitest` | 4.1.10（Plan 1 と同じ） |
| `@testing-library/react` | 16.3.2 |

react-router 8 は `BrowserRouter` / `Routes` / `Route` / `Link` / `NavLink` / `Navigate` / `Outlet` / `useParams` / `useNavigate` / `useSearchParams` / `createRoutesStub` をいずれも export しており、この計画で使う範囲では v7 と同じ書き方で動く（`dist/production/index.d.ts` の export 一覧で確認済み）。

`wrangler` の `assets` 設定は `directory` / `binding` / `html_handling` / `not_found_handling` / `run_worker_first` を持つ。`not_found_handling` は `"single-page-application" | "404-page" | "none"`、`run_worker_first` は**文字列配列を受け付ける**（`node_modules/wrangler/config-schema.json` で確認済み）。これが Task 2 の肝になる。

---

## 既存 API の契約

フロントが依存する形。**Plan 1 の実装から書き起こしたもので、推測ではない。**

```ts
// GET /api/me, PATCH /api/me
{ userId: string; email: string; displayName: string }

// GET /api/categories
{ id: number; name: string }[]

// GET /api/monthly
Period[]

// GET /api/monthly/:ym
{ period: Period; expenses: Expense[] }

type Period = {
  ym: string;            // "2026-08"
  year: number;
  month: number;
  status: string;        // "open" | "settled"
  isDirty: boolean;
  settledAt: string | null;
};

type Expense = {
  id: string;
  paidBy: string;        // users.id
  amount: number;
  itemName: string;
  categoryId: number | null;
  spentOn: string;       // "2026-08-03"
};

// POST /api/monthly/:ym/expenses  → 201, Expense
// PATCH /api/monthly/expenses/:id → 200, Expense
// DELETE /api/monthly/expenses/:id → 200, { id }

// POST /api/monthly/:ym/settle → Snapshot
// GET  /api/monthly/:ym/result → { snapshot: Snapshot; isDirty: boolean }（未計算なら 404）
// PATCH /api/monthly/:ym/result/transfers/:index → Snapshot

type Snapshot = {
  total: number;
  perPerson: number;
  byUser: { userId: string; displayName: string; paid: number; share: number }[];
  byCategory: { categoryId: number | null; name: string; amount: number }[];
  transfers: { fromId: string; toId: string; amount: number; isPaid: boolean }[];
  settledAt: string;
};

// GET /api/events
{ id: string; title: string; mode: string; total: number; perPerson: number; createdAt: string }[]

// POST /api/events → 201, EventDetail
// GET /api/events/:id → EventDetail
// DELETE /api/events/:id → { id }
// PATCH /api/events/:id/settlements/:settlementId → EventDetail

type EventDetail = {
  id: string;
  title: string;
  mode: string;          // "simple" | "items"
  total: number;
  perPerson: number;
  createdAt: string;
  members: { id: string; name: string; paid: number }[];
  items: { id: string; name: string; amount: number; paidByMemberId: string }[];
  settlements: { id: string; fromMemberId: string; toMemberId: string; amount: number; isPaid: boolean }[];
};
```

**POST /api/events のリクエスト形**:

```ts
{
  title: string;         // 空文字なら日付から自動生成される
  mode: "simple" | "items";
  members: { name: string; paid: number }[];   // 1〜20人
  items: { name: string; amount: number; paidByIndex: number }[];  // simple のときは []
}
```

`items` モードでは各メンバーの `paid` はサーバー側で品目から再計算されるため、送信時は 0 でよい。

---

## File Structure

```
apps/web/
├─ index.html
├─ package.json
├─ tsconfig.json
├─ vite.config.ts
├─ vitest.config.ts
└─ src/
   ├─ main.tsx              エントリ。QueryClientProvider と BrowserRouter を組む
   ├─ App.tsx               ルート定義
   ├─ styles.css            デザイントークンと共通クラス（legacy から踏襲）
   ├─ lib/
   │  ├─ api.ts             fetch ラッパ。エンベロープを剥がし、失敗は ApiError で投げる
   │  ├─ format.ts          金額・日付のフォーマッタ
   │  └─ ym.ts              年月の計算（前月・次月・今月）
   ├─ components/
   │  ├─ Card.tsx
   │  ├─ Button.tsx
   │  ├─ AmountInput.tsx
   │  ├─ Toggle.tsx         2択トグル（支払者の切り替え）
   │  └─ ErrorBanner.tsx
   ├─ features/
   │  ├─ monthly/
   │  │  ├─ queries.ts      useMonthlyPeriod / useAddExpense / useSettle …
   │  │  ├─ ExpenseForm.tsx 上部固定の記録追加フォーム
   │  │  ├─ ExpenseList.tsx 日付グルーピングつきリスト
   │  │  └─ ResultView.tsx  カテゴリ内訳・支払い状況・送金
   │  └─ events/
   │     ├─ queries.ts
   │     ├─ wizardReducer.ts  ウィザードの状態遷移（純関数）
   │     ├─ SimpleInput.tsx
   │     └─ ItemsInput.tsx
   └─ routes/
      ├─ Home.tsx
      ├─ MonthlyRecord.tsx
      ├─ MonthlyResult.tsx
      ├─ EventNew.tsx
      ├─ EventInput.tsx
      └─ EventDetail.tsx
```

**分割の方針**: `routes/` は画面の組み立てと URL パラメータの解釈だけを持ち、データ取得は `features/*/queries.ts`、表示は `features/*/`（画面固有）と `components/`（汎用）に置く。`lib/` は React に依存しない純粋な関数だけを置き、テストしやすくする。

---

## テストの方針

「要所だけ絞って書く」方針を採る。**全コンポーネントにテストを書くことはしない。**

書く対象は、壊れたときに気づきにくく、E2E では検知が遅れるものに限る。

| 対象 | 理由 |
|---|---|
| `lib/api.ts` | エンベロープの剥がし方とエラー変換。全画面が依存する |
| `lib/format.ts` / `lib/ym.ts` | 純関数。境界値（月またぎ、0円、6桁）が壊れやすい |
| `features/events/wizardReducer.ts` | 純関数。状態遷移の分岐が多い |
| `ExpenseForm` | 「送信後に支払者・カテゴリ・日付が残る」という設計書 §7.1 の要求。目視では気づきにくい |
| `ResultView` | `is_dirty` の警告出し分け。出すべきときに出ないと金額を誤る |
| `features/monthly/queries.ts` の invalidate | 対象を取り違えると金額が古いまま表示される。前方一致が非対称で間違えやすい（Task 6 で追加） |

書かない対象: 単純な表示だけのコンポーネント、ルーティングの結線、CSS。これらは Plan 3 の Playwright E2E と `ui-inspector` に任せる。

---

## Task 1: apps/web の土台

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/vitest.config.ts`
- Create: `apps/web/index.html`, `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/styles.css`
- Create: `apps/web/src/smoke.test.tsx`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: なし
- Produces: `apps/web` ワークスペース（`@warikan/web`）。`npm run dev -w @warikan/web` で Vite が起動し、`npm test` に web のテストが含まれる

- [x] **Step 1: package.json を作る**

`apps/web/package.json`:

```json
{
  "name": "@warikan/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  }
}
```

- [x] **Step 2: 依存をインストールする**

```bash
npm install react react-dom react-router @tanstack/react-query -w @warikan/web
```

```bash
npm install -D vite @vitejs/plugin-react @types/react @types/react-dom jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom -w @warikan/web
```

```bash
npm install @warikan/shared -w @warikan/web
```

`react-router-dom` は**インストールしない**。react-router 8 ではすべて `react-router` から import する。

- [x] **Step 3: tsconfig を作る**

`apps/web/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["vite/client"]
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"]
}
```

- [x] **Step 4: Vite の設定を書く**

`apps/web/vite.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    // Worker の assets がこのディレクトリを配信する（Task 2）
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // 開発中は API だけローカルの wrangler dev に転送する。
    // 本番は同一 Worker が両方を返すので、フロントのコードは常に相対パスで /api を叩けばよい。
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
});
```

- [x] **Step 5: Vitest の設定を書く**

`apps/web/vitest.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
```

`apps/web/src/test-setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

- [x] **Step 6: エントリと最小のアプリを書く**

`apps/web/index.html`:

```html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>割り勘</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/web/src/App.tsx`:

```tsx
export function App() {
  return (
    <div className="container">
      <div className="card">
        <h1>割り勘</h1>
      </div>
    </div>
  );
}
```

`apps/web/src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.js";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root が見つかりません");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [x] **Step 7: デザイントークンを移植する**

`apps/web/src/styles.css`（`legacy/templates/base.html` の `<style>` から踏襲。値は変えない）:

```css
:root {
  --bg: #f0f2f5;
  --surface: #fff;
  --text: #1a1a2e;
  --text-sub: #555;
  --text-muted: #777;
  --accent: #5b8dee;
  --accent-strong: #4a7de0;
  --accent-bg: #eef3fd;
  --danger: #dc2626;
  --danger-bg: #fee2e2;
  --success: #16a34a;
  --success-bg: #dcfce7;
  --border: #e0e0e0;
  --radius-card: 16px;
  --radius-control: 10px;
}

*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
  padding: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.container {
  width: 100%;
  max-width: 480px;
}

.card {
  background: var(--surface);
  border-radius: var(--radius-card);
  padding: 28px 24px;
  box-shadow: 0 2px 16px rgb(0 0 0 / 8%);
  margin-bottom: 16px;
}

h1 {
  font-size: 1.4rem;
  margin-bottom: 6px;
}

h2 {
  font-size: 1rem;
  color: #444;
  margin-bottom: 14px;
  font-weight: 600;
}

p.sub {
  color: var(--text-muted);
  font-size: 0.875rem;
  margin-bottom: 20px;
}

label {
  display: block;
  font-size: 0.85rem;
  color: var(--text-sub);
  margin-bottom: 5px;
  font-weight: 500;
}

input[type="text"],
input[type="number"],
input[type="date"],
select {
  width: 100%;
  padding: 11px 14px;
  border: 1.5px solid var(--border);
  border-radius: var(--radius-control);
  font-size: 1rem;
  outline: none;
  background: var(--surface);
  transition: border-color 0.15s;
}

input:focus,
select:focus,
button:focus-visible {
  border-color: var(--accent);
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.form-group {
  margin-bottom: 16px;
}

.row2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.actions {
  display: flex;
  gap: 10px;
  margin-top: 20px;
}

.actions > * {
  flex: 1;
}

.tag {
  display: inline-block;
  font-size: 0.75rem;
  padding: 2px 8px;
  border-radius: 6px;
  font-weight: 500;
}

.tag-blue {
  background: var(--accent-bg);
  color: var(--accent);
}

.tag-green {
  background: var(--success-bg);
  color: var(--success);
}
```

- [x] **Step 8: スモークテストを書く**

`apps/web/src/smoke.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { App } from "./App.js";

describe("App", () => {
  it("見出しが描画される", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "割り勘" })).toBeInTheDocument();
  });
});
```

- [x] **Step 9: .gitignore に Vite の生成物を追加する**

`.gitignore` に追記:

```
apps/web/dist/
```

- [x] **Step 10: テストと型チェックを通す**

Run: `npm test -w @warikan/web`
Expected: PASS（1 test）

Run: `npm run typecheck -w @warikan/web`
Expected: エラーなし

Run: `npm test`
Expected: 既存の 107 tests と合わせて 108 tests すべて PASS

- [x] **Step 11: ビルドが通ることを確認する**

Run: `npm run build -w @warikan/web`
Expected: `apps/web/dist/index.html` と `apps/web/dist/assets/*.js` が生成される

- [x] **Step 12: コミット**

```bash
git add apps/web .gitignore package-lock.json
git commit -m "feat: apps/web に React + Vite の土台を用意"
```

---

## Task 2: Worker からの静的配信と SPA フォールバック

このタスクを先にやる理由: 「API とフロントを1つの Worker で配る」構成が本当に成立するかは、画面を作ってから確かめると手戻りが大きい。土台の直後に潰しておく。

**Files:**
- Modify: `apps/api/wrangler.jsonc`
- Modify: `apps/api/package.json`（build スクリプト）
- ~~Create: `apps/api/test/assets.test.ts`~~（撤回。理由は Step 1）
- Modify: `README.md`

**Interfaces:**
- Consumes: `apps/web/dist`（Task 1）
- Produces: `/api/*` は Worker、それ以外は SPA という配信規則

- [x] **Step 1: 自動テストでは守れないことを確認する（当初の計画を撤回）**

**当初この Step は `apps/api/test/assets.test.ts` を新規作成する内容だったが、実施時の検証で「そのテストは目的をまったく果たせない」ことが判明したため撤回した。**

判明したこと（実測）:

`@cloudflare/vitest-pool-workers` のテスト環境は **Static Assets を一切再現しない**。`wrangler.jsonc` の `assets` は `configPath` 経由で読み込まれるものの、Asset Worker はテストランナー内に存在しない。実際に確認すると:

| リクエスト | テスト環境での応答 | 実際の `wrangler dev` での応答 |
|---|---|---|
| `GET /` | `404 application/json`（Hono の notFound） | `200 text/html`（SPA） |
| `GET /monthly/2026-08` | `404 application/json` | `200 text/html`（SPA フォールバック） |

つまりテスト環境では常に Worker だけが動くので、`run_worker_first` が正しかろうが壊れていようが結果は変わらない。ミューテーションで裏付けた:

`run_worker_first` を `["/api/*"]` → `["/never-matches"]` に書き換えても **78 tests すべて PASS のまま**。守れていない。

加えて、書こうとしていた2件は既存の `apps/api/test/health.test.ts` の

- `it("GET /api/health が 200 を返す")`
- `it("認証済みでも未定義のパスは 404 エンベロープを返す")`

とほぼ同一で、`content-type` の assertion が1行増えるだけだった。**通らない保証を装う重複テストは、無いより悪い。** したがってファイルは作らない。

この構成を守るのは Step 7 のローカル配信確認である。自動テストで代替できないことを承知のうえで、Step 7 を必須の検証ゲートとして扱うこと。

- [x] **Step 2: 既存テストが壊れていないことを確認する**

Run: `npm test -w @warikan/api`
Expected: PASS（Plan 1 の 76 tests のまま。Task 2 でテストは増えない）

- [x] **Step 3: web をビルドする**

```bash
npm run build -w @warikan/web
```

`apps/api` のテストは `apps/web/dist` の存在を前提にしないが、`wrangler dev` と `wrangler deploy` は必要とする。

- [x] **Step 4: wrangler.jsonc に assets を追加する**

`apps/api/wrangler.jsonc` の `"observability"` の次に追加する:

```jsonc
  "assets": {
    "directory": "../web/dist",
    "not_found_handling": "single-page-application",
    // これが無いと /api/* まで index.html にフォールバックして API が死ぬ。
    // 配列で渡したパターンだけ Worker が先に処理し、残りは Asset Worker が返す。
    "run_worker_first": ["/api/*"]
  },
```

`binding` は設定しない。Worker のコードから `env.ASSETS` を触る必要はなく、振り分けはプラットフォーム側で完結する。

- [x] **Step 5: テストを実行して壊れていないことを確認する**

Run: `npm test -w @warikan/api`
Expected: PASS（Plan 1 の 76 tests のまま）

ここで確認できるのは「`assets` を足しても既存の Worker のテストが壊れていない」ことだけで、振り分けが正しいかどうかは**テストからは判定できない**（Step 1 参照）。振り分けの正否は Step 7 で見る。

- [x] **Step 6: api の build スクリプトを追加する**

`apps/api/package.json` の `scripts` に追加:

```json
    "build": "npm run build -w @warikan/web",
```

`wrangler deploy` の前に web をビルドし忘れると古い画面が出るため、api 側から呼べるようにしておく。

- [x] **Step 7: ローカルで実際に配信を確認する（このタスク唯一の実効的な検証）**

Step 1 のとおり、`assets` の振り分けを検証できるのはここだけである。省略しないこと。

```bash
npm run build -w @warikan/web
```

**ポートに注意**: このマシンでは別プロジェクト（`kakei-dashboard-3`）の `wrangler dev` が 8787 に常駐している。衝突を避けて別ポートで起動する:

```bash
npx wrangler dev --port 8788
```

（`apps/api` を cwd にして実行する。`assets.directory` が `../web/dist` という相対パスのため。8787 が空いていれば `npm run dev -w @warikan/api` でよい。）

別のターミナルで:

```bash
curl -s -w "\n[%{http_code} %{content_type}]\n" http://127.0.0.1:8788/api/health
```

```bash
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" http://127.0.0.1:8788/
```

```bash
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" http://127.0.0.1:8788/monthly/2026-08
```

```bash
curl -s -w "\n[%{http_code} %{content_type}]\n" http://127.0.0.1:8788/api/nope
```

Expected（すべて実測で確認済み）:

| リクエスト | 期待 | 意味 |
|---|---|---|
| `/api/health` | `{"ok":true,"data":{"status":"ok"}}` / `200 application/json` | API が Worker に届いている |
| `/` | `200 text/html` | SPA の index.html |
| `/monthly/2026-08` | `200 text/html` | SPA フォールバック（404 ではない） |
| `/api/nope` | `{"ok":false,"error":{"code":"NOT_FOUND",...}}` / `404 application/json` | 未定義の API が SPA に吸われていない |
| `/assets/index-*.js` | `200 text/javascript` | ビルド成果物が配信されている |

**この設定が効いていることのミューテーション検証（実施済み）**: `run_worker_first` を `["/api/*"]` → `["/never-matches"]` に変えると、`/api/health` が **`200 text/html` で SPA の index.html を返す**（API が全滅する）。一方 `npm test -w @warikan/api` は 78 tests すべて PASS のまま素通りした。設定を触ったら必ずここを手で確認すること。

**停止手順に注意**（Plan 1 Task 14 で実測済み）: Ctrl+C だけでは子の `workerd` が残り、親が生きていると再生成される。`wrangler.js` → `wrangler-dist/cli.js` → `workerd` のツリーを親から順に落とす。`workerd` を名前だけで一括終了しないこと。`kakei-dashboard-3` の `workerd` を巻き添えにする。

コマンドラインで warikan のプロセスだけを特定してから落とす:

```bash
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { \$_.CommandLine -like '*warikan*' -and \$_.Name -in @('node.exe','workerd.exe') } | Select-Object ProcessId,ParentProcessId,Name,CreationDate"
```

実測時のツリーは `node`(親) → `node` → `workerd` ×2 の4プロセスで、親から順に `Stop-Process -Force` して停止した。停止後に上のコマンドを再実行し、残っているのが `kakei` のプロセスだけであることを確認すること。

- [x] **Step 8: README を更新する**

`README.md` の「開発」節に追記する:

```markdown
フロントエンドを開発する（http://localhost:5173、`/api` はローカルの Worker に転送される）:

    npm run dev -w @warikan/web

このとき、別のターミナルで API も起動しておく:

    npm run dev -w @warikan/api

本番と同じ構成（単一 Worker が画面と API の両方を返す）で確認する:

    npm run build -w @warikan/web
    npm run dev -w @warikan/api
```

- [x] **Step 9: コミット**

```bash
git add apps README.md
git commit -m "feat: Worker から SPA を配信し /api/* だけ Worker に振り分ける"
```

---

## Task 3: API クライアント

**Files:**
- Create: `apps/web/src/lib/api.ts`, `apps/web/src/lib/types.ts`
- Create: `apps/web/src/lib/api.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `class ApiError extends Error { code: string; status: number; fields?: Record<string, string> }`
  - `apiGet<T>(path: string): Promise<T>`
  - `apiSend<T>(method: string, path: string, body?: unknown): Promise<T>`
  - `apps/web/src/lib/types.ts` に上記「既存 API の契約」の型

**実施時に判明した計画の不備（2件、修正済み）:**

1. **Step 2 のテストコードは型チェックが通らない。** `vi.fn(async () => ...)` を引数ゼロで宣言しているため `spy.mock.calls[0]` の型が空タプル `[]` になり、`const [, init] = ...` が TS2493 で落ちる（計6件）。モックを `vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ...)` と fetch のシグネチャで宣言して解消した。**Task 4 以降で同じ形のモックを書くときも同じ宣言にすること。**

2. **`fetch` 自体が reject する経路が ApiError にならない。** 計画の実装は `await fetch(...)` を try で囲んでいないため、オフライン・DNS 失敗・接続中断では生の `TypeError("Failed to fetch")` がそのまま伝播する。実測で確認済み（`isApiError = false`）。UI に英語のメッセージが出るうえ、呼び出し側の `instanceof ApiError` による分岐から漏れる。`fetch` を try で囲み `new ApiError("NETWORK_ERROR", FALLBACK_MESSAGE, 0)` に正規化した（応答が無いので status は 0）。テストも1件追加。

**ミューテーションで検証済み:** エラーエンベロープの分岐 `if (!envelope.ok)` を殺すと3件、非 JSON 応答の本文を `message` に入れると1件が落ちる。テストは実際に効いている。

- [x] **Step 1: 型を定義する**

`apps/web/src/lib/types.ts`:

```ts
export type Me = {
  userId: string;
  email: string;
  displayName: string;
};

export type Category = {
  id: number;
  name: string;
};

export type Period = {
  ym: string;
  year: number;
  month: number;
  status: string;
  isDirty: boolean;
  settledAt: string | null;
};

export type Expense = {
  id: string;
  paidBy: string;
  amount: number;
  itemName: string;
  categoryId: number | null;
  spentOn: string;
};

export type MonthlyDetail = {
  period: Period;
  expenses: Expense[];
};

export type Snapshot = {
  total: number;
  perPerson: number;
  byUser: { userId: string; displayName: string; paid: number; share: number }[];
  byCategory: { categoryId: number | null; name: string; amount: number }[];
  transfers: { fromId: string; toId: string; amount: number; isPaid: boolean }[];
  settledAt: string;
};

export type MonthlyResult = {
  snapshot: Snapshot;
  isDirty: boolean;
};

export type EventMode = "simple" | "items";

export type EventSummary = {
  id: string;
  title: string;
  mode: string;
  total: number;
  perPerson: number;
  createdAt: string;
};

export type EventDetail = EventSummary & {
  members: { id: string; name: string; paid: number }[];
  items: { id: string; name: string; amount: number; paidByMemberId: string }[];
  settlements: {
    id: string;
    fromMemberId: string;
    toMemberId: string;
    amount: number;
    isPaid: boolean;
  }[];
};

export type CreateEventPayload = {
  title: string;
  mode: EventMode;
  members: { name: string; paid: number }[];
  items: { name: string; amount: number; paidByIndex: number }[];
};
```

- [x] **Step 2: 失敗するテストを書く**

`apps/web/src/lib/api.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiGet, apiSend } from "./api.js";

const mockFetch = (status: number, body: unknown, contentType = "application/json") => {
  const spy = vi.fn(async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "Content-Type": contentType },
    }),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiGet", () => {
  it("エンベロープを剥がして data を返す", async () => {
    mockFetch(200, { ok: true, data: { userId: "u1" } });

    await expect(apiGet<{ userId: string }>("/api/me")).resolves.toEqual({ userId: "u1" });
  });

  it("ok:false なら ApiError を投げ、code と status を持つ", async () => {
    mockFetch(400, {
      ok: false,
      error: { code: "VALIDATION_ERROR", message: "入力内容を確認してください" },
    });

    const error = await apiGet("/api/monthly/2026-8").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("VALIDATION_ERROR");
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).message).toBe("入力内容を確認してください");
  });

  it("fields があれば保持する", async () => {
    mockFetch(400, {
      ok: false,
      error: { code: "VALIDATION_ERROR", message: "だめ", fields: { spentOn: "対象月外" } },
    });

    const error = (await apiGet("/api/x").catch((e: unknown) => e)) as ApiError;

    expect(error.fields).toEqual({ spentOn: "対象月外" });
  });

  it("403 は認証エラーとして FORBIDDEN を保つ", async () => {
    mockFetch(403, { ok: false, error: { code: "FORBIDDEN", message: "アクセス権がありません" } });

    const error = (await apiGet("/api/me").catch((e: unknown) => e)) as ApiError;

    expect(error.code).toBe("FORBIDDEN");
    expect(error.status).toBe(403);
  });

  it("JSON でない応答でも ApiError になる", async () => {
    mockFetch(502, "<html>Bad Gateway</html>", "text/html");

    const error = (await apiGet("/api/me").catch((e: unknown) => e)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(502);
    // 内部の HTML をそのままユーザーに見せない
    expect(error.message).not.toContain("<html>");
  });
});

describe("apiSend", () => {
  it("メソッドと JSON ボディを渡す", async () => {
    const spy = mockFetch(201, { ok: true, data: { id: "e1" } });

    await expect(apiSend("POST", "/api/events", { title: "飲み会" })).resolves.toEqual({ id: "e1" });

    const [, init] = spy.mock.calls[0]!;
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).body).toBe(JSON.stringify({ title: "飲み会" }));
    expect(new Headers((init as RequestInit).headers).get("Content-Type")).toBe("application/json");
  });

  it("ボディなしの DELETE では Content-Type を付けない", async () => {
    const spy = mockFetch(200, { ok: true, data: { id: "e1" } });

    await apiSend("DELETE", "/api/events/e1");

    const [, init] = spy.mock.calls[0]!;
    expect((init as RequestInit).body).toBeUndefined();
  });
});
```

- [x] **Step 3: テストを実行して失敗することを確認する**

Run: `npm test -w @warikan/web`
Expected: FAIL — `Failed to resolve import "./api.js"`

- [x] **Step 4: API クライアントを実装する**

`apps/web/src/lib/api.ts`:

```ts
type Envelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; fields?: Record<string, string> } };

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly fields: Record<string, string> | undefined;

  constructor(
    code: string,
    message: string,
    status: number,
    fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.fields = fields;
  }
}

const FALLBACK_MESSAGE = "通信に失敗しました。時間をおいて試してください。";

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(path, init);

  let envelope: Envelope<T> | null = null;
  try {
    envelope = (await response.json()) as Envelope<T>;
  } catch {
    // JSON で返らないのはプロキシや Access の割り込み。中身は見せない。
    throw new ApiError("NETWORK_ERROR", FALLBACK_MESSAGE, response.status);
  }

  if (!envelope || typeof envelope !== "object" || !("ok" in envelope)) {
    throw new ApiError("NETWORK_ERROR", FALLBACK_MESSAGE, response.status);
  }

  if (!envelope.ok) {
    throw new ApiError(
      envelope.error.code,
      envelope.error.message,
      response.status,
      envelope.error.fields,
    );
  }

  return envelope.data;
}

export const apiGet = <T>(path: string): Promise<T> => request<T>(path, { method: "GET" });

export const apiSend = <T>(method: string, path: string, body?: unknown): Promise<T> =>
  request<T>(
    path,
    body === undefined
      ? { method }
      : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
```

- [x] **Step 5: テストを実行して成功することを確認する**

Run: `npm test -w @warikan/web`
Expected: PASS（smoke 1 + api 8 = 9 tests。api は計画の7件 + 通信失敗の1件）

- [x] **Step 6: 型チェックとコミット**

```bash
npm run typecheck -w @warikan/web
```

```bash
git add apps/web
git commit -m "feat: エンベロープを剥がす API クライアントを追加"
```

---

## Task 4: フォーマッタと年月ユーティリティ

**実施時に判明した計画の不備（実測で確認）:**

1. **`formatYen` が半角 `¥` を保てるのは偶然だった。** `Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" })` は**全角 `￥`（U+FFE5）**を返す（実測）。表示仕様は半角 `¥`（U+00A5）。計画の実装は `style: "currency"` を使わず区切りだけ Intl に任せているので結果的に正しいが、理由がコードに無く、後から currency 化されると静かに化ける。理由をコメントに明記し、`formatYen(100).codePointAt(0) === 0x00a5` を検証するテストを追加した。負号の位置は Intl も先頭で、食い違うのは記号の文字だけ。

2. **日付のタイムゾーン。** `new Date("2026-08-03")` は UTC 深夜と解釈されるため、`getDay()` などローカル系メソッドで読むと UTC より西で1日ずれる（America/New_York で `8/2(日)` になることを実測）。**JST では偶然通ってしまうので、テストだけでは検知できない。** 方針として「日付文字列由来の値は `Date.UTC` + `getUTC*` で閉じる。例外は `todayYm` / `todayIso` のみ意図的にローカル時刻」を採用し、両ファイルの冒頭にコメントで残した。あわせて `apps/web/vitest.config.ts` に `env: { TZ: "America/New_York" }` を追加し、ローカル系メソッドに戻す実装が必ず落ちるようにした（ミューテーションで3件 FAIL を確認済み）。

3. **`todayYm` / `todayIso` のテストが計画に1件も無かった。** import すらしていない。`vi.useFakeTimers()` + `vi.setSystemTime()` で固定したテストを3件追加。固定値は `new Date(2026, 7, 3, 12, 0, 0)` のようにローカル時刻の年月日で組み立てる（UTC インスタンスで固定すると TZ 次第でずれる）。

4. **`clampToMonth` のテスト名が実装挙動と食い違う。** 計画の `"対象月より前の日付は日を保ったまま対象月に移す"` は通るが、通る理由が名前と違う。実装は**年月を `ym` で置き換え、日は保ったまま 1〜末日に丸める**だけで、1日に寄せる動作はしない（`("2026-07-20", "2026-08")` → `"2026-08-20"`）。目的（月またぎ入力でサーバーが 400 を返すのを送信前に防ぐ）は満たしているので実装はそのままとし、実挙動どおりのテスト名に直したうえで doc コメントに明記した。境界（月初・月末・うるう年 2028-02-29・平年 2026-02-29→02-28・日が読めない入力）も追加で通してある。

**Files:**
- Create: `apps/web/src/lib/format.ts`, `apps/web/src/lib/ym.ts`
- Create: `apps/web/src/lib/format.test.ts`, `apps/web/src/lib/ym.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `formatYen(amount: number): string` — `12345` → `"¥12,345"`
  - `formatDateLabel(spentOn: string): string` — `"2026-08-03"` → `"8/3(月)"`
  - `percent(part: number, whole: number): number` — 整数パーセント
  - `todayYm(): string` / `shiftYm(ym: string, delta: number): string` / `ymLabel(ym: string): string`
  - `clampToMonth(dateIso: string, ym: string): string`

- [x] **Step 1: 失敗するテストを書く**

`apps/web/src/lib/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { formatDateLabel, formatYen, percent } from "./format.js";

describe("formatYen", () => {
  it("3桁ごとに区切る", () => {
    expect(formatYen(12345)).toBe("¥12,345");
  });

  it("6桁でも崩れない", () => {
    expect(formatYen(1234567)).toBe("¥1,234,567");
  });

  it("0円を表示できる", () => {
    expect(formatYen(0)).toBe("¥0");
  });

  it("負の額は符号を先に置く", () => {
    expect(formatYen(-8850)).toBe("-¥8,850");
  });
});

describe("formatDateLabel", () => {
  it("月日と曜日にする", () => {
    // 2026-08-03 は月曜日
    expect(formatDateLabel("2026-08-03")).toBe("8/3(月)");
  });

  it("日曜日を正しく出す", () => {
    // 2026-08-02 は日曜日
    expect(formatDateLabel("2026-08-02")).toBe("8/2(日)");
  });

  it("月末をまたいでもずれない", () => {
    expect(formatDateLabel("2026-08-31")).toBe("8/31(月)");
  });
});

describe("percent", () => {
  it("四捨五入した整数を返す", () => {
    expect(percent(32000, 84300)).toBe(38);
  });

  it("全体が0なら0を返す", () => {
    expect(percent(0, 0)).toBe(0);
  });
});
```

`apps/web/src/lib/ym.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { clampToMonth, shiftYm, ymLabel } from "./ym.js";

describe("shiftYm", () => {
  it("翌月に進む", () => {
    expect(shiftYm("2026-08", 1)).toBe("2026-09");
  });

  it("前月に戻る", () => {
    expect(shiftYm("2026-08", -1)).toBe("2026-07");
  });

  it("年をまたいで進む", () => {
    expect(shiftYm("2026-12", 1)).toBe("2027-01");
  });

  it("年をまたいで戻る", () => {
    expect(shiftYm("2026-01", -1)).toBe("2025-12");
  });
});

describe("ymLabel", () => {
  it("日本語の年月にする", () => {
    expect(ymLabel("2026-08")).toBe("2026年8月");
  });
});

describe("clampToMonth", () => {
  it("その月の日付はそのまま", () => {
    expect(clampToMonth("2026-08-15", "2026-08")).toBe("2026-08-15");
  });

  it("対象月より前の日付は日を保ったまま対象月に移す", () => {
    expect(clampToMonth("2026-09-01", "2026-08")).toBe("2026-08-01");
  });

  it("月末を超える日は末日に丸める", () => {
    // 2月は28日まで（2026年は平年）
    expect(clampToMonth("2026-02-31", "2026-02")).toBe("2026-02-28");
  });
});
```

- [x] **Step 2: テストを実行して失敗することを確認する**

Run: `npm test -w @warikan/web`
Expected: FAIL — `./format.js` と `./ym.js` が解決できない

- [x] **Step 3: フォーマッタを実装する**

`apps/web/src/lib/format.ts`:

```ts
const YEN = new Intl.NumberFormat("ja-JP");

/** 金額は整数（円）。表示のときだけ区切りを入れる。 */
export function formatYen(amount: number): string {
  return amount < 0 ? `-¥${YEN.format(-amount)}` : `¥${YEN.format(amount)}`;
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

/**
 * "2026-08-03" → "8/3(月)"
 * ローカルタイムゾーンの影響を受けないよう UTC で解釈する。
 */
export function formatDateLabel(spentOn: string): string {
  const [year, month, day] = spentOn.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return spentOn;

  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] ?? "";
  return `${month}/${day}(${weekday})`;
}

export function percent(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 100);
}
```

`apps/web/src/lib/ym.ts`:

```ts
const pad = (value: number): string => String(value).padStart(2, "0");

/** その年月の日数。 */
export const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

export function parseYm(ym: string): { year: number; month: number } | null {
  const matched = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!matched) return null;

  const year = Number(matched[1]);
  const month = Number(matched[2]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12) return null;

  return { year, month };
}

/** 今日の年月。 */
export function todayYm(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

/** 今日の日付（YYYY-MM-DD）。 */
export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function shiftYm(ym: string, delta: number): string {
  const parsed = parseYm(ym);
  if (!parsed) return ym;

  const shifted = new Date(Date.UTC(parsed.year, parsed.month - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}`;
}

export function ymLabel(ym: string): string {
  const parsed = parseYm(ym);
  return parsed ? `${parsed.year}年${parsed.month}月` : ym;
}

/**
 * 日付を選択中の年月の範囲に収める。
 * 月をまたぐ入力はサーバー側で 400 になるため、送信前にここで防ぐ。
 */
export function clampToMonth(dateIso: string, ym: string): string {
  const parsed = parseYm(ym);
  if (!parsed) return dateIso;

  const day = Number(dateIso.split("-")[2]);
  if (!Number.isInteger(day)) return `${ym}-01`;

  const last = daysInMonth(parsed.year, parsed.month);
  const clamped = Math.min(Math.max(day, 1), last);

  return `${ym}-${pad(clamped)}`;
}
```

- [x] **Step 4: テストを実行して成功することを確認する**

Run: `npm test -w @warikan/web`
Expected: PASS（smoke 1 + api 8 + format 10 + ym 18 = 37 tests。format/ym は計画より多い。上記「実施時に判明した計画の不備」参照）

- [x] **Step 5: 型チェックとコミット**

```bash
npm run typecheck -w @warikan/web
```

```bash
git add apps/web
git commit -m "feat: 金額と年月のフォーマッタを追加"
```

---

## Task 5: 共通コンポーネントとルーターの骨格

**実施時に判明した計画の不備（実測で確認）:**

1. **Step 6 のスモークテストはそのままでは通らない。** `vitest.config.ts` が `globals: false` のため、`@testing-library/react` の自動クリーンアップが登録されない（`typeof afterEach === "function"` で判定しているため）。描画した DOM が `body` に積み上がり、5件目が `Found multiple elements with the role "heading" and name "割り勘"` で落ちる。**Task 6 以降のコンポーネントテストはすべてこれを踏む**ので、各テストファイルではなく `apps/web/src/test-setup.ts` に `afterEach(cleanup)` を一度だけ登録して解決した。以降のタスクでは各テストファイルにクリーンアップを書く必要はない。

2. **Step 7 の期待件数 42 は誤り。正しくは 41。** Step 6 は既存の `smoke.test.tsx`（1件）を**置き換える**のであって追加ではないため、`api 8 + format 10 + ym 18 + ルーティング 5 = 41` が正しい。テストが失われたわけではない。

3. **`AmountInput` は自分でラベルを持たない。** `id` を受け取るだけなので、`getByLabelText` で引くには**呼び出し側が `<label htmlFor={id}>` を描く必要がある**。Task 6 以降でフォームを組むときは必ずラベルを対にすること。`type="number"` + `inputMode="numeric"` + `min=0` + `step=1` で、スマホで負号なしの数値キーパッドが出ることは確認済み。

**確認して問題なかったもの:** react-router 8.3.0 は `BrowserRouter` / `Routes` / `Route` / `Navigate` / `MemoryRouter` / `useParams` / `useNavigate` をすべて `react-router` から export しており（実行と型定義の両方で確認）、計画の import はそのまま使える。TanStack Query 5.101.4 の `staleTime` / `refetchOnWindowFocus` / `retry` も有効。既存 `styles.css` と Step 2 の追加分はセレクタが重複していない。

**ミューテーションで検証済み:** `<Route path="*">` の catch-all を消すと1件、`/monthly/:ym/result` のパスを `:ym/results` に変えると1件が落ちる。ルーティングのテストは実際に効いている。

**Files:**
- Create: `apps/web/src/components/Card.tsx`, `Button.tsx`, `AmountInput.tsx`, `Toggle.tsx`, `ErrorBanner.tsx`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/main.tsx`, `apps/web/src/styles.css`
- Create: `apps/web/src/routes/Home.tsx`, `MonthlyRecord.tsx`, `MonthlyResult.tsx`, `EventNew.tsx`, `EventInput.tsx`, `EventDetail.tsx`（いずれも仮の中身）
- Modify: `apps/web/src/smoke.test.tsx`

**Interfaces:**
- Consumes: `todayYm`（Task 4）
- Produces:
  - `<Card>`, `<Button variant>`, `<AmountInput>`, `<Toggle>`, `<ErrorBanner>`
  - ルート定義（`/`, `/monthly`, `/monthly/:ym`, `/monthly/:ym/result`, `/events/new`, `/events/new/input`, `/events/:id`）

- [x] **Step 1: 共通コンポーネントを書く**

`apps/web/src/components/Card.tsx`:

```tsx
import type { ReactNode } from "react";

export function Card({ children }: { children: ReactNode }) {
  return <div className="card">{children}</div>;
}
```

`apps/web/src/components/Button.tsx`:

```tsx
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger" | "success";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "md" | "sm";
};

export function Button({ variant = "primary", size = "md", className, ...rest }: Props) {
  const classes = ["btn", `btn-${variant}`, size === "sm" ? "btn-sm" : "", className ?? ""]
    .filter((value) => value.length > 0)
    .join(" ");

  return <button type="button" className={classes} {...rest} />;
}
```

`apps/web/src/components/AmountInput.tsx`:

```tsx
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
        if (!Number.isInteger(parsed) || parsed < 0) return;
        onChange(parsed);
      }}
    />
  );
}
```

`apps/web/src/components/Toggle.tsx`:

```tsx
type Option = { value: string; label: string };

type Props = {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  label: string;
};

/**
 * 2〜3択の切り替え。プルダウンにするとタップ2回になるため、
 * 支払者の選択はこれを使う（設計書 §7.1）。
 */
export function Toggle({ options, value, onChange, label }: Props) {
  return (
    <div role="radiogroup" aria-label={label} className="toggle">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={option.value === value ? "toggle-option is-active" : "toggle-option"}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
```

`apps/web/src/components/ErrorBanner.tsx`:

```tsx
import { ApiError } from "../lib/api.js";

export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;

  const message =
    error instanceof ApiError ? error.message : "予期しないエラーが発生しました。";

  return (
    <div role="alert" className="banner banner-danger">
      {message}
    </div>
  );
}
```

- [x] **Step 2: 対応する CSS を追記する**

`apps/web/src/styles.css` の末尾に追記:

```css
.btn {
  display: block;
  width: 100%;
  min-height: 44px;
  padding: 14px;
  border: none;
  border-radius: 12px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  text-align: center;
  text-decoration: none;
  transition: opacity 0.15s, background 0.15s;
}

.btn:active {
  opacity: 0.8;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--accent);
  color: #fff;
}

.btn-secondary {
  background: #f0f0f0;
  color: var(--text-sub);
}

.btn-danger {
  background: var(--danger-bg);
  color: var(--danger);
}

.btn-success {
  background: var(--success-bg);
  color: var(--success);
}

.btn-sm {
  display: inline-block;
  width: auto;
  min-height: 44px;
  padding: 6px 14px;
  font-size: 0.85rem;
  border-radius: 8px;
}

.toggle {
  display: flex;
  gap: 8px;
}

.toggle-option {
  flex: 1;
  min-height: 44px;
  padding: 10px;
  border: 1.5px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--surface);
  color: var(--text-sub);
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
}

.toggle-option.is-active {
  border-color: var(--accent);
  background: var(--accent-bg);
  color: var(--accent);
}

.banner {
  border-radius: 12px;
  padding: 12px 14px;
  font-size: 0.9rem;
  margin-bottom: 12px;
}

.banner-danger {
  background: var(--danger-bg);
  color: var(--danger);
}

.banner-warn {
  background: #fef3c7;
  color: #b45309;
}

.list-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 0;
  border-bottom: 1px solid #f0f0f0;
}

.list-row:last-child {
  border-bottom: none;
}

.grow {
  flex: 1;
  min-width: 0;
}

.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.amount {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.muted {
  color: var(--text-muted);
  font-size: 0.8rem;
}
```

- [x] **Step 3: 仮の画面コンポーネントを6つ作る**

いずれも後続タスクで中身を入れる。ここでは見出しだけ置く。

`apps/web/src/routes/Home.tsx`:

```tsx
export function Home() {
  return <h1>割り勘</h1>;
}
```

`apps/web/src/routes/MonthlyRecord.tsx`:

```tsx
export function MonthlyRecord() {
  return <h1>月次の記録</h1>;
}
```

`apps/web/src/routes/MonthlyResult.tsx`:

```tsx
export function MonthlyResult() {
  return <h1>月次の精算</h1>;
}
```

`apps/web/src/routes/EventNew.tsx`:

```tsx
export function EventNew() {
  return <h1>新しい割り勘</h1>;
}
```

`apps/web/src/routes/EventInput.tsx`:

```tsx
export function EventInput() {
  return <h1>金額の入力</h1>;
}
```

`apps/web/src/routes/EventDetail.tsx`:

```tsx
export function EventDetail() {
  return <h1>精算結果</h1>;
}
```

- [x] **Step 4: ルートを定義する**

`apps/web/src/App.tsx` を次に置き換える:

```tsx
import { Navigate, Route, Routes } from "react-router";

import { todayYm } from "./lib/ym.js";
import { EventDetail } from "./routes/EventDetail.js";
import { EventInput } from "./routes/EventInput.js";
import { EventNew } from "./routes/EventNew.js";
import { Home } from "./routes/Home.js";
import { MonthlyRecord } from "./routes/MonthlyRecord.js";
import { MonthlyResult } from "./routes/MonthlyResult.js";

export function App() {
  return (
    <div className="container">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/monthly" element={<Navigate to={`/monthly/${todayYm()}`} replace />} />
        <Route path="/monthly/:ym" element={<MonthlyRecord />} />
        <Route path="/monthly/:ym/result" element={<MonthlyResult />} />
        <Route path="/events/new" element={<EventNew />} />
        <Route path="/events/new/input" element={<EventInput />} />
        <Route path="/events/:id" element={<EventDetail />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
```

- [x] **Step 5: main.tsx に Provider を組む**

`apps/web/src/main.tsx` を次に置き換える:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";

import { App } from "./App.js";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 金額を扱うので、古い値を長く見せない。
      staleTime: 0,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

const root = document.getElementById("root");
if (!root) throw new Error("#root が見つかりません");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
```

- [x] **Step 6: スモークテストをルーター対応に書き換える**

`apps/web/src/smoke.test.tsx` を次に置き換える:

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { App } from "./App.js";

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );

describe("ルーティング", () => {
  it("/ でホームを表示する", () => {
    renderAt("/");

    expect(screen.getByRole("heading", { name: "割り勘" })).toBeInTheDocument();
  });

  it("/monthly/2026-08 で記録画面を表示する", () => {
    renderAt("/monthly/2026-08");

    expect(screen.getByRole("heading", { name: "月次の記録" })).toBeInTheDocument();
  });

  it("/monthly/2026-08/result で精算画面を表示する", () => {
    renderAt("/monthly/2026-08/result");

    expect(screen.getByRole("heading", { name: "月次の精算" })).toBeInTheDocument();
  });

  it("/events/new でウィザードを表示する", () => {
    renderAt("/events/new");

    expect(screen.getByRole("heading", { name: "新しい割り勘" })).toBeInTheDocument();
  });

  it("知らないパスはホームに飛ばす", () => {
    renderAt("/nope");

    expect(screen.getByRole("heading", { name: "割り勘" })).toBeInTheDocument();
  });
});
```

- [x] **Step 7: テストを実行する**

Run: `npm test -w @warikan/web`
Expected: PASS（api 8 + format 10 + ym 18 + ルーティング 5 = 41 tests。smoke 1 は置き換えられて消える）

- [x] **Step 8: 型チェックとコミット**

```bash
npm run typecheck -w @warikan/web
```

```bash
git add apps/web
git commit -m "feat: 共通コンポーネントとルーターの骨格を追加"
```

---

## Task 6: 月次のデータ取得フック

**実施時の判断と実測（計画のコード自体は修正不要だった）:**

1. **計画は Task 6 にテストを置いていなかったが、5件追加した。** 計画は「TanStack Query への委譲だけで独自ロジックが無い」としていたが、invalidate 対象の選択は独自の判断であり、`queryKeys.ts` のコメント自身が「取り違えると金額が古いまま表示される」と書いている。`## テストの方針` の「壊れたときに気づきにくく、E2E では検知が遅れるもの」に該当するため `apps/web/src/features/monthly/queries.test.tsx` を追加した。

2. **クエリキーの前方一致（実測）**: `invalidateQueries({ queryKey: ["monthly", ym] })` は `["monthly", ym, "result"]` **も巻き込む**（既定は `exact: false` の前方一致）。逆に `["monthly", ym, "result"]` の invalidate は `["monthly", ym]` を**巻き込まない**。この非対称性が要点で、**精算結果だけを invalidate すると期間の `status` / `isDirty` が古いまま残る**。だから `useSettle` は `useExpenseMutation` を使う必要がある。`useExpenseMutation` の2本目 `invalidateQueries(monthlyResult)` は形式上は冗長だが、意図を明示するため残した。

3. **ミューテーションで検証済み**: `useSettle` を「精算結果だけ invalidate」に落とすと1件、`useExpenseMutation` から `monthly` の invalidate を削ると2件、`useToggleTransfer` の対象を `monthly` に変えると1件が落ちる。

4. **API パス9本はすべて実装と一致していた**（`apps/api/src/routes/monthly.ts` の該当行と `apps/api/test/` の実際の呼び出しの両方で照合）。Task 3〜5 のような不備はなかった。

5. **`useUpdateExpense` は全フィールド上書き。** サーバー側は `Partial` マージだが、フックの型 `ExpenseInput & { id: string }` は全5フィールド必須。Task 7 で部分更新の UI を作るならこの点に注意。

**Files:**
- Create: `apps/web/src/features/monthly/queries.ts`
- Create: `apps/web/src/lib/queryKeys.ts`
- Create: `apps/web/src/features/monthly/queries.test.tsx`（計画外。上記1を参照）

**Interfaces:**
- Consumes: `apiGet` / `apiSend`（Task 3）、`lib/types.ts` の型
- Produces:
  - `queryKeys.monthly(ym)` / `queryKeys.monthlyResult(ym)` / `queryKeys.events()` / `queryKeys.event(id)` / `queryKeys.me()` / `queryKeys.categories()`
  - `useMe()` / `useCategories()`
  - `useMonthly(ym)` / `useMonthlyResult(ym)`
  - `useAddExpense(ym)` / `useUpdateExpense(ym)` / `useDeleteExpense(ym)`
  - `useSettle(ym)` / `useToggleTransfer(ym)`

- [x] **Step 1: クエリキーを1か所に集める**

`apps/web/src/lib/queryKeys.ts`:

```ts
/**
 * invalidate の対象を取り違えると、金額が古いまま表示される。
 * キーは必ずここから取る。文字列を直に書かない。
 */
export const queryKeys = {
  me: () => ["me"] as const,
  categories: () => ["categories"] as const,
  monthly: (ym: string) => ["monthly", ym] as const,
  monthlyResult: (ym: string) => ["monthly", ym, "result"] as const,
  events: () => ["events"] as const,
  event: (id: string) => ["events", id] as const,
};
```

- [x] **Step 2: 月次のフックを書く**

`apps/web/src/features/monthly/queries.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiGet, apiSend } from "../../lib/api.js";
import { queryKeys } from "../../lib/queryKeys.js";
import type {
  Category,
  Expense,
  Me,
  MonthlyDetail,
  MonthlyResult,
  Snapshot,
} from "../../lib/types.js";

export const useMe = () =>
  useQuery({ queryKey: queryKeys.me(), queryFn: () => apiGet<Me>("/api/me") });

export const useCategories = () =>
  useQuery({
    queryKey: queryKeys.categories(),
    queryFn: () => apiGet<Category[]>("/api/categories"),
    // マスタなので頻繁に変わらない
    staleTime: 5 * 60 * 1000,
  });

export const useMonthly = (ym: string) =>
  useQuery({
    queryKey: queryKeys.monthly(ym),
    queryFn: () => apiGet<MonthlyDetail>(`/api/monthly/${ym}`),
  });

export const useMonthlyResult = (ym: string) =>
  useQuery({
    queryKey: queryKeys.monthlyResult(ym),
    queryFn: () => apiGet<MonthlyResult>(`/api/monthly/${ym}/result`),
    // 未計算なら 404。エラーとして扱い、画面側で「まだ計算されていません」を出す。
    retry: false,
  });

export type ExpenseInput = {
  paidBy: string;
  amount: number;
  itemName: string;
  categoryId: number | null;
  spentOn: string;
};

/**
 * 支出を変えると期間の is_dirty と精算結果の両方が変わる。
 * 楽観更新はせず、成功後に両方を invalidate する（設計書 §7.3）。
 */
function useExpenseMutation<TVariables>(
  ym: string,
  mutationFn: (variables: TVariables) => Promise<unknown>,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.monthly(ym) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.monthlyResult(ym) }),
      ]);
    },
  });
}

export const useAddExpense = (ym: string) =>
  useExpenseMutation(ym, (input: ExpenseInput) =>
    apiSend<Expense>("POST", `/api/monthly/${ym}/expenses`, input),
  );

export const useUpdateExpense = (ym: string) =>
  useExpenseMutation(ym, ({ id, ...patch }: ExpenseInput & { id: string }) =>
    apiSend<Expense>("PATCH", `/api/monthly/expenses/${id}`, patch),
  );

export const useDeleteExpense = (ym: string) =>
  useExpenseMutation(ym, (id: string) =>
    apiSend<{ id: string }>("DELETE", `/api/monthly/expenses/${id}`),
  );

export const useSettle = (ym: string) =>
  useExpenseMutation(ym, () => apiSend<Snapshot>("POST", `/api/monthly/${ym}/settle`));

export const useToggleTransfer = (ym: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ index, isPaid }: { index: number; isPaid: boolean }) =>
      apiSend<Snapshot>("PATCH", `/api/monthly/${ym}/result/transfers/${index}`, { isPaid }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.monthlyResult(ym) });
    },
  });
};
```

- [x] **Step 3: 型チェックを通す**

Run: `npm run typecheck -w @warikan/web`
Expected: エラーなし

このタスクにテストは書かない。中身は TanStack Query への委譲だけで、独自ロジックが無い。実際の結線は Task 7・8 の画面テストと Plan 3 の E2E で確かめる。

- [x] **Step 4: コミット**

```bash
git add apps/web
git commit -m "feat: 月次のデータ取得フックを追加"
```

---

## Task 7: 月次の記録画面

このタスクの中心は**フォームの保持挙動**。設計書 §7.1 の「送信後、金額と品目名だけクリアし、支払者・カテゴリ・日付は直前の値を保持する」を満たす。レシートを見ながら連続入力するときに、毎回3項目を選び直すのは実用に耐えないため。

**実施時に判明した不具合と、検証で分かったこと:**

1. **カテゴリの既定値が非決定だった（修正済み）。** `useState(categories[0]?.id ?? null)` は初回描画時にしか評価されない。`useCategories` は `useMe` とは別クエリなので、`me` が先に解決するとカテゴリが空のままフォームが描画され、**既定が「未分類」に固定されて二度と動かない**。実測で確認（空で描画 → カテゴリ到着後も `value=""` / 表示「未分類」のまま）。どちらのクエリが先に解決するかで既定カテゴリが変わる、再現しにくい不具合。未選択を `undefined` で持ち、表示値は毎回 `categories[0]` から導く形に直した（利用者が選んだ後は state が優先される）。回帰テストを2件追加。

2. **設計書 §7.1「送信後に支払者・カテゴリ・日付が残る」はテストで本当に守られている（両方向のミューテーションで確認）。**
   - 送信後に支払者・カテゴリ・日付もリセットする版 → 1件 FAIL
   - 金額と品目もリセットしない版 → 1件 FAIL
   上記1の修正後も同じミューテーションが落ちることを再確認済み。

3. **`<input type="date">` は `userEvent.type` で入力できない**（テストのコメントに実測が残っている）。1文字ずつ打つと jsdom が中間状態を不正な日付として弾き、React が state から書き戻して空のままになる。`fireEvent.change` で「妥当な値1回分の change」を送ること。実ブラウザのピッカー操作もそう届く。

4. **支払者トグルの制約は画面を壊さない。** 相手がまだ記録していない月では候補が「自分」1件だけになるが、`defaultPaidBy` は常に自分の userId なので不正な値は送られない。表示名が「パートナー」固定になる点は `## 既知の制約` のとおりで、Plan 3 の `GET /api/users` で解消する。

5. **`ErrorBanner` は `ApiError.fields` を表示しない。** どの項目が悪いかは画面に出ず、サーバーのメッセージ本文だけが出る。計画がそこまで作っていないため今回は作っていない。実害は小さいが、入力項目が増えたら再検討の余地がある。

6. **Step 5 / Step 8 の期待件数（既存 29 + ExpenseForm 7 = 36）は古い。** Task 4〜6 でテストを増やしたため、実際は web 55 件になる。

**Files:**
- Create: `apps/web/src/features/monthly/ExpenseForm.tsx`
- Create: `apps/web/src/features/monthly/ExpenseList.tsx`
- Create: `apps/web/src/features/monthly/ExpenseForm.test.tsx`
- Modify: `apps/web/src/routes/MonthlyRecord.tsx`

**Interfaces:**
- Consumes: Task 6 のフック、`AmountInput` / `Toggle` / `Button`（Task 5）、`formatYen` / `formatDateLabel`（Task 4）
- Produces:
  - `<ExpenseForm ym users categories defaultPaidBy onSubmit isSubmitting />`
  - `<ExpenseList expenses users categories onDelete deletingId />`

- [x] **Step 1: 失敗するテストを書く**

`apps/web/src/features/monthly/ExpenseForm.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ExpenseForm } from "./ExpenseForm.js";

const users = [
  { userId: "u1", displayName: "自分" },
  { userId: "u2", displayName: "妻" },
];

const categories = [
  { id: 1, name: "食費" },
  { id: 2, name: "日用品" },
];

const setup = (onSubmit = vi.fn()) => {
  render(
    <ExpenseForm
      ym="2026-08"
      users={users}
      categories={categories}
      defaultPaidBy="u1"
      onSubmit={onSubmit}
      isSubmitting={false}
    />,
  );
  return { onSubmit, user: userEvent.setup() };
};

const fill = async (user: ReturnType<typeof userEvent.setup>, amount: string, item: string) => {
  await user.clear(screen.getByLabelText("金額"));
  await user.type(screen.getByLabelText("金額"), amount);
  await user.clear(screen.getByLabelText("品目"));
  await user.type(screen.getByLabelText("品目"), item);
};

describe("ExpenseForm", () => {
  it("入力して送信すると整数の金額で onSubmit が呼ばれる", async () => {
    const { onSubmit, user } = setup();

    await fill(user, "1200", "牛乳と卵");
    await user.click(screen.getByRole("button", { name: "記録する" }));

    expect(onSubmit).toHaveBeenCalledWith({
      paidBy: "u1",
      amount: 1200,
      itemName: "牛乳と卵",
      categoryId: 1,
      spentOn: expect.stringMatching(/^2026-08-\d{2}$/),
    });
  });

  it("送信後に金額と品目だけがクリアされる", async () => {
    const { user } = setup();

    await fill(user, "1200", "牛乳と卵");
    await user.click(screen.getByRole("button", { name: "記録する" }));

    expect(screen.getByLabelText("金額")).toHaveValue(null);
    expect(screen.getByLabelText("品目")).toHaveValue("");
  });

  it("送信後も支払者・カテゴリ・日付は直前の値を保つ", async () => {
    const { onSubmit, user } = setup();

    await user.click(screen.getByRole("radio", { name: "妻" }));
    await user.selectOptions(screen.getByLabelText("カテゴリ"), "2");
    await user.clear(screen.getByLabelText("日付"));
    await user.type(screen.getByLabelText("日付"), "2026-08-20");

    await fill(user, "500", "ティッシュ");
    await user.click(screen.getByRole("button", { name: "記録する" }));

    // 2回目の入力で選び直さなくてよいこと
    expect(screen.getByRole("radio", { name: "妻" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("カテゴリ")).toHaveValue("2");
    expect(screen.getByLabelText("日付")).toHaveValue("2026-08-20");

    await fill(user, "300", "洗剤");
    await user.click(screen.getByRole("button", { name: "記録する" }));

    expect(onSubmit).toHaveBeenLastCalledWith({
      paidBy: "u2",
      amount: 300,
      itemName: "洗剤",
      categoryId: 2,
      spentOn: "2026-08-20",
    });
  });

  it("金額が空なら送信できない", async () => {
    const { onSubmit, user } = setup();

    await user.type(screen.getByLabelText("品目"), "牛乳");
    await user.click(screen.getByRole("button", { name: "記録する" }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("品目が空白だけなら送信できない", async () => {
    const { onSubmit, user } = setup();

    await user.type(screen.getByLabelText("金額"), "100");
    await user.type(screen.getByLabelText("品目"), "   ");
    await user.click(screen.getByRole("button", { name: "記録する" }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("日付の入力可能範囲がその月に制限されている", () => {
    setup();

    const date = screen.getByLabelText("日付");
    expect(date).toHaveAttribute("min", "2026-08-01");
    expect(date).toHaveAttribute("max", "2026-08-31");
  });

  it("送信中はボタンを押せない", () => {
    render(
      <ExpenseForm
        ym="2026-08"
        users={users}
        categories={categories}
        defaultPaidBy="u1"
        onSubmit={vi.fn()}
        isSubmitting
      />,
    );

    expect(screen.getByRole("button", { name: "記録中…" })).toBeDisabled();
  });
});
```

- [x] **Step 2: テストを実行して失敗することを確認する**

Run: `npm test -w @warikan/web`
Expected: FAIL — `./ExpenseForm.js` が解決できない

- [x] **Step 3: ExpenseForm を実装する**

`apps/web/src/features/monthly/ExpenseForm.tsx`:

```tsx
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
```

`<label htmlFor>` と `id` を必ず対にすること。テストは `getByLabelText` で引いており、これが崩れると全部落ちる。同時にスクリーンリーダーからも読めなくなる。

`日付` のラベルは `spent-on` を指すため、テストの `getByLabelText("日付")` は `<input type="date">` を掴む。

- [x] **Step 4: `.form-label` の CSS を追記する**

`apps/web/src/styles.css` の末尾に追記:

```css
.form-label {
  display: block;
  font-size: 0.85rem;
  color: var(--text-sub);
  margin-bottom: 5px;
  font-weight: 500;
}
```

- [x] **Step 5: テストを実行して成功することを確認する**

Run: `npm test -w @warikan/web`
Expected: PASS（web 55 tests。上記6を参照）

- [x] **Step 6: ExpenseList を書く**

`apps/web/src/features/monthly/ExpenseList.tsx`:

```tsx
import { Button } from "../../components/Button.js";
import { formatDateLabel, formatYen } from "../../lib/format.js";
import type { Expense } from "../../lib/types.js";

type Props = {
  expenses: Expense[];
  users: { userId: string; displayName: string }[];
  categories: { id: number; name: string }[];
  onDelete: (id: string) => void;
  deletingId: string | null;
};

/** spent_on ごとにまとめる。API は spent_on の降順で返す。 */
function groupByDate(expenses: Expense[]): { date: string; rows: Expense[] }[] {
  const groups: { date: string; rows: Expense[] }[] = [];

  for (const expense of expenses) {
    const last = groups.at(-1);
    if (last && last.date === expense.spentOn) {
      last.rows.push(expense);
    } else {
      groups.push({ date: expense.spentOn, rows: [expense] });
    }
  }

  return groups;
}

export function ExpenseList({ expenses, users, categories, onDelete, deletingId }: Props) {
  if (expenses.length === 0) {
    return (
      <div className="card">
        <p className="sub">まだ記録がありません。</p>
      </div>
    );
  }

  const nameByUser = new Map(users.map((user) => [user.userId, user.displayName]));
  const nameByCategory = new Map(categories.map((category) => [category.id, category.name]));

  return (
    <>
      {groupByDate(expenses).map((group) => (
        <div className="card" key={group.date}>
          <h2>{formatDateLabel(group.date)}</h2>
          {group.rows.map((expense) => (
            <div className="list-row" key={expense.id}>
              <div className="grow">
                <div className="ellipsis">{expense.itemName}</div>
                <div className="muted">
                  {nameByUser.get(expense.paidBy) ?? "不明"}
                  {expense.categoryId === null
                    ? ""
                    : ` ・ ${nameByCategory.get(expense.categoryId) ?? "不明"}`}
                </div>
              </div>
              <div className="amount">{formatYen(expense.amount)}</div>
              <Button
                variant="danger"
                size="sm"
                aria-label={`${expense.itemName} を削除`}
                disabled={deletingId === expense.id}
                onClick={() => onDelete(expense.id)}
              >
                削除
              </Button>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
```

- [x] **Step 7: 記録画面を組み立てる**

`apps/web/src/routes/MonthlyRecord.tsx` を次に置き換える:

```tsx
import { Link, useNavigate, useParams } from "react-router";

import { Button } from "../components/Button.js";
import { ErrorBanner } from "../components/ErrorBanner.js";
import { ExpenseForm } from "../features/monthly/ExpenseForm.js";
import { ExpenseList } from "../features/monthly/ExpenseList.js";
import {
  useAddExpense,
  useCategories,
  useDeleteExpense,
  useMe,
  useMonthly,
} from "../features/monthly/queries.js";
import { formatYen } from "../lib/format.js";
import { shiftYm, todayYm, ymLabel } from "../lib/ym.js";

export function MonthlyRecord() {
  const { ym = todayYm() } = useParams();
  const navigate = useNavigate();

  const me = useMe();
  const categories = useCategories();
  const monthly = useMonthly(ym);
  const addExpense = useAddExpense(ym);
  const deleteExpense = useDeleteExpense(ym);

  const error =
    me.error ?? categories.error ?? monthly.error ?? addExpense.error ?? deleteExpense.error;

  // 支払者の候補は「自分」と「支出に現れたもう一人」から作る。
  // 制約は下の注記を参照。
  const users = me.data ? [{ userId: me.data.userId, displayName: me.data.displayName }] : [];
  const known = new Set(users.map((user) => user.userId));
  for (const expense of monthly.data?.expenses ?? []) {
    if (!known.has(expense.paidBy)) {
      known.add(expense.paidBy);
      users.push({ userId: expense.paidBy, displayName: "パートナー" });
    }
  }

  const total = (monthly.data?.expenses ?? []).reduce((sum, expense) => sum + expense.amount, 0);

  return (
    <>
      <div className="card">
        <div className="list-row">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate(`/monthly/${shiftYm(ym, -1)}`)}
          >
            ← 前月
          </Button>
          <div className="grow" style={{ textAlign: "center" }}>
            <strong>{ymLabel(ym)}</strong>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate(`/monthly/${shiftYm(ym, 1)}`)}
          >
            次月 →
          </Button>
        </div>
        <div className="list-row">
          <div className="grow">今月の合計</div>
          <div className="amount">{formatYen(total)}</div>
        </div>
        <div className="actions">
          <Link className="btn btn-primary" to={`/monthly/${ym}/result`}>
            計算する
          </Link>
          <Link className="btn btn-secondary" to="/">
            ホーム
          </Link>
        </div>
      </div>

      <ErrorBanner error={error} />

      {me.data ? (
        <ExpenseForm
          ym={ym}
          users={users}
          categories={categories.data ?? []}
          defaultPaidBy={me.data.userId}
          isSubmitting={addExpense.isPending}
          onSubmit={(input) => addExpense.mutate(input)}
        />
      ) : null}

      {monthly.isLoading ? (
        <div className="card">
          <p className="sub">読み込み中…</p>
        </div>
      ) : (
        <ExpenseList
          expenses={monthly.data?.expenses ?? []}
          users={users}
          categories={categories.data ?? []}
          deletingId={deleteExpense.isPending ? (deleteExpense.variables ?? null) : null}
          onDelete={(id) => deleteExpense.mutate(id)}
        />
      )}
    </>
  );
}
```

**既知の制約（Task 12 で README に明記する）**: 支払者トグルに出せるのは、ログイン中の自分と「その月の支出に現れたもう一人」だけ。相手がまだ1件も記録していない月では相手を選べず、相手の表示名も「パートナー」の固定文言になる。原因は API に「登録済みユーザー一覧」が無いこと（Plan 1 の `listUsers` はどのルートからも使われていない）。**Plan 3 で `GET /api/users` を追加して解消する。**

- [x] **Step 8: テストと型チェックを通す**

Run: `npm test -w @warikan/web`
Expected: PASS（web 55 tests）

Run: `npm run typecheck -w @warikan/web`
Expected: エラーなし

- [x] **Step 9: コミット**

```bash
git add apps/web
git commit -m "feat: 月次の記録画面を追加"
```

---

## Task 8: 月次の精算結果画面

**実施時に判明したこと（実測とミューテーションで確認）:**

1. **`is_dirty` の警告出し分けはテストで本当に守られている。** 両方向のミューテーションで確認済み。警告を常に出さない版 → 1件 FAIL、常に出す版 → 1件 FAIL。消し込みの向き（`!transfer.isPaid` → `transfer.isPaid`）でも2件 FAIL。

2. **送金の消し込みボタンに名前が無く、並べ替えの不具合を誰も検知できなかった（修正済み）。** API は `PATCH .../transfers/{index}` で**配列の位置**を指す。表示側で並べ替えると別の送金を消し込むが、ボタン名が全行「支払い済みにする」で同一だったため、読み上げでも自動テストでも行を区別できなかった。実際、逆順表示のミューテーションを入れても**位置で選ぶテストは通ってしまう**（「n 番目のボタンに n が渡る」は逆順でも成り立つため）。`aria-label` に「誰から誰への何円か」を含め、テストも名前で選ぶ形に直した。これで逆順ミューテーション・`aria-label` 削除の両方が落ちる。月次は2人固定で送金は1件以下なので今日の実害は無いが、index を渡す契約をここで固定した。

3. **未計算の月（404）は計画がきちんと扱っている。** `useMonthlyResult` が `retry: false`、ルート側で `ApiError` の status 404 を `notCalculated` と判定し、`ErrorBanner` を抑止して「まだ計算していません。「計算する」を押してください。」を出す。作り込み不要だった。

4. **「各人の過不足」は表示しない。** `Snapshot.byUser` は `share` を持つが、画面に出すのは `paid` だけ。設計書 §7.2 のワイヤも `paid` のみなので計画どおり。

5. **Step 5 が `smoke.test.tsx` の更新を書いていない。** `MonthlyResult` を実装に置き換えると仮見出し「月次の精算」が消え、ルーティングテストが1件落ちる。Task 7 の `MonthlyRecord` と同じく、実際の見出し（`:ym` を解釈した「2026年8月の精算」）を見る形に変更した。

6. **`ResultView` / `MonthlyResult` は `useState` を持たない**ため、Task 7 の「クエリ結果を初期値に固定して非決定になる」不具合は構造上起きない。

7. **Step 4 の期待件数 45 は古い。** 実際は web 65 件（計画の 9 件 + index の契約テスト 1 件）。

**Files:**
- Create: `apps/web/src/features/monthly/ResultView.tsx`
- Create: `apps/web/src/features/monthly/ResultView.test.tsx`
- Modify: `apps/web/src/routes/MonthlyResult.tsx`

**Interfaces:**
- Consumes: Task 6 のフック、`formatYen` / `percent`（Task 4）
- Produces: `<ResultView snapshot isDirty isBusy onRecalculate onToggleTransfer />`

- [x] **Step 1: 失敗するテストを書く**

`apps/web/src/features/monthly/ResultView.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Snapshot } from "../../lib/types.js";
import { ResultView } from "./ResultView.js";

const snapshot: Snapshot = {
  total: 84300,
  perPerson: 42150,
  byUser: [
    { userId: "u1", displayName: "自分", paid: 51000, share: 42150 },
    { userId: "u2", displayName: "妻", paid: 33300, share: 42150 },
  ],
  byCategory: [
    { categoryId: 1, name: "食費", amount: 32000 },
    { categoryId: 2, name: "日用品", amount: 18500 },
  ],
  transfers: [{ fromId: "u2", toId: "u1", amount: 8850, isPaid: false }],
  settledAt: "2026-08-31T12:00:00.000Z",
};

const setup = (overrides: { snapshot?: Snapshot; isDirty?: boolean } = {}) => {
  const onRecalculate = vi.fn();
  const onToggleTransfer = vi.fn();

  render(
    <ResultView
      snapshot={overrides.snapshot ?? snapshot}
      isDirty={overrides.isDirty ?? false}
      isBusy={false}
      onRecalculate={onRecalculate}
      onToggleTransfer={onToggleTransfer}
    />,
  );

  return { onRecalculate, onToggleTransfer, user: userEvent.setup() };
};

describe("ResultView", () => {
  it("合計と一人あたりを表示する", () => {
    setup();

    expect(screen.getByText("¥84,300")).toBeInTheDocument();
    expect(screen.getByText("¥42,150")).toBeInTheDocument();
  });

  it("カテゴリ別の金額と割合を出す", () => {
    setup();

    expect(screen.getByText("食費")).toBeInTheDocument();
    expect(screen.getByText("¥32,000")).toBeInTheDocument();
    // 32000 / 84300 = 37.96% → 38%
    expect(screen.getByText("38%")).toBeInTheDocument();
  });

  it("各人の支払額を出す", () => {
    setup();

    expect(screen.getByText("¥51,000")).toBeInTheDocument();
    expect(screen.getByText("¥33,300")).toBeInTheDocument();
  });

  it("送金を「誰から誰へ」で出す", () => {
    setup();

    expect(screen.getByText(/妻 → 自分/)).toBeInTheDocument();
    expect(screen.getByText("¥8,850")).toBeInTheDocument();
  });

  it("支払い済みに切り替えると index と isPaid を渡す", async () => {
    const { onToggleTransfer, user } = setup();

    await user.click(screen.getByRole("button", { name: "支払い済みにする" }));

    expect(onToggleTransfer).toHaveBeenCalledWith(0, true);
  });

  it("支払い済みなら未払いに戻せる", async () => {
    const paid: Snapshot = {
      ...snapshot,
      transfers: [{ fromId: "u2", toId: "u1", amount: 8850, isPaid: true }],
    };
    const { onToggleTransfer, user } = setup({ snapshot: paid });

    await user.click(screen.getByRole("button", { name: "未払いに戻す" }));

    expect(onToggleTransfer).toHaveBeenCalledWith(0, false);
  });

  it("isDirty が false なら警告を出さない", () => {
    setup();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("isDirty が true なら警告と再計算ボタンを出す", async () => {
    const { onRecalculate, user } = setup({ isDirty: true });

    expect(screen.getByRole("alert")).toHaveTextContent("記録が変わっています");

    await user.click(screen.getByRole("button", { name: "再計算する" }));
    expect(onRecalculate).toHaveBeenCalled();
  });

  it("送金が無い月は精算不要と出す", () => {
    setup({ snapshot: { ...snapshot, transfers: [] } });

    expect(screen.getByText("精算は不要です")).toBeInTheDocument();
  });
});
```

- [x] **Step 2: テストを実行して失敗することを確認する**

Run: `npm test -w @warikan/web`
Expected: FAIL — `./ResultView.js` が解決できない

- [x] **Step 3: ResultView を実装する**

`apps/web/src/features/monthly/ResultView.tsx`:

```tsx
import { Button } from "../../components/Button.js";
import { formatYen, percent } from "../../lib/format.js";
import type { Snapshot } from "../../lib/types.js";

type Props = {
  snapshot: Snapshot;
  isDirty: boolean;
  isBusy: boolean;
  onRecalculate: () => void;
  onToggleTransfer: (index: number, isPaid: boolean) => void;
};

export function ResultView({ snapshot, isDirty, isBusy, onRecalculate, onToggleTransfer }: Props) {
  const nameByUser = new Map(snapshot.byUser.map((entry) => [entry.userId, entry.displayName]));

  return (
    <>
      {isDirty ? (
        <div role="alert" className="banner banner-warn">
          計算したあとに記録が変わっています。金額が古い可能性があります。
          <div style={{ marginTop: 10 }}>
            <Button size="sm" disabled={isBusy} onClick={onRecalculate}>
              再計算する
            </Button>
          </div>
        </div>
      ) : null}

      <div className="card">
        <div className="list-row">
          <div className="grow">今月の合計</div>
          <div className="amount">{formatYen(snapshot.total)}</div>
        </div>
        <div className="list-row">
          <div className="grow">一人あたり</div>
          <div className="amount">{formatYen(snapshot.perPerson)}</div>
        </div>
      </div>

      <div className="card">
        <h2>カテゴリ別内訳</h2>
        {snapshot.byCategory.length === 0 ? (
          <p className="sub">記録がありません。</p>
        ) : (
          snapshot.byCategory.map((entry) => (
            <div className="list-row" key={String(entry.categoryId ?? "none")}>
              <div className="grow ellipsis">{entry.name}</div>
              <div className="amount">{formatYen(entry.amount)}</div>
              <div className="muted">{percent(entry.amount, snapshot.total)}%</div>
            </div>
          ))
        )}
      </div>

      <div className="card">
        <h2>支払い状況</h2>
        {snapshot.byUser.map((entry) => (
          <div className="list-row" key={entry.userId}>
            <div className="grow ellipsis">{entry.displayName}</div>
            <div className="amount">{formatYen(entry.paid)}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>精算</h2>
        {snapshot.transfers.length === 0 ? (
          <p className="sub">精算は不要です</p>
        ) : (
          snapshot.transfers.map((transfer, index) => (
            <div className="list-row" key={`${transfer.fromId}-${transfer.toId}-${index}`}>
              <div className="grow">
                💸 {nameByUser.get(transfer.fromId) ?? "?"} → {nameByUser.get(transfer.toId) ?? "?"}
              </div>
              <div className="amount">{formatYen(transfer.amount)}</div>
              <Button
                variant={transfer.isPaid ? "success" : "secondary"}
                size="sm"
                disabled={isBusy}
                onClick={() => onToggleTransfer(index, !transfer.isPaid)}
              >
                {transfer.isPaid ? "未払いに戻す" : "支払い済みにする"}
              </Button>
            </div>
          ))
        )}
      </div>
    </>
  );
}
```

- [x] **Step 4: テストを実行して成功することを確認する**

Run: `npm test -w @warikan/web`
Expected: PASS（web 65 tests。上記7を参照）

- [x] **Step 5: 精算画面を組み立てる**

`apps/web/src/routes/MonthlyResult.tsx` を次に置き換える:

```tsx
import { Link, useParams } from "react-router";

import { Button } from "../components/Button.js";
import { ErrorBanner } from "../components/ErrorBanner.js";
import { ResultView } from "../features/monthly/ResultView.js";
import { useMonthlyResult, useSettle, useToggleTransfer } from "../features/monthly/queries.js";
import { ApiError } from "../lib/api.js";
import { todayYm, ymLabel } from "../lib/ym.js";

export function MonthlyResult() {
  const { ym = todayYm() } = useParams();

  const result = useMonthlyResult(ym);
  const settle = useSettle(ym);
  const toggleTransfer = useToggleTransfer(ym);

  // 未計算の月は 404 が返る。これはエラーではなく「まだ押していない」状態。
  const notCalculated = result.error instanceof ApiError && result.error.status === 404;
  const isBusy = settle.isPending || toggleTransfer.isPending;

  return (
    <>
      <div className="card">
        <h1>{ymLabel(ym)}の精算</h1>
        <div className="actions">
          <Button disabled={isBusy} onClick={() => settle.mutate(undefined)}>
            {settle.isPending ? "計算中…" : "計算する"}
          </Button>
          <Link className="btn btn-secondary" to={`/monthly/${ym}`}>
            記録に戻る
          </Link>
        </div>
      </div>

      {notCalculated ? null : (
        <ErrorBanner error={result.error ?? settle.error ?? toggleTransfer.error} />
      )}

      {result.isLoading ? (
        <div className="card">
          <p className="sub">読み込み中…</p>
        </div>
      ) : null}

      {notCalculated ? (
        <div className="card">
          <p className="sub">まだ計算していません。「計算する」を押してください。</p>
        </div>
      ) : null}

      {result.data ? (
        <ResultView
          snapshot={result.data.snapshot}
          isDirty={result.data.isDirty}
          isBusy={isBusy}
          onRecalculate={() => settle.mutate(undefined)}
          onToggleTransfer={(index, isPaid) => toggleTransfer.mutate({ index, isPaid })}
        />
      ) : null}
    </>
  );
}
```

- [x] **Step 6: 型チェックとコミット**

```bash
npm run typecheck -w @warikan/web
```

```bash
git add apps/web
git commit -m "feat: 月次の精算結果画面と is_dirty 警告を追加"
```

---

## Task 9: 単発割り勘のウィザード状態

現行 Flask の step1 → step2 → step3 に相当する。旧実装はウィザードの途中状態を Cookie に持っていたため、別タブで開くと壊れ、容量制限にも当たっていた（[docs/app-analysis.md](../../app-analysis.md) の既知の問題）。ここではクライアントの `useReducer` に持ち、確定時に1回だけ POST する。

状態遷移だけを純関数として切り出し、テストする。React に依存させない。

**実施時に判明した不備（すべてミューテーションで確認）:**

1. **メンバー削除で品目の支払者がすり替わる経路がテストされていなかった（テスト追加で解消）。** 品目は支払者を配列の index で参照するため、メンバーを消すと後ろの index がずれる。計画の実装は補正しているが、**テストは「消したメンバー自身が支払者だった」等値の経路しか通しておらず**、`paidByIndex > 削除index` のシフト経路は素通しだった。実際、シフト補正を丸ごと削るミューテーションが**生き残った**。支払者より前のメンバーを消すと品目が別人の支払いになる、金額の帰属が狂う不具合。支払者を index ではなく**名前で検証する**テストを2件追加して解消。
   - なお `item.paidByIndex > action.index` の `>` を `>=` にするミューテーションは生き残るが、これは等値ケースが直前の分岐で early return されるため**等価変異**であり、テストの穴ではない。

2. **不変性のテストが皆無だった（テスト追加で解消）。** reducer 自体は `push` / `splice` / 代入を使っていないが、それを守る仕組みが無かった。入力 state を deep-freeze して全12アクションを通すテストと、同じ `(state, action)` が2回とも等しい結果を返す決定性テストを追加。`addMember` を `push` に、`removeMember` を `splice` に、`setMemberName` を代入に変えるミューテーションが、いずれもこの追加分によってのみ落ちる。

3. **金額未入力の品目が ¥0 として黙って登録される（修正済み）。** `wizardErrors` は品目名の空欄を弾くのに**金額の空欄を検査していなかった**。未入力（`""`）は `toCreatePayload` で `0` に変換され、API の zod（`amount: z.number().int().min(0)`）も通す。合計が変わらないぶん気づきにくい。`品目の金額を入力してください` を追加した。0 の明示的な入力は通す（0円の記録は妨げない）。

**計画が扱っていない境界（報告のみ。仕様を足していない）:**

| 項目 | ウィザード側 | API 側 | 起きること |
|---|---|---|---|
| 品目数 | 上限なし | `items.max(200)` | 201件目以降で 400 |
| 参加者名の長さ | 上限なし | `name.max(30)` | 31文字以上で 400 |
| タイトルの長さ | 上限なし | `title.max(60)` | 61文字以上で 400 |
| 金額の上限 | 検査なし | `.max(10_000_000)` | 超過で 400 |

いずれも `ErrorBanner` にサーバーの汎用メッセージしか出ない（Task 7 の所見5と同根）。

**確認して問題なかったもの:** `toCreatePayload` のキーは `POST /api/events` の zod と完全一致。1人のとき削除不可・上限20人・空白だけの名前を弾く、はいずれも計画どおり動く。`paidByIndex` は常に範囲内に保たれるので API 側の範囲チェックには当たらない。

**Step 4 の期待件数 62 は二重に古い**（既存が 65 で、かつ追加分がある）。実際は web 99 件。

**Files:**
- Create: `apps/web/src/features/events/wizardReducer.ts`
- Create: `apps/web/src/features/events/wizardReducer.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `type WizardState = { title: string; mode: EventMode; members: MemberDraft[]; items: ItemDraft[] }`
  - `initialWizardState(): WizardState`
  - `wizardReducer(state, action): WizardState`
  - `toCreatePayload(state): CreateEventPayload`
  - `wizardErrors(state): string[]`

- [x] **Step 1: 失敗するテストを書く**

`apps/web/src/features/events/wizardReducer.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  initialWizardState,
  toCreatePayload,
  wizardErrors,
  wizardReducer,
} from "./wizardReducer.js";
import type { WizardState } from "./wizardReducer.js";

const reduce = (state: WizardState, ...actions: Parameters<typeof wizardReducer>[1][]) =>
  actions.reduce(wizardReducer, state);

describe("initialWizardState", () => {
  it("2人ぶんの空メンバーから始まる", () => {
    const state = initialWizardState();

    expect(state.mode).toBe("simple");
    expect(state.members).toHaveLength(2);
    expect(state.members.every((member) => member.name === "")).toBe(true);
  });
});

describe("メンバーの増減", () => {
  it("追加できる", () => {
    const state = reduce(initialWizardState(), { type: "addMember" });

    expect(state.members).toHaveLength(3);
  });

  it("20人を超えて追加できない", () => {
    let state = initialWizardState();
    for (let i = 0; i < 30; i += 1) state = wizardReducer(state, { type: "addMember" });

    expect(state.members).toHaveLength(20);
  });

  it("削除できる", () => {
    const state = reduce(initialWizardState(), { type: "addMember" }, { type: "removeMember", index: 0 });

    expect(state.members).toHaveLength(2);
  });

  it("1人未満にはできない", () => {
    const state = reduce(
      initialWizardState(),
      { type: "removeMember", index: 0 },
      { type: "removeMember", index: 0 },
      { type: "removeMember", index: 0 },
    );

    expect(state.members).toHaveLength(1);
  });

  it("メンバーを消すと、その人が支払っていた品目の支払者が先頭に寄る", () => {
    let state = reduce(
      initialWizardState(),
      { type: "setMemberName", index: 0, name: "田中" },
      { type: "setMemberName", index: 1, name: "佐藤" },
      { type: "setMode", mode: "items" },
      { type: "addItem" },
      { type: "setItemPaidBy", index: 0, paidByIndex: 1 },
    );

    expect(state.items[0]?.paidByIndex).toBe(1);

    state = wizardReducer(state, { type: "removeMember", index: 1 });

    // 参照先が消えたら 0 に落とす。範囲外の index を送ると API が 400 を返すため。
    expect(state.items[0]?.paidByIndex).toBe(0);
  });
});

describe("品目の編集", () => {
  it("追加と削除ができる", () => {
    let state = reduce(initialWizardState(), { type: "setMode", mode: "items" }, { type: "addItem" });
    expect(state.items).toHaveLength(1);

    state = wizardReducer(state, { type: "removeItem", index: 0 });
    expect(state.items).toHaveLength(0);
  });

  it("金額は整数のみ保持する", () => {
    const state = reduce(
      initialWizardState(),
      { type: "setMode", mode: "items" },
      { type: "addItem" },
      { type: "setItemAmount", index: 0, amount: 20000 },
    );

    expect(state.items[0]?.amount).toBe(20000);
  });
});

describe("wizardErrors", () => {
  it("名前が空なら弾く", () => {
    const state = initialWizardState();

    expect(wizardErrors(state)).toContain("参加者の名前を入力してください");
  });

  it("simple で全員の名前が入っていれば通る", () => {
    const state = reduce(
      initialWizardState(),
      { type: "setMemberName", index: 0, name: "田中" },
      { type: "setMemberName", index: 1, name: "佐藤" },
    );

    expect(wizardErrors(state)).toEqual([]);
  });

  it("items で品目が0件なら弾く", () => {
    const state = reduce(
      initialWizardState(),
      { type: "setMemberName", index: 0, name: "田中" },
      { type: "setMemberName", index: 1, name: "佐藤" },
      { type: "setMode", mode: "items" },
    );

    expect(wizardErrors(state)).toContain("品目を1件以上追加してください");
  });

  it("items で品目名が空なら弾く", () => {
    const state = reduce(
      initialWizardState(),
      { type: "setMemberName", index: 0, name: "田中" },
      { type: "setMemberName", index: 1, name: "佐藤" },
      { type: "setMode", mode: "items" },
      { type: "addItem" },
      { type: "setItemAmount", index: 0, amount: 100 },
    );

    expect(wizardErrors(state)).toContain("品目名を入力してください");
  });

  it("同名の参加者がいても通る", () => {
    const state = reduce(
      initialWizardState(),
      { type: "setMemberName", index: 0, name: "田中" },
      { type: "setMemberName", index: 1, name: "田中" },
    );

    // 旧 Flask は名前でメンバーを識別していたため破綻したが、
    // 現行 API は id で識別するので許容する。
    expect(wizardErrors(state)).toEqual([]);
  });
});

describe("toCreatePayload", () => {
  it("simple は入力した paid をそのまま送る", () => {
    const state = reduce(
      initialWizardState(),
      { type: "setTitle", title: "飲み会" },
      { type: "setMemberName", index: 0, name: "田中" },
      { type: "setMemberPaid", index: 0, paid: 10000 },
      { type: "setMemberName", index: 1, name: "佐藤" },
      { type: "setMemberPaid", index: 1, paid: 2000 },
    );

    expect(toCreatePayload(state)).toEqual({
      title: "飲み会",
      mode: "simple",
      members: [
        { name: "田中", paid: 10000 },
        { name: "佐藤", paid: 2000 },
      ],
      items: [],
    });
  });

  it("items は paid を 0 にして品目を送る（サーバー側で合算される）", () => {
    const state = reduce(
      initialWizardState(),
      { type: "setMemberName", index: 0, name: "田中" },
      { type: "setMemberPaid", index: 0, paid: 999 },
      { type: "setMemberName", index: 1, name: "佐藤" },
      { type: "setMode", mode: "items" },
      { type: "addItem" },
      { type: "setItemName", index: 0, name: "宿代" },
      { type: "setItemAmount", index: 0, amount: 20000 },
    );

    expect(toCreatePayload(state)).toEqual({
      title: "",
      mode: "items",
      members: [
        { name: "田中", paid: 0 },
        { name: "佐藤", paid: 0 },
      ],
      items: [{ name: "宿代", amount: 20000, paidByIndex: 0 }],
    });
  });

  it("名前と品目名の前後の空白を落とす", () => {
    const state = reduce(
      initialWizardState(),
      { type: "setMemberName", index: 0, name: "  田中  " },
      { type: "setMemberName", index: 1, name: "佐藤" },
    );

    expect(toCreatePayload(state).members[0]?.name).toBe("田中");
  });

  it("未入力の金額は 0 として送る", () => {
    const state = reduce(
      initialWizardState(),
      { type: "setMemberName", index: 0, name: "田中" },
      { type: "setMemberName", index: 1, name: "佐藤" },
    );

    expect(toCreatePayload(state).members[1]?.paid).toBe(0);
  });
});
```

- [x] **Step 2: テストを実行して失敗することを確認する**

Run: `npm test -w @warikan/web`
Expected: FAIL — `./wizardReducer.js` が解決できない

- [x] **Step 3: reducer を実装する**

`apps/web/src/features/events/wizardReducer.ts`:

```ts
import type { CreateEventPayload, EventMode } from "../../lib/types.js";

const MAX_MEMBERS = 20;
const MIN_MEMBERS = 1;

export type MemberDraft = { name: string; paid: number | "" };
export type ItemDraft = { name: string; amount: number | ""; paidByIndex: number };

export type WizardState = {
  title: string;
  mode: EventMode;
  members: MemberDraft[];
  items: ItemDraft[];
};

export type WizardAction =
  | { type: "setTitle"; title: string }
  | { type: "setMode"; mode: EventMode }
  | { type: "addMember" }
  | { type: "removeMember"; index: number }
  | { type: "setMemberName"; index: number; name: string }
  | { type: "setMemberPaid"; index: number; paid: number | "" }
  | { type: "addItem" }
  | { type: "removeItem"; index: number }
  | { type: "setItemName"; index: number; name: string }
  | { type: "setItemAmount"; index: number; amount: number | "" }
  | { type: "setItemPaidBy"; index: number; paidByIndex: number };

const emptyMember = (): MemberDraft => ({ name: "", paid: "" });

export const initialWizardState = (): WizardState => ({
  title: "",
  mode: "simple",
  members: [emptyMember(), emptyMember()],
  items: [],
});

/** 配列の1要素だけを差し替えた新しい配列を返す。元の配列は変更しない。 */
const replaceAt = <T>(list: T[], index: number, next: T): T[] =>
  list.map((item, position) => (position === index ? next : item));

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "setTitle":
      return { ...state, title: action.title };

    case "setMode":
      return { ...state, mode: action.mode };

    case "addMember":
      return state.members.length >= MAX_MEMBERS
        ? state
        : { ...state, members: [...state.members, emptyMember()] };

    case "removeMember": {
      if (state.members.length <= MIN_MEMBERS) return state;

      const members = state.members.filter((_, position) => position !== action.index);
      // 支払者の参照がずれる。消えた人を指していたら先頭に寄せ、
      // 後ろを指していたら1つ手前にずらす。範囲外を送ると API が 400 になる。
      const items = state.items.map((item) => {
        if (item.paidByIndex === action.index) return { ...item, paidByIndex: 0 };
        if (item.paidByIndex > action.index) return { ...item, paidByIndex: item.paidByIndex - 1 };
        return item;
      });

      return { ...state, members, items };
    }

    case "setMemberName": {
      const target = state.members[action.index];
      if (!target) return state;
      return { ...state, members: replaceAt(state.members, action.index, { ...target, name: action.name }) };
    }

    case "setMemberPaid": {
      const target = state.members[action.index];
      if (!target) return state;
      return { ...state, members: replaceAt(state.members, action.index, { ...target, paid: action.paid }) };
    }

    case "addItem":
      return { ...state, items: [...state.items, { name: "", amount: "", paidByIndex: 0 }] };

    case "removeItem":
      return { ...state, items: state.items.filter((_, position) => position !== action.index) };

    case "setItemName": {
      const target = state.items[action.index];
      if (!target) return state;
      return { ...state, items: replaceAt(state.items, action.index, { ...target, name: action.name }) };
    }

    case "setItemAmount": {
      const target = state.items[action.index];
      if (!target) return state;
      return { ...state, items: replaceAt(state.items, action.index, { ...target, amount: action.amount }) };
    }

    case "setItemPaidBy": {
      const target = state.items[action.index];
      if (!target) return state;
      return {
        ...state,
        items: replaceAt(state.items, action.index, { ...target, paidByIndex: action.paidByIndex }),
      };
    }

    default:
      return state;
  }
}

/** 送信前に人が読めるエラーを返す。空配列なら送信してよい。 */
export function wizardErrors(state: WizardState): string[] {
  const errors: string[] = [];

  if (state.members.some((member) => member.name.trim().length === 0)) {
    errors.push("参加者の名前を入力してください");
  }

  if (state.mode === "items") {
    if (state.items.length === 0) {
      errors.push("品目を1件以上追加してください");
    }
    if (state.items.some((item) => item.name.trim().length === 0)) {
      errors.push("品目名を入力してください");
    }
  }

  return errors;
}

export function toCreatePayload(state: WizardState): CreateEventPayload {
  const isItems = state.mode === "items";

  return {
    title: state.title.trim(),
    mode: state.mode,
    members: state.members.map((member) => ({
      name: member.name.trim(),
      // 品目モードでは支払額を品目から再計算するため、送信値は 0 にする。
      paid: isItems ? 0 : member.paid === "" ? 0 : member.paid,
    })),
    items: isItems
      ? state.items.map((item) => ({
          name: item.name.trim(),
          amount: item.amount === "" ? 0 : item.amount,
          paidByIndex: item.paidByIndex,
        }))
      : [],
  };
}
```

- [x] **Step 4: テストを実行して成功することを確認する**

Run: `npm test -w @warikan/web`
Expected: PASS（web 99 tests。上記を参照）

- [x] **Step 5: 型チェックとコミット**

```bash
npm run typecheck -w @warikan/web
```

```bash
git add apps/web
git commit -m "feat: 単発割り勘のウィザード状態を useReducer で持つ"
```

---

## Task 10: 単発割り勘の入力画面

**実施時に判明した不備（実測とミューテーションで確認）:**

1. **同じ形の行が並ぶのに、ラベルが全行同じだった（修正済み）。** Task 8 の送金ボタンと同根。
   - `ItemsInput` は全行が「品目名」「金額」「支払った人」で、`getByLabelText("品目名")` が `Found multiple elements` になる。行番号入り（`品目 1 の金額` など）に変更した。
   - `SimpleInput` の金額ラベルは参加者名そのもの。**参加者名は重複しうる**（reducer 側にも「同名の参加者がいても通る」テストがある）ため、同名の行を利用者も読み上げも区別できない。`1. 田中` / `2. 田中` と行番号を前に置く形に変更し、テストを2件追加した。

2. **確認して問題なかったもの（いずれもミューテーションで裏取り済み）:**
   - `wizardErrors` は `role="alert"` のバナーに全メッセージを出す。ボタンの無効化だけでなく**理由が画面に出る**。バナーを描かないミューテーションで1件 FAIL。Task 9 で追加した「品目の金額を入力してください」も見える。
   - 参加者を削除したとき、品目の支払者 `<select>` の**表示名**が正しく追従する（消えた人が残らない、別人にすり替わらない）。`value` を固定するミューテーションで1件 FAIL。
   - 二重送信は `isPending` で防げている。連打しても `POST` は1回。防止を外すミューテーションで1件 FAIL。
   - 画面側に `useState` は1つも無く、状態は `App` の `useReducer` のみ。Task 7 の「後から変わっても反映されない」構造にはなっていない。

3. **Step 8（スモークテストの `renderAt` 差し替え）は実施不要だった。** Task 7 / Task 8 の時点で `QueryClientProvider` を入れる形に直っており、新 `EventNew` も `<h1>新しい割り勘</h1>` を保つためルーティングテストは落ちない。

4. **計画は画面のテストを0件としていたが、上記の確認のため3ファイル12件を追加した**（`ItemsInput` 4、`EventNew` 2、`EventInput` 4、`SimpleInput` 2）。いずれも対応するミューテーションで落ちることを確認済み。

5. **Step 6 / Step 9 の期待件数 63 は古い。** 実際は web 113 件。

**Files:**
- Create: `apps/web/src/features/events/queries.ts`
- Create: `apps/web/src/features/events/SimpleInput.tsx`, `ItemsInput.tsx`
- Create: `ItemsInput.test.tsx`, `SimpleInput.test.tsx`, `routes/EventNew.test.tsx`, `routes/EventInput.test.tsx`（計画外。上記4を参照）
- Modify: `apps/web/src/routes/EventNew.tsx`, `apps/web/src/routes/EventInput.tsx`, `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: Task 9 の reducer、`apiGet` / `apiSend`（Task 3）
- Produces:
  - `useEvents()` / `useEvent(id)` / `useCreateEvent()` / `useDeleteEvent()` / `useToggleSettlement(eventId)`
  - `<SimpleInput state dispatch />` / `<ItemsInput state dispatch />`

ウィザードの状態は2画面（`/events/new` と `/events/new/input`）にまたがる。URL に載せるには大きすぎ、サーバーに置くと旧実装の Cookie 依存を再現してしまう。`App` で `useReducer` を持ち、両画面に props で渡す。

- [x] **Step 1: events のフックを書く**

`apps/web/src/features/events/queries.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiGet, apiSend } from "../../lib/api.js";
import { queryKeys } from "../../lib/queryKeys.js";
import type { CreateEventPayload, EventDetail, EventSummary } from "../../lib/types.js";

export const useEvents = () =>
  useQuery({ queryKey: queryKeys.events(), queryFn: () => apiGet<EventSummary[]>("/api/events") });

export const useEvent = (id: string) =>
  useQuery({
    queryKey: queryKeys.event(id),
    queryFn: () => apiGet<EventDetail>(`/api/events/${id}`),
    retry: false,
  });

export const useCreateEvent = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateEventPayload) =>
      apiSend<EventDetail>("POST", "/api/events", payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.events() });
    },
  });
};

export const useDeleteEvent = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiSend<{ id: string }>("DELETE", `/api/events/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.events() });
    },
  });
};

export const useToggleSettlement = (eventId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ settlementId, isPaid }: { settlementId: string; isPaid: boolean }) =>
      apiSend<EventDetail>("PATCH", `/api/events/${eventId}/settlements/${settlementId}`, {
        isPaid,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.event(eventId) });
    },
  });
};
```

- [x] **Step 2: シンプルモードの入力欄を書く**

`apps/web/src/features/events/SimpleInput.tsx`:

```tsx
import type { Dispatch } from "react";

import { AmountInput } from "../../components/AmountInput.js";
import type { WizardAction, WizardState } from "./wizardReducer.js";

type Props = {
  state: WizardState;
  dispatch: Dispatch<WizardAction>;
};

export function SimpleInput({ state, dispatch }: Props) {
  return (
    <div className="card">
      <h2>立て替えた金額</h2>
      <p className="sub">立て替えていない人は空欄のままで大丈夫です。</p>

      {state.members.map((member, index) => (
        <div className="form-group" key={index}>
          <label htmlFor={`paid-${index}`}>{member.name.trim() || `参加者 ${index + 1}`}</label>
          <AmountInput
            id={`paid-${index}`}
            value={member.paid}
            placeholder="0"
            onChange={(paid) => dispatch({ type: "setMemberPaid", index, paid })}
          />
        </div>
      ))}
    </div>
  );
}
```

- [x] **Step 3: 品目モードの入力欄を書く**

`apps/web/src/features/events/ItemsInput.tsx`:

```tsx
import type { Dispatch } from "react";

import { AmountInput } from "../../components/AmountInput.js";
import { Button } from "../../components/Button.js";
import { formatYen } from "../../lib/format.js";
import type { WizardAction, WizardState } from "./wizardReducer.js";

type Props = {
  state: WizardState;
  dispatch: Dispatch<WizardAction>;
};

export function ItemsInput({ state, dispatch }: Props) {
  const total = state.items.reduce(
    (sum, item) => sum + (item.amount === "" ? 0 : item.amount),
    0,
  );

  return (
    <div className="card">
      <h2>品目</h2>

      {state.items.map((item, index) => (
        <div className="item-row" key={index}>
          <div className="form-group">
            <label htmlFor={`item-name-${index}`}>品目名</label>
            <input
              id={`item-name-${index}`}
              type="text"
              value={item.name}
              maxLength={60}
              placeholder="宿代"
              onChange={(event) =>
                dispatch({ type: "setItemName", index, name: event.target.value })
              }
            />
          </div>

          <div className="row2">
            <div className="form-group">
              <label htmlFor={`item-amount-${index}`}>金額</label>
              <AmountInput
                id={`item-amount-${index}`}
                value={item.amount}
                placeholder="20000"
                onChange={(amount) => dispatch({ type: "setItemAmount", index, amount })}
              />
            </div>

            <div className="form-group">
              <label htmlFor={`item-paid-by-${index}`}>支払った人</label>
              <select
                id={`item-paid-by-${index}`}
                value={item.paidByIndex}
                onChange={(event) =>
                  dispatch({
                    type: "setItemPaidBy",
                    index,
                    paidByIndex: Number(event.target.value),
                  })
                }
              >
                {state.members.map((member, memberIndex) => (
                  <option key={memberIndex} value={memberIndex}>
                    {member.name.trim() || `参加者 ${memberIndex + 1}`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <Button
            variant="danger"
            size="sm"
            aria-label={`品目 ${index + 1} を削除`}
            onClick={() => dispatch({ type: "removeItem", index })}
          >
            この品目を削除
          </Button>
        </div>
      ))}

      <div className="list-row">
        <div className="grow">合計</div>
        <div className="amount">{formatYen(total)}</div>
      </div>

      <Button variant="secondary" onClick={() => dispatch({ type: "addItem" })}>
        ＋ 品目を追加
      </Button>
    </div>
  );
}
```

`apps/web/src/styles.css` の末尾に追記:

```css
.item-row {
  padding: 14px 0;
  border-bottom: 1px solid #f0f0f0;
}

.item-row:last-of-type {
  border-bottom: none;
}
```

- [x] **Step 4: step1 の画面を書く**

`apps/web/src/routes/EventNew.tsx` を次に置き換える:

```tsx
import type { Dispatch } from "react";
import { Link, useNavigate } from "react-router";

import { Button } from "../components/Button.js";
import { Toggle } from "../components/Toggle.js";
import type { WizardAction, WizardState } from "../features/events/wizardReducer.js";

type Props = {
  state: WizardState;
  dispatch: Dispatch<WizardAction>;
};

export function EventNew({ state, dispatch }: Props) {
  const navigate = useNavigate();

  return (
    <>
      <div className="card">
        <span className="tag tag-blue">ステップ 1 / 2</span>
        <h1>新しい割り勘</h1>

        <div className="form-group">
          <label htmlFor="title">タイトル</label>
          <input
            id="title"
            type="text"
            value={state.title}
            maxLength={60}
            placeholder="空欄なら日付から自動でつけます"
            onChange={(event) => dispatch({ type: "setTitle", title: event.target.value })}
          />
        </div>

        <div className="form-group">
          <span className="form-label">計算のしかた</span>
          <Toggle
            label="計算のしかた"
            options={[
              { value: "simple", label: "シンプル" },
              { value: "items", label: "品目別" },
            ]}
            value={state.mode}
            onChange={(mode) => dispatch({ type: "setMode", mode: mode as WizardState["mode"] })}
          />
          <p className="sub" style={{ marginTop: 8 }}>
            {state.mode === "simple"
              ? "参加者ごとに立て替えた金額をまとめて入力します。"
              : "品目ごとに金額と支払った人を記録し、支払者ごとに合算します。"}
          </p>
        </div>
      </div>

      <div className="card">
        <h2>参加者</h2>

        {state.members.map((member, index) => (
          <div className="list-row" key={index}>
            <div className="grow">
              <label htmlFor={`member-${index}`} className="sr-only">
                参加者 {index + 1} の名前
              </label>
              <input
                id={`member-${index}`}
                type="text"
                value={member.name}
                maxLength={30}
                placeholder={`参加者 ${index + 1}`}
                onChange={(event) =>
                  dispatch({ type: "setMemberName", index, name: event.target.value })
                }
              />
            </div>
            <Button
              variant="danger"
              size="sm"
              aria-label={`参加者 ${index + 1} を削除`}
              disabled={state.members.length <= 1}
              onClick={() => dispatch({ type: "removeMember", index })}
            >
              削除
            </Button>
          </div>
        ))}

        <Button
          variant="secondary"
          disabled={state.members.length >= 20}
          onClick={() => dispatch({ type: "addMember" })}
        >
          ＋ 参加者を追加
        </Button>

        <div className="actions">
          <Link className="btn btn-secondary" to="/">
            やめる
          </Link>
          <Button onClick={() => navigate("/events/new/input")}>次へ</Button>
        </div>
      </div>
    </>
  );
}
```

`apps/web/src/styles.css` の末尾に追記:

```css
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
```

- [x] **Step 5: step2 の画面を書く**

`apps/web/src/routes/EventInput.tsx` を次に置き換える:

```tsx
import type { Dispatch } from "react";
import { Link, useNavigate } from "react-router";

import { Button } from "../components/Button.js";
import { ErrorBanner } from "../components/ErrorBanner.js";
import { ItemsInput } from "../features/events/ItemsInput.js";
import { SimpleInput } from "../features/events/SimpleInput.js";
import { useCreateEvent } from "../features/events/queries.js";
import { toCreatePayload, wizardErrors } from "../features/events/wizardReducer.js";
import type { WizardAction, WizardState } from "../features/events/wizardReducer.js";

type Props = {
  state: WizardState;
  dispatch: Dispatch<WizardAction>;
  onCreated: () => void;
};

export function EventInput({ state, dispatch, onCreated }: Props) {
  const navigate = useNavigate();
  const createEvent = useCreateEvent();

  const errors = wizardErrors(state);

  const submit = () => {
    if (errors.length > 0 || createEvent.isPending) return;

    createEvent.mutate(toCreatePayload(state), {
      onSuccess: (event) => {
        onCreated();
        navigate(`/events/${event.id}`);
      },
    });
  };

  return (
    <>
      <div className="card">
        <span className="tag tag-blue">ステップ 2 / 2</span>
        <h1>{state.mode === "simple" ? "金額の入力" : "品目の入力"}</h1>
      </div>

      <ErrorBanner error={createEvent.error} />

      {errors.length > 0 ? (
        <div role="alert" className="banner banner-warn">
          <ul style={{ paddingLeft: 18 }}>
            {errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {state.mode === "simple" ? (
        <SimpleInput state={state} dispatch={dispatch} />
      ) : (
        <ItemsInput state={state} dispatch={dispatch} />
      )}

      <div className="card">
        <div className="actions">
          <Link className="btn btn-secondary" to="/events/new">
            戻る
          </Link>
          <Button disabled={errors.length > 0 || createEvent.isPending} onClick={submit}>
            {createEvent.isPending ? "計算中…" : "計算する"}
          </Button>
        </div>
      </div>
    </>
  );
}
```

- [x] **Step 6: reducer に reset を足す**

作成に成功したらウィザードを初期状態へ戻す必要がある。先に reducer 側を用意する。

`apps/web/src/features/events/wizardReducer.ts` の `WizardAction` に追加:

```ts
  | { type: "reset" }
```

`wizardReducer` の `switch` の先頭（`case "setTitle"` の前）に追加:

```ts
    case "reset":
      return initialWizardState();
```

`apps/web/src/features/events/wizardReducer.test.ts` の末尾に追記:

```ts
describe("reset", () => {
  it("初期状態に戻す", () => {
    const dirty = reduce(
      initialWizardState(),
      { type: "setTitle", title: "飲み会" },
      { type: "addMember" },
    );

    expect(wizardReducer(dirty, { type: "reset" })).toEqual(initialWizardState());
  });
});
```

Run: `npm test -w @warikan/web`
Expected: PASS（web 113 tests。上記5を参照）

- [x] **Step 7: App でウィザードの状態を持つ**

`apps/web/src/App.tsx` を次に置き換える:

```tsx
import { useReducer } from "react";
import { Navigate, Route, Routes } from "react-router";

import { initialWizardState, wizardReducer } from "./features/events/wizardReducer.js";
import { todayYm } from "./lib/ym.js";
import { EventDetail } from "./routes/EventDetail.js";
import { EventInput } from "./routes/EventInput.js";
import { EventNew } from "./routes/EventNew.js";
import { Home } from "./routes/Home.js";
import { MonthlyRecord } from "./routes/MonthlyRecord.js";
import { MonthlyResult } from "./routes/MonthlyResult.js";

export function App() {
  // ウィザードの途中状態はここだけが持つ。
  // 旧 Flask は Cookie に載せていたため別タブで壊れたが、その依存を無くす。
  const [wizard, dispatch] = useReducer(wizardReducer, undefined, initialWizardState);

  return (
    <div className="container">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/monthly" element={<Navigate to={`/monthly/${todayYm()}`} replace />} />
        <Route path="/monthly/:ym" element={<MonthlyRecord />} />
        <Route path="/monthly/:ym/result" element={<MonthlyResult />} />
        <Route path="/events/new" element={<EventNew state={wizard} dispatch={dispatch} />} />
        <Route
          path="/events/new/input"
          element={
            <EventInput
              state={wizard}
              dispatch={dispatch}
              onCreated={() => dispatch({ type: "reset" })}
            />
          }
        />
        <Route path="/events/:id" element={<EventDetail />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
```

- [x] **Step 8: スモークテストを props 対応に直す**

`apps/web/src/smoke.test.tsx` の `/events/new` のケースが、`App` 経由なので props は不要のまま通る。変更は不要。ただし `QueryClientProvider` が無いと `EventInput` が例外になるため、`renderAt` を次に置き換える:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const renderAt = (path: string) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};
```

- [x] **Step 9: テストと型チェックを通す**

Run: `npm test -w @warikan/web`
Expected: PASS（web 113 tests）

Run: `npm run typecheck -w @warikan/web`
Expected: エラーなし

- [x] **Step 10: コミット**

```bash
git add apps/web
git commit -m "feat: 単発割り勘の入力画面（シンプル・品目別）を追加"
```

---

## Task 11: 単発割り勘の結果画面とホーム

**実施時に判明した不備（実測とミューテーションで確認）:**

1. **Step 1 のコードは、Task 8 で直した不具合を単発側で再導入していた（修正済み）。** 消し込みボタンが全行「支払い済みにする」で名前を持たない。**単発は最大20人＝送金が最大19件**並ぶため、月次（常に1件）と違って実際に問題になる。
   さらに**単発は参加者名が重複しうる**ので、`ResultView` と同じ「誰から誰への何円か」だけでは一意にならない（同名2組なら同じラベルの行が2つできる）。行番号を先頭に置き `1. 田中 から 佐藤 への ¥3,000を支払い済みにする` とした。送金3件（うち2件は名前・金額とも完全一致）のフィクスチャで検証している。

2. **同名の参加者で表示が破綻していた（修正済み）。** 機能は `nameByMember`（id キー）なので壊れないが、支払い状況の一覧・品目の支払者名・送金行のすべてで同名が見分けられなかった。`SimpleInput` と同じ `1. 田中` 形式に揃えた。並び順も API が `ORDER BY position`（入力順）を返すので入力画面と一致する。

3. **消し込みの識別子は `settlement.id`**（月次の配列 index とは別物）。`PATCH /api/events/:id/settlements/:settlementId` と一致している。index を送るミューテーションで2件 FAIL することを確認済み。

4. **ミューテーション検証（すべて kill 済み）:** `aria-label` 削除 → 3件、`settlement.id` → `String(index)` → 2件、送金の逆順表示 → 2件、行番号を落とす → 2件、`window.confirm` 削除 → 1件、ホームの合計を加算しない → 2件、ホームの `isDirty` を常に false / 常に true → 各1件、ホームの一覧リンク先を固定値に → 1件。

5. **Step 3（スモークテストに fetch スタブを足す）は実施不要だった。** Task 7 / 8 の時点で `smoke.test.tsx` は `QueryClientProvider` と「解決しない Promise」の fetch スタブを持っている。追加すると二重になる。

6. **確認して問題なかったもの:** `EventDetail` / `Home` とも `useState` は0個（Task 7 の非決定な初期値問題は構造上起きない）。`GET /api/events` はエンベロープ直下が配列で `EventSummary[]` と一致（実装で確認）。`GET /api/monthly/:ym` は期間が無ければ作るのでホームの初回でも 404 にならない。「今月の合計」は API に無い値なので画面側で `expenses` を合算するのが正しい。金額はすべて `formatYen` 経由。`isDirty` バナーには `ResultView` に合わせて `role="alert"` を足した（計画には無かった）。

7. **Step 4 の期待件数 63 は古い。** 実際は web 126 件（計画外のテスト2ファイル13件を追加）。

**Files:**
- Modify: `apps/web/src/routes/EventDetail.tsx`, `apps/web/src/routes/Home.tsx`
- Create: `apps/web/src/routes/EventDetail.test.tsx`, `Home.test.tsx`（計画外。上記7を参照）

**Interfaces:**
- Consumes: Task 10 のフック、`useMonthly`（Task 6）、`formatYen`（Task 4）
- Produces: なし（画面の完成）

- [x] **Step 1: 結果画面を書く**

`apps/web/src/routes/EventDetail.tsx` を次に置き換える:

```tsx
import { Link, useNavigate, useParams } from "react-router";

import { Button } from "../components/Button.js";
import { ErrorBanner } from "../components/ErrorBanner.js";
import { useDeleteEvent, useEvent, useToggleSettlement } from "../features/events/queries.js";
import { formatYen } from "../lib/format.js";

export function EventDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();

  const event = useEvent(id);
  const toggleSettlement = useToggleSettlement(id);
  const deleteEvent = useDeleteEvent();

  if (event.isLoading) {
    return (
      <div className="card">
        <p className="sub">読み込み中…</p>
      </div>
    );
  }

  if (!event.data) {
    return (
      <div className="card">
        <h1>見つかりません</h1>
        <ErrorBanner error={event.error} />
        <Link className="btn btn-secondary" to="/">
          ホームへ
        </Link>
      </div>
    );
  }

  const detail = event.data;
  const nameByMember = new Map(detail.members.map((member) => [member.id, member.name]));
  const isBusy = toggleSettlement.isPending || deleteEvent.isPending;

  return (
    <>
      <div className="card">
        <h1>{detail.title}</h1>
        <div className="list-row">
          <div className="grow">合計</div>
          <div className="amount">{formatYen(detail.total)}</div>
        </div>
        <div className="list-row">
          <div className="grow">一人あたり</div>
          <div className="amount">{formatYen(detail.perPerson)}</div>
        </div>
      </div>

      <ErrorBanner error={toggleSettlement.error ?? deleteEvent.error} />

      <div className="card">
        <h2>支払い状況</h2>
        {detail.members.map((member) => (
          <div className="list-row" key={member.id}>
            <div className="grow ellipsis">{member.name}</div>
            <div className="amount">{formatYen(member.paid)}</div>
          </div>
        ))}
      </div>

      {detail.items.length > 0 ? (
        <div className="card">
          <h2>品目</h2>
          {detail.items.map((item) => (
            <div className="list-row" key={item.id}>
              <div className="grow">
                <div className="ellipsis">{item.name}</div>
                <div className="muted">{nameByMember.get(item.paidByMemberId) ?? "不明"}</div>
              </div>
              <div className="amount">{formatYen(item.amount)}</div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="card">
        <h2>精算</h2>
        {detail.settlements.length === 0 ? (
          <p className="sub">精算は不要です</p>
        ) : (
          detail.settlements.map((settlement) => (
            <div className="list-row" key={settlement.id}>
              <div className="grow">
                💸 {nameByMember.get(settlement.fromMemberId) ?? "?"} →{" "}
                {nameByMember.get(settlement.toMemberId) ?? "?"}
              </div>
              <div className="amount">{formatYen(settlement.amount)}</div>
              <Button
                variant={settlement.isPaid ? "success" : "secondary"}
                size="sm"
                disabled={isBusy}
                onClick={() =>
                  toggleSettlement.mutate({
                    settlementId: settlement.id,
                    isPaid: !settlement.isPaid,
                  })
                }
              >
                {settlement.isPaid ? "未払いに戻す" : "支払い済みにする"}
              </Button>
            </div>
          ))
        )}
      </div>

      <div className="card">
        <div className="actions">
          <Link className="btn btn-secondary" to="/">
            ホームへ
          </Link>
          <Button
            variant="danger"
            disabled={isBusy}
            onClick={() => {
              if (!window.confirm("この割り勘を削除しますか。元に戻せません。")) return;
              deleteEvent.mutate(detail.id, { onSuccess: () => navigate("/") });
            }}
          >
            削除する
          </Button>
        </div>
      </div>
    </>
  );
}
```

削除は元に戻せないため `window.confirm` を挟む。E2E からも操作できるよう、確認ダイアログは標準のものを使う。

- [x] **Step 2: ホーム画面を書く**

`apps/web/src/routes/Home.tsx` を次に置き換える:

```tsx
import { Link } from "react-router";

import { useEvents } from "../features/events/queries.js";
import { useMonthly } from "../features/monthly/queries.js";
import { formatYen } from "../lib/format.js";
import { todayYm, ymLabel } from "../lib/ym.js";

export function Home() {
  const ym = todayYm();
  const monthly = useMonthly(ym);
  const events = useEvents();

  const monthTotal = (monthly.data?.expenses ?? []).reduce(
    (sum, expense) => sum + expense.amount,
    0,
  );

  return (
    <>
      <div className="card">
        <h1>割り勘</h1>
        <p className="sub">夫婦2人の記録と、その場かぎりの割り勘。</p>
      </div>

      <div className="card">
        <h2>{ymLabel(ym)}</h2>
        <div className="list-row">
          <div className="grow">今月の合計</div>
          <div className="amount">{formatYen(monthTotal)}</div>
        </div>
        {monthly.data?.period.isDirty ? (
          <div className="banner banner-warn" style={{ marginTop: 12 }}>
            計算後に記録が変わっています。
          </div>
        ) : null}
        <div className="actions">
          <Link className="btn btn-primary" to={`/monthly/${ym}`}>
            📅 今月の記録
          </Link>
          <Link className="btn btn-secondary" to={`/monthly/${ym}/result`}>
            精算を見る
          </Link>
        </div>
      </div>

      <div className="card">
        <h2>単発の割り勘</h2>
        {events.isLoading ? (
          <p className="sub">読み込み中…</p>
        ) : (events.data?.length ?? 0) === 0 ? (
          <p className="sub">まだありません。</p>
        ) : (
          events.data?.map((event) => (
            <Link className="list-row" key={event.id} to={`/events/${event.id}`}>
              <div className="grow">
                <div className="ellipsis">{event.title}</div>
                <div className="muted">
                  {event.mode === "items" ? "品目別" : "シンプル"}・一人 {formatYen(event.perPerson)}
                </div>
              </div>
              <div className="amount">{formatYen(event.total)}</div>
            </Link>
          ))
        )}
        <Link className="btn btn-primary" to="/events/new" style={{ marginTop: 12 }}>
          ＋ 新しい割り勘
        </Link>
      </div>
    </>
  );
}
```

`apps/web/src/styles.css` の末尾に追記（リンクを行として使うため）:

```css
a.list-row {
  color: inherit;
  text-decoration: none;
}

a.list-row:active {
  opacity: 0.7;
}
```

- [x] **Step 3: スモークテストを更新する**

`apps/web/src/smoke.test.tsx` の `/` のケースは `Home` の `<h1>割り勘</h1>` を引き続き見るため変更不要。ただし `Home` が `useMonthly` / `useEvents` を呼ぶようになったので、`fetch` を差し替えないとエラーが出る。テスト先頭に追加する:

```tsx
import { afterEach, beforeEach, vi } from "vitest";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const data = url.includes("/api/events") ? [] : { period: {}, expenses: [] };
      return new Response(JSON.stringify({ ok: true, data }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});
```

- [x] **Step 4: テストと型チェックを通す**

Run: `npm test -w @warikan/web`
Expected: PASS（web 126 tests。上記7を参照）

Run: `npm run typecheck -w @warikan/web`
Expected: エラーなし

- [x] **Step 5: コミット**

```bash
git add apps/web
git commit -m "feat: 単発割り勘の結果画面とホームを追加"
```

---

## Task 12: 通しの動作確認と仕上げ

**Files:**
- Modify: `README.md`, `CLAUDE.md`
- Modify: `apps/web/src/*`（`ui-inspector` の指摘に応じて）

**Interfaces:**
- Consumes: なし
- Produces: なし

- [ ] **Step 1: 全テストと型チェックを通す**

Run: `npm test`
Expected: shared 31 + api 76 + web 126 = 233 tests すべて PASS

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 2: 本番と同じ構成でビルドして起動する**

```bash
npm run build -w @warikan/web
```

```bash
npm run dev -w @warikan/api
```

- [ ] **Step 3: 3モードを手で通す**

ブラウザで `http://localhost:8787` を開き、次を順に確認する。

| # | 操作 | 期待 |
|---|---|---|
| 1 | ホームが表示される | 今月のカードと単発の一覧が出る |
| 2 | 「今月の記録」→ 支出を3件入れる | 送信ごとに金額と品目だけ消え、支払者・カテゴリ・日付は残る |
| 3 | 「計算する」 | 合計・一人あたり・カテゴリ内訳・送金が出る |
| 4 | 記録に戻り、1件追加してから精算画面へ | 警告バナーと「再計算する」が出る |
| 5 | 「再計算する」 | 警告が消え、金額が更新される |
| 6 | 送金を「支払い済みにする」 | ボタンが緑になる |
| 7 | 「＋ 新しい割り勘」→ シンプル・3人 | 精算結果が出る |
| 8 | 品目別で品目を3件 | 支払者ごとに合算された結果が出る |
| 9 | ブラウザの戻る／進む | 画面が壊れない |
| 10 | 直接 `http://localhost:8787/monthly/2026-08` を開く | 404 にならず記録画面が出る（SPA フォールバック） |

10 が失敗する場合は Task 2 の `assets` 設定を疑う。

- [ ] **Step 4: ui-inspector にレイアウトを検査させる**

`ui-inspector` サブエージェントを次の入力で呼ぶ。

```
対象 URL: http://localhost:8787
検査するページ:
  /
  /monthly/2026-08
  /monthly/2026-08/result
  /events/new
  /events/new/input
```

報告された 🔴 重大（横スクロール、44px 未満のタップ領域、コントラスト比不足）は、このタスクの中で直す。🟡 改善推奨は判断して取捨する。**`ui-inspector` はコードを修正しないので、修正は呼び出し側が行う。**

- [ ] **Step 5: 開発サーバーを停止する**

Ctrl+C だけでは子の `workerd` が残る。warikan のプロセスツリーだけを親から順に落とす。

```bash
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { \$_.CommandLine -like '*warikan*' -and \$_.Name -in @('node.exe','workerd.exe') } | Select-Object ProcessId,ParentProcessId,Name,CreationDate"
```

- [ ] **Step 6: README を更新する**

`README.md` の構成表に `apps/web` を足し、既知の制約を明記する。

構成表に追加:

```markdown
| `apps/web` | React + Vite のフロントエンド |
```

「割り勘のモード」節の後に追加:

```markdown
## 既知の制約

月次モードの支払者トグルには、ログイン中の自分と「その月の支出に現れたもう一人」しか出ない。相手がまだ1件も記録していない月では相手を選べず、表示名も「パートナー」の固定文言になる。API に登録済みユーザー一覧のエンドポイントが無いため。Plan 3 で `GET /api/users` を追加して解消する。
```

- [ ] **Step 7: CLAUDE.md を更新する**

「ディレクトリ構成」表の `apps/web` の行を次に差し替える:

```markdown
| `apps/web` | React + Vite のフロントエンド |
```

「開発コマンド」節に追記:

```markdown
フロントだけを開発するときは Vite の dev サーバーを使う（`/api` はローカルの Worker に転送される）。

```bash
npm run dev -w @warikan/web
```

本番と同じ構成で確かめるときは、web をビルドしてから Worker を起動する。`/api/*` は Worker、それ以外は `apps/web/dist` の SPA が返る。

```bash
npm run build -w @warikan/web
```
```

「コーディング上の制約」に追記:

```markdown
- フロントのサーバー状態は TanStack Query が持つ。楽観更新はせず、更新後に該当クエリを invalidate する。クエリキーは `apps/web/src/lib/queryKeys.ts` からのみ取る
- react-router は v8。`react-router-dom` は使わず、すべて `react-router` から import する
```

- [ ] **Step 8: コミット**

```bash
git add -A
git commit -m "docs: Plan 2 の完了に合わせて README と CLAUDE.md を更新"
```

---

## Self-Review メモ

このプランを設計書と突き合わせた結果を記す。

| 設計書の項目 | 対応タスク |
|---|---|
| §3.1 `apps/web` の構成 | Task 1, 5 |
| §7 画面一覧（7ルート） | Task 5（骨格）、Task 7・8・10・11（中身） |
| §7.1 記録画面の連続入力 | Task 7（テストで固定） |
| §7.2 精算結果画面 | Task 8 |
| §7.2 `is_dirty` の警告 | Task 8（テストで固定） |
| §7.3 TanStack Query・楽観更新しない | Task 6, 10 |
| §7.3 ウィザードは `useReducer` | Task 9, 10 |
| §7.3 グローバル状態管理を入れない | 全体（依存に入れていない） |
| 決定事項 #4 単一 Worker + Static Assets | Task 2 |
| Phase 3 単発モードのパリティ | Task 9, 10, 11 |
| Phase 4 月次モード | Task 6, 7, 8 |
| Phase 3 の完了条件「`ui-inspector` でスマホ幅を確認済み」 | Task 12 Step 4 |

**Plan 3 に持ち越す項目**

- `GET /api/users` の追加（月次の支払者トグルの制約を解消する）
- Cloudflare Access のダッシュボード設定、secret 投入、本番デプロイ
- Playwright E2E 3本
- `legacy/` の削除
- `code-reviewer` / `security-reviewer` による通しレビュー（設計書 §10 の各フェーズ末尾の指定）

**このプランで意図的に採用した判断**

| 判断 | 理由 |
|---|---|
| Task 2（静的配信）を画面より先に置く | 配信構成が成立しないと全画面が無駄になる。不確実性の高いものを前に出す |
| フロントのテストを5対象に絞る | 全コンポーネントを覆うと Plan 2 が倍近くなる。壊れたときに気づきにくいものだけを選び、残りは E2E と `ui-inspector` に任せる |
| ウィザードの状態を `App` に持たせる | 2画面にまたがるため。URL に載せるには大きく、サーバーに置くと旧実装の Cookie 依存を再現してしまう |
| 楽観更新をしない | 金額の整合性を優先する。表示が一瞬遅れるより、誤った金額が見えるほうが害が大きい |
| `queryKeys` を1ファイルに集約 | invalidate 先を取り違えると古い金額が残る。文字列を直書きさせない |
| 月次の支払者を2人固定にしない | API が返す情報だけで構成し、足りない部分は制約として明記した。API を推測で拡張しない |
