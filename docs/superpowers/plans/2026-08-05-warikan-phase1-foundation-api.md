# 割り勘アプリ Cloudflare 移行 Plan 1: 基盤・精算エンジン・API 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cloudflare Workers 上で動く割り勘 API と、テスト済みの精算エンジンを完成させる。ブラウザ UI はまだ無いが、API 単体で全機能がテストから利用できる状態にする。

**Architecture:** npm workspaces のモノレポ。精算ロジックは `packages/shared` の純関数として DB・HTTP から完全に切り離し、Vitest でユニットテストする。API は `apps/api` の Hono アプリで、D1 を素の prepared statement で叩き、`@cloudflare/vitest-pool-workers` の miniflare 環境で統合テストする。認証は Cloudflare Access の JWT を `jose` で検証する。

**Tech Stack:** TypeScript / Hono / Cloudflare Workers / D1 / Vitest 4 / @cloudflare/vitest-pool-workers / fast-check / jose / zod

**設計書:** [docs/superpowers/specs/2026-08-05-warikan-cloudflare-design.md](../specs/2026-08-05-warikan-cloudflare-design.md)

**このプランの範囲:** 設計書の Phase 0〜2。React フロントは Plan 2、デプロイと E2E は Plan 3 で扱う。

## Global Constraints

- 金額はすべて **整数（円）**。浮動小数点を金額計算に使わない
- 文字列比較は `localeCompare` を使わず、コードユニット比較（`a < b ? -1 : a > b ? 1 : 0`）で行う。ロケール差で結果が変わらないようにするため
- D1 は対話的トランザクション非対応。複数文を原子的に実行する箇所は `env.DB.batch([...])` を使う
- メールアドレスをソース・マイグレーション・テストフィクスチャに実在の値で書かない。テストは `me@example.com` / `partner@example.com` を使う
- `Cf-Access-Authenticated-User-Email` ヘッダを信用しない。必ず `Cf-Access-Jwt-Assertion` の署名を検証する
- API レスポンスは共通エンベロープ `{ ok: true, data }` / `{ ok: false, error: { code, message, fields? } }`
- ファイルは1つの責務に絞る。200〜400行を目安、800行を上限とする
- コミットメッセージは `<type>: <説明>` 形式（type は feat / fix / refactor / docs / test / chore）
- テストカバレッジ目標 80%

---

## File Structure

| パス | 責務 |
|---|---|
| `.mcp.json` | Playwright MCP のプロジェクト宣言 |
| `.claude/agents/ui-inspector.md` | レイアウト検査エージェント（報告のみ） |
| `.claude/agents/web-debugger.md` | ブラウザ不具合の追跡・修正エージェント |
| `package.json` | ワークスペース定義とルートスクリプト |
| `tsconfig.base.json` | 共通 TypeScript 設定 |
| `packages/shared/src/types.ts` | 精算の入出力型 |
| `packages/shared/src/settlement.ts` | 負担額配分と貪欲マッチング（純関数） |
| `packages/shared/src/settlement.test.ts` | 具体例テスト |
| `packages/shared/src/settlement.properties.test.ts` | fast-check による性質テスト |
| `packages/shared/src/settlement.parity.test.ts` | Flask 実装との同値性テスト |
| `packages/shared/src/__fixtures__/flask-parity.json` | Flask 実装の出力（生成物、コミットする） |
| `packages/shared/src/index.ts` | 公開エントリ |
| `legacy/` | 既存 Flask 一式（Plan 3 の最後に削除） |
| `legacy/parity_dump.py` | パリティ用フィクスチャ生成スクリプト |
| `apps/api/wrangler.jsonc` | Worker 設定 |
| `apps/api/src/env.ts` | Bindings の型 |
| `apps/api/src/index.ts` | Hono アプリ組み立て |
| `apps/api/src/lib/response.ts` | レスポンスエンベロープ |
| `apps/api/src/lib/ids.ts` | ID 生成 |
| `apps/api/src/middleware/auth.ts` | Access JWT 検証 + ユーザー解決 |
| `apps/api/src/middleware/errors.ts` | 例外の一元処理 |
| `apps/api/src/db/rows.ts` | D1 の行の型 |
| `apps/api/src/db/users.ts` | users のクエリ |
| `apps/api/src/db/categories.ts` | categories のクエリ |
| `apps/api/src/db/monthly.ts` | monthly_periods / monthly_expenses のクエリ |
| `apps/api/src/db/events.ts` | events 系のクエリ |
| `apps/api/src/routes/me.ts` | `/api/me` |
| `apps/api/src/routes/categories.ts` | `/api/categories` |
| `apps/api/src/routes/monthly.ts` | `/api/monthly/*` |
| `apps/api/src/routes/events.ts` | `/api/events/*` |
| `apps/api/src/services/settle.ts` | 月次のスナップショット生成 |
| `apps/api/migrations/0001_init.sql` | スキーマ |
| `apps/api/migrations/0002_categories.sql` | カテゴリ初期データ |
| `apps/api/test/apply-migrations.ts` | テスト前のマイグレーション適用 |
| `apps/api/test/helpers.ts` | 認証済みリクエストの生成ヘルパ |

---

## Task 1: プロジェクト設定と Flask の legacy 移動

**Files:**
- Create: `.mcp.json`
- Create: `.claude/agents/ui-inspector.md`
- Create: `.claude/agents/web-debugger.md`
- Move: `app.py` → `legacy/app.py`, `templates/` → `legacy/templates/`, `data/` → `legacy/data/`, `start_warikan.bat` → `legacy/start_warikan.bat`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: なし
- Produces: `legacy/app.py` に `calculate_settlements(members)` が残っている（Task 6 が使う）

- [ ] **Step 1: Playwright MCP をプロジェクトに宣言する**

`.mcp.json` を作成:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest"]
    }
  }
}
```

- [ ] **Step 2: ui-inspector エージェントを作成する**

`.claude/agents/ui-inspector.md`:

```markdown
---
name: ui-inspector
description: Web アプリのレイアウトを Playwright MCP で検査する。スマホ幅・タブレット幅・PC幅でスクリーンショットを撮り、横スクロール発生・タップ領域・コントラスト・見出し階層・フォーカス可視性を報告する。UI を変更した直後に PROACTIVELY 使う。コードは修正しない。
tools: Read, Glob, Grep, mcp__playwright__browser_navigate, mcp__playwright__browser_resize, mcp__playwright__browser_take_screenshot, mcp__playwright__browser_snapshot, mcp__playwright__browser_evaluate, mcp__playwright__browser_console_messages
---

あなたはレイアウト検査の専門家です。**コードは絶対に修正しません。** 所見を報告することだけがあなたの仕事です。

## 入力

呼び出し元から検査対象の URL とページの一覧を受け取ります。渡されなければ `http://localhost:8787` を起点とします。

## 手順

各ページについて、以下の3つの幅で検査します。

| 名前 | 幅 x 高さ |
|---|---|
| mobile | 375 x 812 |
| tablet | 768 x 1024 |
| desktop | 1280 x 800 |

各幅で次を順に実行します。

1. `browser_resize` で幅を変える
2. `browser_navigate` でページを開く
3. `browser_take_screenshot` で全体を撮る
4. `browser_snapshot` でアクセシビリティツリーを取得する
5. `browser_console_messages` でエラーを確認する
6. 下記の検査項目を `browser_evaluate` で計測する

## 検査項目

- **横スクロール**: `document.documentElement.scrollWidth > window.innerWidth` が true なら、はみ出している要素を特定して報告する
- **タップ領域**: すべての `button` / `a` / `input` / `select` について `getBoundingClientRect()` を取り、幅か高さが 44px 未満のものを列挙する
- **文字サイズ**: 計算後の `font-size` が 12px 未満のテキスト要素を列挙する
- **コントラスト**: 前景色と背景色から比を計算し、通常テキストで 4.5:1、18px 以上の大きい文字で 3:1 を下回るものを列挙する
- **見出し階層**: `h1`〜`h6` の順序が飛んでいないか、`h1` が1つだけあるかを確認する
- **フォーカス可視性**: `Tab` で辿れる要素にフォーカスリングが見えるか確認する
- **フォームラベル**: すべての入力に対応する `label` か `aria-label` があるか確認する

## 出力

以下の形式で報告します。所見が無い項目は「問題なし」と1行で書きます。

    ## <ページ名>

    ### 🔴 重大（使用に支障がある）
    - <幅>: <要素セレクタ> — <何がどうなっているか><計測値>

    ### 🟡 改善推奨
    - ...

    ### ⚪ 気づいた点
    - ...

各所見には必ず**計測値**（px、コントラスト比など）を添えます。「小さすぎる」ではなく「32x28px（44px 未満）」と書きます。

修正案を書いてもかまいませんが、ファイルを編集してはいけません。
```

- [ ] **Step 3: web-debugger エージェントを作成する**

`.claude/agents/web-debugger.md`:

```markdown
---
name: web-debugger
description: ブラウザ上で再現する不具合を Playwright MCP で追跡し、原因を特定して修正する。コンソールエラー、API 呼び出しの失敗、要素が描画されない、クリックが効かないといった症状に使う。
tools: Read, Write, Edit, Bash, Glob, Grep, mcp__playwright__browser_navigate, mcp__playwright__browser_click, mcp__playwright__browser_type, mcp__playwright__browser_fill_form, mcp__playwright__browser_snapshot, mcp__playwright__browser_take_screenshot, mcp__playwright__browser_console_messages, mcp__playwright__browser_network_requests, mcp__playwright__browser_evaluate, mcp__playwright__browser_wait_for
---

あなたはブラウザ不具合の調査担当です。**推測で直さず、観測してから直します。**

## 手順

1. **再現する** — 報告された症状をブラウザ上で実際に再現する。再現しなければ、その事実を報告して終える。推測で修正しない
2. **観測する** — 次を必ず確認する
   - `browser_console_messages` — 例外とエラーログ
   - `browser_network_requests` — 失敗したリクエスト、想定外のステータス、レスポンスボディ
   - `browser_snapshot` — 期待した要素が DOM に存在するか
3. **原因を特定する** — 観測結果からコードを読み、原因箇所を `ファイル:行` で特定する。ここまでで根拠が揃わなければ、揃うまで観測に戻る
4. **最小の修正を当てる** — 原因だけを直す。周辺のリファクタリングはしない
5. **再現手順をもう一度実行して直ったことを確認する** — 直っていなければ 2 に戻る
6. **他の画面が壊れていないか確認する** — 修正が触れた箇所を使う別のページを1つ以上開いて確認する

## 報告形式

    ## 症状
    <観測した事実。スクリーンショットやログの引用>

    ## 原因
    <ファイル:行> — <なぜそうなるか>

    ## 修正
    <変更内容と、なぜそれで直るか>

    ## 確認
    - 再現手順: <結果>
    - 影響確認: <開いたページと結果>

## 禁止事項

- 再現できていない不具合を「直した」と報告しない
- 症状を隠すだけの修正（try/catch で握りつぶす、要素を非表示にする）をしない
- テストが失敗しているとき、テストの方を都合よく書き換えない
```

- [ ] **Step 4: Flask 実装を legacy/ へ移動する**

```bash
mkdir -p legacy
git mv app.py templates data start_warikan.bat legacy/
```

- [ ] **Step 5: 移動後も Flask が起動することを確認する**

Run: `python legacy/app.py`
Expected: `Running on http://127.0.0.1:5000` が表示される。ブラウザで開いてトップページが出る。確認後 Ctrl+C で停止。

`DATA_FILE` は `os.path.dirname(__file__)` 基準なので `legacy/data/sessions.json` を見る。ディレクトリごと移動しているため動く。

- [ ] **Step 6: CLAUDE.md のパス参照を更新する**

`CLAUDE.md` 内の `app.py` / `templates/` / `data/sessions.json` / `start_warikan.bat` への参照を `legacy/` 付きに書き換える。冒頭の「概要」に次の1段落を追加する。

```markdown
> **注意:** このリポジトリは Cloudflare Workers + D1 + React への移行作業中です。
> `legacy/` 配下は移行前の Flask 実装で、パリティ確認のために残しています。
> 新規の作業は `apps/` と `packages/` で行ってください。
> 設計書: docs/superpowers/specs/2026-08-05-warikan-cloudflare-design.md
```

- [ ] **Step 7: コミット**

```bash
git add -A
git commit -m "chore: Playwright MCP とサブエージェントを追加し Flask を legacy/ へ移動"
```

---

## Task 2: モノレポ土台と Vitest

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.npmrc`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/vitest.config.ts`
- Create: `packages/shared/src/index.ts`, `packages/shared/src/smoke.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `npm test` が実行できる。`@warikan/shared` が `./src/index.ts` を公開する

- [ ] **Step 1: ルート package.json を作成する**

```json
{
  "name": "warikan",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "test": "npm run test --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present"
  }
}
```

- [ ] **Step 2: 共通 TypeScript 設定を作成する**

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noEmit": true
  }
}
```

`noUncheckedIndexedAccess` を有効にするため、配列アクセスは存在確認か `!` が必要になる。Task 4 のコードはこれを前提に書いてある。

- [ ] **Step 3: shared パッケージを作成する**

`packages/shared/package.json`:

```json
{
  "name": "@warikan/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  }
}
```

`packages/shared/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts"]
}
```

`packages/shared/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts"],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
```

- [ ] **Step 4: 依存をインストールする**

```bash
npm install -D typescript vitest@^4.1.0 @vitest/coverage-v8
npm install -D fast-check -w @warikan/shared
```

`vitest` は 4.1 以上が必要（`@cloudflare/vitest-pool-workers` の要件。Task 7 で使う）。

- [ ] **Step 5: テストハーネスが動くことを確かめる失敗テストを書く**

`packages/shared/src/smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { PACKAGE_NAME } from "./index.js";

describe("shared package", () => {
  it("公開エントリからエクスポートを読める", () => {
    expect(PACKAGE_NAME).toBe("@warikan/shared");
  });
});
```

- [ ] **Step 6: テストを実行して失敗することを確認する**

Run: `npm test -w @warikan/shared`
Expected: FAIL — `Failed to resolve import "./index.js"` もしくは `PACKAGE_NAME is not exported`

- [ ] **Step 7: 最小の実装を書く**

`packages/shared/src/index.ts`:

```ts
export const PACKAGE_NAME = "@warikan/shared";
```

- [ ] **Step 8: テストを実行して成功することを確認する**

Run: `npm test -w @warikan/shared`
Expected: PASS（1 test）

- [ ] **Step 9: コミット**

```bash
git add package.json package-lock.json tsconfig.base.json packages/
git commit -m "chore: npm workspaces と Vitest の土台を用意"
```

---

## Task 3: 型定義と負担額の配分（computeShares）

**Files:**
- Create: `packages/shared/src/types.ts`
- Create: `packages/shared/src/settlement.ts`
- Create: `packages/shared/src/settlement.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `type Participant = { id: string; name: string; paid: number }`
  - `type Share = { id: string; share: number }`
  - `type Transfer = { fromId: string; toId: string; amount: number }`
  - `type SettlementResult = { total: number; perPerson: number; shares: Share[]; transfers: Transfer[] }`
  - `function computeShares(participants: readonly Participant[]): { total: number; perPerson: number; shares: Share[] }`
  - `function compareStr(a: string, b: string): number`

- [ ] **Step 1: 型を定義する**

`packages/shared/src/types.ts`:

```ts
/** 割り勘の参加者。paid は整数（円）。 */
export type Participant = {
  id: string;
  name: string;
  paid: number;
};

/** 各参加者が負担すべき額。端数配分を含む。 */
export type Share = {
  id: string;
  share: number;
};

/** 1件の送金。 */
export type Transfer = {
  fromId: string;
  toId: string;
  amount: number;
};

export type SharesResult = {
  total: number;
  perPerson: number;
  shares: Share[];
};

export type SettlementResult = SharesResult & {
  transfers: Transfer[];
};
```

- [ ] **Step 2: 失敗するテストを書く**

`packages/shared/src/settlement.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { computeShares } from "./settlement.js";
import type { Participant } from "./types.js";

const p = (id: string, name: string, paid: number): Participant => ({ id, name, paid });

describe("computeShares", () => {
  it("割り切れるとき全員の負担額が等しい", () => {
    const result = computeShares([p("a", "A", 6000), p("b", "B", 3000), p("c", "C", 0)]);

    expect(result.total).toBe(9000);
    expect(result.perPerson).toBe(3000);
    expect(result.shares).toEqual([
      { id: "a", share: 3000 },
      { id: "b", share: 3000 },
      { id: "c", share: 3000 },
    ]);
  });

  it("端数は名前の昇順で先頭から1円ずつ配る", () => {
    const result = computeShares([p("a", "A", 1000), p("b", "B", 0), p("c", "C", 0)]);

    expect(result.total).toBe(1000);
    expect(result.perPerson).toBe(333);
    expect(result.shares).toEqual([
      { id: "a", share: 334 },
      { id: "b", share: 333 },
      { id: "c", share: 333 },
    ]);
  });

  it("端数配分は入力順ではなく名前順で決まる", () => {
    const result = computeShares([p("c", "C", 1000), p("a", "A", 0), p("b", "B", 0)]);

    // 入力順は C, A, B だが、+1 されるのは名前が最小の A
    expect(result.shares).toEqual([
      { id: "c", share: 333 },
      { id: "a", share: 334 },
      { id: "b", share: 333 },
    ]);
  });

  it("負担額の合計は常に total と一致する", () => {
    const result = computeShares([p("a", "A", 100), p("b", "B", 1), p("c", "C", 0)]);

    const sum = result.shares.reduce((acc, s) => acc + s.share, 0);
    expect(sum).toBe(result.total);
  });

  it("参加者が0人ならゼロを返す", () => {
    expect(computeShares([])).toEqual({ total: 0, perPerson: 0, shares: [] });
  });

  it("参加者が1人なら全額をその人が負担する", () => {
    expect(computeShares([p("a", "A", 500)])).toEqual({
      total: 500,
      perPerson: 500,
      shares: [{ id: "a", share: 500 }],
    });
  });

  it("同名の参加者がいても id で区別される", () => {
    const result = computeShares([p("a", "田中", 1000), p("b", "田中", 0)]);

    expect(result.shares).toEqual([
      { id: "a", share: 500 },
      { id: "b", share: 500 },
    ]);
  });
});
```

- [ ] **Step 3: テストを実行して失敗することを確認する**

Run: `npm test -w @warikan/shared`
Expected: FAIL — `Failed to resolve import "./settlement.js"`

- [ ] **Step 4: computeShares を実装する**

`packages/shared/src/settlement.ts`:

```ts
import type { Participant, SharesResult } from "./types.js";

/**
 * ロケールに依存しないコードユニット比較。
 * localeCompare は環境の ICU データで結果が変わり、端数の配分先がぶれる。
 */
export function compareStr(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function computeShares(participants: readonly Participant[]): SharesResult {
  const n = participants.length;
  if (n === 0) return { total: 0, perPerson: 0, shares: [] };

  const total = participants.reduce((sum, participant) => sum + participant.paid, 0);
  const base = Math.floor(total / n);
  const remainder = total - base * n;

  const extraIds = new Set(
    [...participants]
      .sort((a, b) => compareStr(a.name, b.name) || compareStr(a.id, b.id))
      .slice(0, remainder)
      .map((participant) => participant.id),
  );

  return {
    total,
    perPerson: base,
    shares: participants.map((participant) => ({
      id: participant.id,
      share: base + (extraIds.has(participant.id) ? 1 : 0),
    })),
  };
}
```

- [ ] **Step 5: テストを実行して成功することを確認する**

Run: `npm test -w @warikan/shared`
Expected: PASS（smoke 1件 + computeShares 7件）

- [ ] **Step 6: 公開エントリから再エクスポートする**

`packages/shared/src/index.ts` を次の内容に置き換える:

```ts
export const PACKAGE_NAME = "@warikan/shared";

export * from "./types.js";
export { compareStr, computeShares } from "./settlement.js";
```

- [ ] **Step 7: 型チェックを通す**

Run: `npm run typecheck -w @warikan/shared`
Expected: エラーなし

- [ ] **Step 8: コミット**

```bash
git add packages/shared
git commit -m "feat: 端数を決定的に配分する computeShares を追加"
```

---

## Task 4: 貪欲マッチングによる送金計算（calculateSettlement）

**Files:**
- Modify: `packages/shared/src/settlement.ts`
- Modify: `packages/shared/src/settlement.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `computeShares`, `compareStr`, `Participant`, `SettlementResult`（Task 3）
- Produces: `function calculateSettlement(participants: readonly Participant[]): SettlementResult`

- [ ] **Step 1: 失敗するテストを追記する**

`packages/shared/src/settlement.test.ts` の末尾に追記する。ファイル先頭の import を次に変更する。

```ts
import { calculateSettlement, computeShares } from "./settlement.js";
```

追記するテスト:

```ts
describe("calculateSettlement", () => {
  it("全員の支払いが同じなら送金は発生しない", () => {
    const result = calculateSettlement([p("a", "A", 3000), p("b", "B", 3000), p("c", "C", 3000)]);

    expect(result.transfers).toEqual([]);
  });

  it("2人なら差額の半分が1件の送金になる", () => {
    const result = calculateSettlement([p("a", "A", 10000), p("b", "B", 0)]);

    expect(result.total).toBe(10000);
    expect(result.perPerson).toBe(5000);
    expect(result.transfers).toEqual([{ fromId: "b", toId: "a", amount: 5000 }]);
  });

  it("端数があっても送金の合計が過不足と厳密に一致する", () => {
    const result = calculateSettlement([p("a", "A", 1000), p("b", "B", 0), p("c", "C", 0)]);

    // shares: a=334, b=333, c=333 → balances: a=+666, b=-333, c=-333
    expect(result.transfers).toEqual([
      { fromId: "b", toId: "a", amount: 333 },
      { fromId: "c", toId: "a", amount: 333 },
    ]);
  });

  it("債権者が複数いても送金回数は人数-1以下に収まる", () => {
    const result = calculateSettlement([
      p("a", "A", 8000),
      p("b", "B", 0),
      p("c", "C", 4000),
      p("d", "D", 0),
    ]);

    // total 12000, per 3000 → a=+5000, c=+1000, b=-3000, d=-3000
    expect(result.transfers).toEqual([
      { fromId: "b", toId: "a", amount: 3000 },
      { fromId: "d", toId: "a", amount: 2000 },
      { fromId: "d", toId: "c", amount: 1000 },
    ]);
    expect(result.transfers.length).toBeLessThanOrEqual(3);
  });

  it("送金額はすべて正の整数", () => {
    const result = calculateSettlement([p("a", "A", 100), p("b", "B", 1), p("c", "C", 0)]);

    for (const transfer of result.transfers) {
      expect(Number.isInteger(transfer.amount)).toBe(true);
      expect(transfer.amount).toBeGreaterThan(0);
    }
  });

  it("参加者が0人なら空の結果を返す", () => {
    expect(calculateSettlement([])).toEqual({
      total: 0,
      perPerson: 0,
      shares: [],
      transfers: [],
    });
  });

  it("参加者が1人なら送金は発生しない", () => {
    const result = calculateSettlement([p("a", "A", 500)]);

    expect(result.transfers).toEqual([]);
  });

  it("全員が0円なら送金は発生しない", () => {
    const result = calculateSettlement([p("a", "A", 0), p("b", "B", 0)]);

    expect(result.total).toBe(0);
    expect(result.transfers).toEqual([]);
  });
});
```

- [ ] **Step 2: テストを実行して失敗することを確認する**

Run: `npm test -w @warikan/shared`
Expected: FAIL — `calculateSettlement is not exported`

- [ ] **Step 3: calculateSettlement を実装する**

`packages/shared/src/settlement.ts` の末尾に追記する。import 行を次に変更する。

```ts
import type { Participant, SettlementResult, SharesResult, Transfer } from "./types.js";
```

追記する実装:

```ts
/**
 * 立て替えの過不足を、送金回数が最小になるように貪欲法で解消する。
 * すべて整数演算なので、送金額の合計と各人の過不足は厳密に一致する。
 */
export function calculateSettlement(participants: readonly Participant[]): SettlementResult {
  const { total, perPerson, shares } = computeShares(participants);
  const shareById = new Map(shares.map((share) => [share.id, share.share]));

  const balances = participants.map((participant) => ({
    id: participant.id,
    balance: participant.paid - (shareById.get(participant.id) ?? 0),
  }));

  const creditors = balances
    .filter((entry) => entry.balance > 0)
    .sort((a, b) => b.balance - a.balance || compareStr(a.id, b.id));
  const debtors = balances
    .filter((entry) => entry.balance < 0)
    .sort((a, b) => a.balance - b.balance || compareStr(a.id, b.id));

  const transfers: Transfer[] = [];
  let creditorIndex = 0;
  let debtorIndex = 0;
  let credit = creditors[0]?.balance ?? 0;
  let debt = -(debtors[0]?.balance ?? 0);

  while (creditorIndex < creditors.length && debtorIndex < debtors.length) {
    const amount = Math.min(credit, debt);
    transfers.push({
      fromId: debtors[debtorIndex]!.id,
      toId: creditors[creditorIndex]!.id,
      amount,
    });

    credit -= amount;
    debt -= amount;

    if (credit === 0) {
      creditorIndex += 1;
      credit = creditors[creditorIndex]?.balance ?? 0;
    }
    if (debt === 0) {
      debtorIndex += 1;
      debt = -(debtors[debtorIndex]?.balance ?? 0);
    }
  }

  return { total, perPerson, shares, transfers };
}
```

ここで書き換えているのは関数内で新しく作った配列と数値だけで、引数 `participants` には一切触れていない。呼び出し元から見える副作用は無い。

- [ ] **Step 4: テストを実行して成功することを確認する**

Run: `npm test -w @warikan/shared`
Expected: PASS（16 tests）

- [ ] **Step 5: 公開エントリを更新する**

`packages/shared/src/index.ts`:

```ts
export const PACKAGE_NAME = "@warikan/shared";

export * from "./types.js";
export { calculateSettlement, compareStr, computeShares } from "./settlement.js";
```

- [ ] **Step 6: 型チェックとコミット**

```bash
npm run typecheck -w @warikan/shared
git add packages/shared
git commit -m "feat: 貪欲法で送金を最小化する calculateSettlement を追加"
```

---

## Task 5: 性質テスト（fast-check）

**Files:**
- Create: `packages/shared/src/settlement.properties.test.ts`

**Interfaces:**
- Consumes: `calculateSettlement`, `Participant`（Task 4）
- Produces: なし

- [ ] **Step 1: 性質テストを書く**

`packages/shared/src/settlement.properties.test.ts`:

```ts
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { calculateSettlement } from "./settlement.js";
import type { Participant } from "./types.js";

const participantsArb = fc.uniqueArray(
  fc.record({
    id: fc.string({ minLength: 1, maxLength: 8 }),
    name: fc.string({ minLength: 1, maxLength: 8 }),
    paid: fc.integer({ min: 0, max: 1_000_000 }),
  }),
  { minLength: 1, maxLength: 20, selector: (participant) => participant.id },
);

const received = (transfers: readonly { toId: string; amount: number }[], id: string): number =>
  transfers.filter((t) => t.toId === id).reduce((sum, t) => sum + t.amount, 0);

const sent = (transfers: readonly { fromId: string; amount: number }[], id: string): number =>
  transfers.filter((t) => t.fromId === id).reduce((sum, t) => sum + t.amount, 0);

describe("calculateSettlement の性質", () => {
  it("負担額の合計は支払額の合計と一致する", () => {
    fc.assert(
      fc.property(participantsArb, (participants: Participant[]) => {
        const result = calculateSettlement(participants);
        const shareSum = result.shares.reduce((sum, share) => sum + share.share, 0);
        const paidSum = participants.reduce((sum, participant) => sum + participant.paid, 0);

        expect(shareSum).toBe(paidSum);
        expect(result.total).toBe(paidSum);
      }),
    );
  });

  it("各人の受取と支払の差は、その人の過不足と一致する", () => {
    fc.assert(
      fc.property(participantsArb, (participants: Participant[]) => {
        const result = calculateSettlement(participants);
        const shareById = new Map(result.shares.map((share) => [share.id, share.share]));

        for (const participant of participants) {
          const balance = participant.paid - shareById.get(participant.id)!;
          const net = received(result.transfers, participant.id) - sent(result.transfers, participant.id);

          expect(net).toBe(balance);
        }
      }),
    );
  });

  it("送金回数は参加者数-1以下", () => {
    fc.assert(
      fc.property(participantsArb, (participants: Participant[]) => {
        const result = calculateSettlement(participants);

        expect(result.transfers.length).toBeLessThanOrEqual(Math.max(0, participants.length - 1));
      }),
    );
  });

  it("送金額はすべて正の整数", () => {
    fc.assert(
      fc.property(participantsArb, (participants: Participant[]) => {
        const result = calculateSettlement(participants);

        for (const transfer of result.transfers) {
          expect(Number.isInteger(transfer.amount)).toBe(true);
          expect(transfer.amount).toBeGreaterThan(0);
        }
      }),
    );
  });

  it("自分から自分への送金は発生しない", () => {
    fc.assert(
      fc.property(participantsArb, (participants: Participant[]) => {
        const result = calculateSettlement(participants);

        for (const transfer of result.transfers) {
          expect(transfer.fromId).not.toBe(transfer.toId);
        }
      }),
    );
  });

  it("負担額は perPerson か perPerson+1 のいずれか", () => {
    fc.assert(
      fc.property(participantsArb, (participants: Participant[]) => {
        const result = calculateSettlement(participants);

        for (const share of result.shares) {
          expect([result.perPerson, result.perPerson + 1]).toContain(share.share);
        }
      }),
    );
  });

  it("同じ入力からは常に同じ結果が出る", () => {
    fc.assert(
      fc.property(participantsArb, (participants: Participant[]) => {
        expect(calculateSettlement(participants)).toEqual(calculateSettlement(participants));
      }),
    );
  });
});
```

- [ ] **Step 2: テストを実行する**

Run: `npm test -w @warikan/shared`
Expected: PASS（23 tests）

失敗した場合、fast-check が最小の反例を出力する。その入力を `settlement.test.ts` に固定の回帰テストとして追加してから `settlement.ts` を修正すること。

- [ ] **Step 3: カバレッジを確認する**

Run: `npm test -w @warikan/shared -- --coverage`
Expected: `settlement.ts` の lines / branches とも 80% 以上

- [ ] **Step 4: コミット**

```bash
git add packages/shared
git commit -m "test: 精算ロジックの性質テストを fast-check で追加"
```

---

## Task 6: Flask 実装とのパリティ検証

**Files:**
- Create: `legacy/parity_dump.py`
- Create: `packages/shared/src/__fixtures__/flask-parity.json`（生成物。コミットする）
- Create: `packages/shared/src/settlement.parity.test.ts`

**Interfaces:**
- Consumes: `legacy/app.py` の `calculate_settlements`（Task 1）、`calculateSettlement`（Task 4）
- Produces: なし

**背景:** TS 実装は端数処理を整数演算に直しているため、割り切れないケースでは Flask 版と結果が異なる。これは意図した修正。したがってパリティ検証は **合計が人数で割り切れるケースに限定**する。

また Python の `sorted` は安定ソートで、残高が同額の債務者は入力順のまま並ぶ。TS は id 昇順で tie-break する。両者を一致させるため、フィクスチャのケースは**入力順と名前の昇順が一致する**ように作る。

- [ ] **Step 1: フィクスチャ生成スクリプトを書く**

`legacy/parity_dump.py`:

```python
"""TS 実装との同値性検証用フィクスチャを生成する。

使い方:
    python legacy/parity_dump.py > packages/shared/src/__fixtures__/flask-parity.json

ケースの制約:
  - 合計が人数で割り切れること（TS 版は端数処理を整数演算に直しているため）
  - メンバーは名前の昇順で並べること（Python は安定ソート、TS は id 昇順で tie-break するため）
"""

import json
import sys

from app import calculate_settlements

CASES = [
    {"name": "2人・片方が全額立て替え", "members": [{"name": "A", "paid": 10000}, {"name": "B", "paid": 0}]},
    {"name": "3人・全員同額", "members": [{"name": "A", "paid": 3000}, {"name": "B", "paid": 3000}, {"name": "C", "paid": 3000}]},
    {"name": "3人・1人が多く立て替え", "members": [{"name": "A", "paid": 6000}, {"name": "B", "paid": 3000}, {"name": "C", "paid": 0}]},
    {"name": "4人・債権者が2人", "members": [{"name": "A", "paid": 8000}, {"name": "B", "paid": 0}, {"name": "C", "paid": 4000}, {"name": "D", "paid": 0}]},
    {"name": "5人・ばらばら", "members": [{"name": "A", "paid": 12000}, {"name": "B", "paid": 5000}, {"name": "C", "paid": 3000}, {"name": "D", "paid": 0}, {"name": "E", "paid": 0}]},
    {"name": "2人・全員0円", "members": [{"name": "A", "paid": 0}, {"name": "B", "paid": 0}]},
    {"name": "6人・2人だけ立て替え", "members": [{"name": "A", "paid": 18000}, {"name": "B", "paid": 0}, {"name": "C", "paid": 0}, {"name": "D", "paid": 6000}, {"name": "E", "paid": 0}, {"name": "F", "paid": 0}]},
]


def main() -> None:
    dumped = []
    for case in CASES:
        members = [dict(member) for member in case["members"]]
        total = sum(member["paid"] for member in members)
        if total % len(members) != 0:
            raise ValueError(f"{case['name']}: 合計 {total} が人数 {len(members)} で割り切れない")

        total_out, per_person, settlements = calculate_settlements(members)
        dumped.append({
            "name": case["name"],
            "members": case["members"],
            "total": total_out,
            "perPerson": per_person,
            "transfers": [
                {"fromId": s["from"], "toId": s["to"], "amount": s["amount"]}
                for s in settlements
            ],
        })

    json.dump(dumped, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: フィクスチャを生成する**

```bash
mkdir -p packages/shared/src/__fixtures__
cd legacy && python parity_dump.py > ../packages/shared/src/__fixtures__/flask-parity.json && cd ..
```

`legacy` ディレクトリで実行するのは `from app import calculate_settlements` を解決するため。

Expected: `packages/shared/src/__fixtures__/flask-parity.json` に7件の配列が書かれる。中身を目視して、`transfers` が空でないケースが少なくとも5件あることを確認する。

- [ ] **Step 3: パリティテストを書く**

`packages/shared/src/settlement.parity.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import parityCases from "./__fixtures__/flask-parity.json";
import { calculateSettlement } from "./settlement.js";
import type { Participant } from "./types.js";

type ParityCase = {
  name: string;
  members: { name: string; paid: number }[];
  total: number;
  perPerson: number;
  transfers: { fromId: string; toId: string; amount: number }[];
};

const cases = parityCases as ParityCase[];

describe("Flask 実装とのパリティ", () => {
  it("フィクスチャが空でない", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases)("$name", (parityCase) => {
    // Flask はメンバーを名前で識別するため、id にも名前を使う
    const participants: Participant[] = parityCase.members.map((member) => ({
      id: member.name,
      name: member.name,
      paid: member.paid,
    }));

    const result = calculateSettlement(participants);

    expect(result.total).toBe(parityCase.total);
    expect(result.perPerson).toBe(parityCase.perPerson);
    expect(result.transfers).toEqual(parityCase.transfers);
  });
});
```

- [ ] **Step 4: テストを実行する**

Run: `npm test -w @warikan/shared`
Expected: PASS（31 tests）

不一致が出た場合、まず TS 側が正しいか手計算で検証すること。Flask 側の丸め由来の差であれば、そのケースをフィクスチャから外し、`CASES` のコメントに理由を書く。TS 側のバグであれば `settlement.ts` を直す。

- [ ] **Step 5: コミット**

```bash
git add legacy/parity_dump.py packages/shared
git commit -m "test: Flask 実装との同値性検証を追加"
```

---

## Task 7: API 骨格・D1・マイグレーション・統合テスト基盤

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/wrangler.jsonc`, `apps/api/vitest.config.ts`
- Create: `apps/api/src/env.ts`, `apps/api/src/index.ts`, `apps/api/src/lib/response.ts`, `apps/api/src/lib/ids.ts`, `apps/api/src/middleware/errors.ts`
- Create: `apps/api/migrations/0001_init.sql`, `apps/api/migrations/0002_categories.sql`
- Create: `apps/api/test/apply-migrations.ts`, `apps/api/test/health.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: なし
- Produces:
  - `type Env`（`DB` / `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` / `ACCESS_ALLOWED_EMAILS` / `DEV_BYPASS_EMAIL`）
  - `ok<T>(data: T)` / `fail(code, message, fields?)`
  - `newId(): string`
  - `type AppEnv = { Bindings: Env; Variables: { user: AuthUser } }`（`user` は Task 8 で設定）
  - `app`（Hono インスタンス、default export）

- [ ] **Step 1: D1 データベースを作成する**

```bash
npx wrangler d1 create warikan-db
```

出力に含まれる `database_id`（UUID）を控える。次のステップで `wrangler.jsonc` に貼る。

- [ ] **Step 2: api パッケージと Worker 設定を作成する**

`apps/api/package.json`:

```json
{
  "name": "@warikan/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "migrate:local": "wrangler d1 migrations apply warikan-db --local",
    "migrate:remote": "wrangler d1 migrations apply warikan-db --remote"
  }
}
```

`apps/api/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["@cloudflare/workers-types", "@cloudflare/vitest-pool-workers"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "worker-configuration.d.ts"]
}
```

`apps/api/wrangler.jsonc`（`database_id` は Step 1 で控えた実際の UUID に置き換える）:

```jsonc
{
  "$schema": "../../node_modules/wrangler/config-schema.json",
  "name": "warikan",
  "main": "src/index.ts",
  "compatibility_date": "2026-08-01",
  "workers_dev": true,
  "observability": { "enabled": true },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "warikan-db",
      "database_id": "<Step 1 で控えた UUID>",
      "migrations_dir": "migrations"
    }
  ],
  "vars": {
    "ACCESS_TEAM_DOMAIN": ""
  }
}
```

`ACCESS_AUD` と `ACCESS_ALLOWED_EMAILS` は secret として設定するため `vars` には書かない（Plan 3 で `wrangler secret put` する）。

- [ ] **Step 3: 依存をインストールする**

```bash
npm install hono jose zod -w @warikan/api
npm install -D wrangler @cloudflare/workers-types @cloudflare/vitest-pool-workers -w @warikan/api
npm install @warikan/shared -w @warikan/api
```

`@warikan/shared` はワークスペース内解決されるので、バージョン指定は不要。

- [ ] **Step 4: .gitignore に Worker 由来の生成物を追加する**

`.gitignore` の `# Cloudflare / Wrangler` セクションに追記:

```
apps/api/worker-configuration.d.ts
```

型定義は `wrangler types` で再生成できるためコミットしない。

- [ ] **Step 5: マイグレーションを書く**

`apps/api/migrations/0001_init.sql`:

```sql
CREATE TABLE users (
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE TABLE categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE monthly_periods (
  id            TEXT PRIMARY KEY,
  year          INTEGER NOT NULL,
  month         INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open',
  settled_at    TEXT,
  snapshot_json TEXT,
  is_dirty      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  UNIQUE (year, month)
);

CREATE TABLE monthly_expenses (
  id          TEXT PRIMARY KEY,
  period_id   TEXT NOT NULL REFERENCES monthly_periods(id) ON DELETE CASCADE,
  paid_by     TEXT NOT NULL REFERENCES users(id),
  amount      INTEGER NOT NULL,
  item_name   TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id),
  spent_on    TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX idx_monthly_expenses_period ON monthly_expenses(period_id, spent_on);

CREATE TABLE events (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  mode       TEXT NOT NULL,
  total      INTEGER NOT NULL,
  per_person INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE event_members (
  id       TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name     TEXT NOT NULL,
  paid     INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL
);

CREATE INDEX idx_event_members_event ON event_members(event_id, position);

CREATE TABLE event_items (
  id                TEXT PRIMARY KEY,
  event_id          TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  amount            INTEGER NOT NULL,
  paid_by_member_id TEXT NOT NULL REFERENCES event_members(id) ON DELETE CASCADE,
  position          INTEGER NOT NULL
);

CREATE INDEX idx_event_items_event ON event_items(event_id, position);

CREATE TABLE event_settlements (
  id             TEXT PRIMARY KEY,
  event_id       TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  from_member_id TEXT NOT NULL REFERENCES event_members(id) ON DELETE CASCADE,
  to_member_id   TEXT NOT NULL REFERENCES event_members(id) ON DELETE CASCADE,
  amount         INTEGER NOT NULL,
  is_paid        INTEGER NOT NULL DEFAULT 0,
  position       INTEGER NOT NULL
);

CREATE INDEX idx_event_settlements_event ON event_settlements(event_id, position);
```

`apps/api/migrations/0002_categories.sql`:

```sql
INSERT INTO categories (name, sort_order, is_active) VALUES
  ('食費', 10, 1),
  ('日用品', 20, 1),
  ('外食', 30, 1),
  ('光熱費', 40, 1),
  ('交通費', 50, 1),
  ('娯楽', 60, 1),
  ('その他', 99, 1);
```

最終行がコメントで終わらないよう注意する（`readD1Migrations` の分割に既知の不具合があるため）。

- [ ] **Step 6: Env とレスポンスヘルパを書く**

`apps/api/src/env.ts`:

```ts
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
```

`apps/api/src/lib/response.ts`:

```ts
export type Ok<T> = { ok: true; data: T };
export type Fail = {
  ok: false;
  error: { code: string; message: string; fields?: Record<string, string> };
};

export const ok = <T>(data: T): Ok<T> => ({ ok: true, data });

export const fail = (code: string, message: string, fields?: Record<string, string>): Fail => ({
  ok: false,
  error: fields ? { code, message, fields } : { code, message },
});
```

`apps/api/src/lib/ids.ts`:

```ts
export const newId = (): string => crypto.randomUUID();

export const nowIso = (): string => new Date().toISOString();
```

- [ ] **Step 7: エラーミドルウェアとアプリ本体を書く**

`apps/api/src/middleware/errors.ts`:

```ts
import { HTTPException } from "hono/http-exception";
import type { ErrorHandler } from "hono";

import type { AppEnv } from "../env.js";
import { fail } from "../lib/response.js";

export const onError: ErrorHandler<AppEnv> = (err, c) => {
  if (err instanceof HTTPException) {
    return c.json(fail(err.message || "HTTP_ERROR", err.message), err.status);
  }

  // 内部エラーの詳細はクライアントに返さない
  console.error("unhandled error", err);
  return c.json(fail("INTERNAL_ERROR", "処理中にエラーが発生しました"), 500);
};
```

`apps/api/src/index.ts`:

```ts
import { Hono } from "hono";

import type { AppEnv } from "./env.js";
import { ok } from "./lib/response.js";
import { onError } from "./middleware/errors.js";

const app = new Hono<AppEnv>();

app.onError(onError);

app.get("/api/health", (c) => c.json(ok({ status: "ok" })));

app.notFound((c) => c.json({ ok: false, error: { code: "NOT_FOUND", message: "見つかりません" } }, 404));

export default app;
```

`/api/health` は認証を通さない。疎通確認専用で、いかなるデータも返さない。

- [ ] **Step 8: 統合テスト基盤を設定する**

`apps/api/vitest.config.ts`:

```ts
import path from "node:path";

import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));

      return {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            ACCESS_TEAM_DOMAIN: "test.cloudflareaccess.com",
            ACCESS_AUD: "test-audience",
            ACCESS_ALLOWED_EMAILS: "me@example.com,partner@example.com",
          },
        },
      };
    }),
  ],
  test: {
    setupFiles: ["./test/apply-migrations.ts"],
  },
});
```

`apps/api/test/apply-migrations.ts`:

```ts
import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

// setup ファイルはテストファイルごとのストレージ分離の外で、複数回実行されうる。
// applyD1Migrations は未適用のものだけを適用するので、ここで呼んで安全。
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
```

- [ ] **Step 9: Worker の型を生成する**

```bash
npm run --workspace @warikan/api exec -- wrangler types
```

生成された `apps/api/worker-configuration.d.ts` に `TEST_MIGRATIONS` が含まれない場合は、`apps/api/test/env.d.ts` を作って補う:

```ts
import type { D1Migration } from "@cloudflare/vitest-pool-workers";

declare module "cloudflare:workers" {
  interface Env {
    TEST_MIGRATIONS: D1Migration[];
  }
}
```

- [ ] **Step 10: 疎通テストを書いて失敗させる**

`apps/api/test/health.test.ts`:

```ts
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("疎通と DB の初期状態", () => {
  it("GET /api/health が 200 を返す", async () => {
    const res = await exports.default.fetch(new Request("https://warikan.test/api/health"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, data: { status: "ok" } });
  });

  it("未定義のパスは 404 エンベロープを返す", async () => {
    const res = await exports.default.fetch(new Request("https://warikan.test/api/nope"));

    expect(res.status).toBe(404);
  });

  it("マイグレーションでカテゴリが7件投入されている", async () => {
    const result = await env.DB.prepare("SELECT COUNT(*) AS count FROM categories").first<{ count: number }>();

    expect(result?.count).toBe(7);
  });

  it("全テーブルが作成されている", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all<{ name: string }>();
    const names = results.map((row) => row.name);

    for (const table of [
      "users",
      "categories",
      "monthly_periods",
      "monthly_expenses",
      "events",
      "event_members",
      "event_items",
      "event_settlements",
    ]) {
      expect(names).toContain(table);
    }
  });
});
```

- [ ] **Step 11: テストを実行する**

Run: `npm test -w @warikan/api`
Expected: PASS（4 tests）

`exports` が `cloudflare:workers` から解決できないエラーが出た場合は、インストールされた `@cloudflare/vitest-pool-workers` が古い。`import { SELF } from "cloudflare:test"` に切り替え、`exports.default.fetch(...)` を `SELF.fetch(...)` に置き換える。以降のタスクのテストも同様に読み替えること。

- [ ] **Step 12: ローカル D1 にマイグレーションを適用して確認する**

```bash
npm run migrate:local -w @warikan/api
```

Expected: 2件のマイグレーションが適用された旨が表示される

- [ ] **Step 13: コミット**

```bash
git add apps .gitignore package-lock.json
git commit -m "feat: Hono アプリの骨格と D1 スキーマ、統合テスト基盤を追加"
```

---

## Task 8: Cloudflare Access の JWT 検証ミドルウェア

**Files:**
- Create: `apps/api/src/middleware/auth.ts`
- Create: `apps/api/src/db/rows.ts`, `apps/api/src/db/users.ts`
- Create: `apps/api/test/helpers.ts`, `apps/api/test/auth.test.ts`
- Modify: `apps/api/src/index.ts`

**Interfaces:**
- Consumes: `Env` / `AuthUser` / `AppEnv`（Task 7）、`newId` / `nowIso`（Task 7）
- Produces:
  - `accessAuth(options?: { keyResolver?: JWTVerifyGetKey }): MiddlewareHandler<AppEnv>` — `keyResolver` を渡すと JWKS の取得先を差し替えられる（テスト用の唯一の接合部）
  - `findUserByEmail(db, email): Promise<UserRow | null>`
  - `createUser(db, email, displayName): Promise<UserRow>`
  - `type UserRow = { id: string; email: string; display_name: string; created_at: string }`
  - テストヘルパ `authedRequest(path, init?)` — `DEV_BYPASS_EMAIL` 経由で認証済みリクエストを作る

- [ ] **Step 1: 行の型と users のクエリを書く**

`apps/api/src/db/rows.ts`:

```ts
export type UserRow = {
  id: string;
  email: string;
  display_name: string;
  created_at: string;
};

export type CategoryRow = {
  id: number;
  name: string;
  sort_order: number;
  is_active: number;
};

export type MonthlyPeriodRow = {
  id: string;
  year: number;
  month: number;
  status: string;
  settled_at: string | null;
  snapshot_json: string | null;
  is_dirty: number;
  created_at: string;
};

export type MonthlyExpenseRow = {
  id: string;
  period_id: string;
  paid_by: string;
  amount: number;
  item_name: string;
  category_id: number | null;
  spent_on: string;
  created_at: string;
  updated_at: string;
};

export type EventRow = {
  id: string;
  title: string;
  mode: string;
  total: number;
  per_person: number;
  created_at: string;
};

export type EventMemberRow = {
  id: string;
  event_id: string;
  name: string;
  paid: number;
  position: number;
};

export type EventItemRow = {
  id: string;
  event_id: string;
  name: string;
  amount: number;
  paid_by_member_id: string;
  position: number;
};

export type EventSettlementRow = {
  id: string;
  event_id: string;
  from_member_id: string;
  to_member_id: string;
  amount: number;
  is_paid: number;
  position: number;
};
```

`apps/api/src/db/users.ts`:

```ts
import { newId, nowIso } from "../lib/ids.js";
import type { UserRow } from "./rows.js";

export async function findUserByEmail(db: D1Database, email: string): Promise<UserRow | null> {
  return db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first<UserRow>();
}

export async function listUsers(db: D1Database): Promise<UserRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM users ORDER BY created_at, id")
    .all<UserRow>();
  return results;
}

export async function createUser(db: D1Database, email: string, displayName: string): Promise<UserRow> {
  const row: UserRow = {
    id: newId(),
    email,
    display_name: displayName,
    created_at: nowIso(),
  };

  await db
    .prepare("INSERT INTO users (id, email, display_name, created_at) VALUES (?, ?, ?, ?)")
    .bind(row.id, row.email, row.display_name, row.created_at)
    .run();

  return row;
}

export async function updateDisplayName(
  db: D1Database,
  userId: string,
  displayName: string,
): Promise<void> {
  await db
    .prepare("UPDATE users SET display_name = ? WHERE id = ?")
    .bind(displayName, userId)
    .run();
}
```

- [ ] **Step 2: 認証ミドルウェアを書く**

`apps/api/src/middleware/auth.ts`:

```ts
import type { JWTVerifyGetKey } from "jose";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { MiddlewareHandler } from "hono";

import { createUser, findUserByEmail } from "../db/users.js";
import type { AppEnv, Env } from "../env.js";
import { fail } from "../lib/response.js";

const jwksCache = new Map<string, JWTVerifyGetKey>();

function remoteJwks(teamDomain: string): JWTVerifyGetKey {
  const cached = jwksCache.get(teamDomain);
  if (cached) return cached;

  const jwks = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
  jwksCache.set(teamDomain, jwks);
  return jwks;
}

function allowedEmails(env: Env): string[] {
  return env.ACCESS_ALLOWED_EMAILS.split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

/**
 * Cloudflare Access が付与する JWT を検証し、users の行を c.var.user に載せる。
 *
 * Cf-Access-Authenticated-User-Email ヘッダは Access を経由しないリクエストで
 * 詐称できるため使わない。必ず Cf-Access-Jwt-Assertion の署名を検証する。
 */
export function accessAuth(options: { keyResolver?: JWTVerifyGetKey } = {}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const env = c.env;
    const allowed = allowedEmails(env);
    let email: string;

    if (env.DEV_BYPASS_EMAIL) {
      email = env.DEV_BYPASS_EMAIL.trim().toLowerCase();
    } else {
      const token = c.req.header("Cf-Access-Jwt-Assertion");
      if (!token) {
        return c.json(fail("FORBIDDEN", "アクセス権がありません"), 403);
      }

      try {
        const keyResolver = options.keyResolver ?? remoteJwks(env.ACCESS_TEAM_DOMAIN);
        const { payload } = await jwtVerify(token, keyResolver, {
          issuer: `https://${env.ACCESS_TEAM_DOMAIN}`,
          audience: env.ACCESS_AUD,
        });

        const claim = payload.email;
        if (typeof claim !== "string" || claim.length === 0) {
          return c.json(fail("FORBIDDEN", "アクセス権がありません"), 403);
        }
        email = claim.trim().toLowerCase();
      } catch {
        return c.json(fail("FORBIDDEN", "アクセス権がありません"), 403);
      }
    }

    if (!allowed.includes(email)) {
      return c.json(fail("FORBIDDEN", "アクセス権がありません"), 403);
    }

    const existing = await findUserByEmail(env.DB, email);
    const row = existing ?? (await createUser(env.DB, email, email.split("@")[0] ?? email));

    c.set("user", { id: row.id, email: row.email, displayName: row.display_name });
    await next();
  };
}
```

`DEV_BYPASS_EMAIL` が設定されていても、そのメールが `ACCESS_ALLOWED_EMAILS` に含まれていなければ 403 になる。バイパスは「JWT の検証を省く」だけで、許可リストは常に効く。

- [ ] **Step 3: ミドルウェアをアプリに組み込む**

`apps/api/src/index.ts` を次に置き換える:

```ts
import { Hono } from "hono";

import type { AppEnv } from "./env.js";
import { ok } from "./lib/response.js";
import { accessAuth } from "./middleware/auth.js";
import { onError } from "./middleware/errors.js";

const app = new Hono<AppEnv>();

app.onError(onError);

app.get("/api/health", (c) => c.json(ok({ status: "ok" })));

app.use("/api/*", accessAuth());

app.notFound((c) => c.json({ ok: false, error: { code: "NOT_FOUND", message: "見つかりません" } }, 404));

export default app;
```

`/api/health` を `app.use` より前に登録することで、疎通確認だけは認証なしで通る。

- [ ] **Step 4: テストヘルパを書く**

`apps/api/test/helpers.ts`:

```ts
import { env, exports } from "cloudflare:workers";

export const ALLOWED_EMAIL = "me@example.com";
export const PARTNER_EMAIL = "partner@example.com";

const BASE = "https://warikan.test";

/** DEV_BYPASS_EMAIL 経由で認証済みのリクエストを送る。 */
export async function authedFetch(
  path: string,
  init: RequestInit = {},
  asEmail: string = ALLOWED_EMAIL,
): Promise<Response> {
  return exports.default.fetch(new Request(`${BASE}${path}`, init), {
    ...env,
    DEV_BYPASS_EMAIL: asEmail,
  });
}

/** 認証を通さないリクエストを送る。 */
export async function anonFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return exports.default.fetch(new Request(`${BASE}${path}`, init), {
    ...env,
    DEV_BYPASS_EMAIL: undefined,
  });
}

export async function jsonBody<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** POST / PATCH 用の JSON リクエスト init を作る。 */
export const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** テスト間で DB を空に戻す。 */
export async function resetDb(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM event_settlements"),
    env.DB.prepare("DELETE FROM event_items"),
    env.DB.prepare("DELETE FROM event_members"),
    env.DB.prepare("DELETE FROM events"),
    env.DB.prepare("DELETE FROM monthly_expenses"),
    env.DB.prepare("DELETE FROM monthly_periods"),
    env.DB.prepare("DELETE FROM users"),
  ]);
}
```

`exports.default.fetch` の第2引数で env を差し替えられない場合は、`vitest.config.ts` の `miniflare.bindings` に `DEV_BYPASS_EMAIL: "me@example.com"` を追加し、`anonFetch` 用には別ファイルの `describe` で `vi.stubEnv` を使う方針に切り替える。テスト実行時に判断すること。

- [ ] **Step 5: 認証の失敗テストを書く**

`apps/api/test/auth.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { beforeEach, describe, expect, it } from "vitest";

import type { AppEnv } from "../src/env.js";
import { accessAuth } from "../src/middleware/auth.js";
import { ALLOWED_EMAIL, anonFetch, authedFetch, jsonBody, resetDb } from "./helpers.js";

type Envelope = { ok: boolean; error?: { code: string } };

describe("Access 認証", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("Cf-Access-Jwt-Assertion が無ければ 403", async () => {
    const res = await anonFetch("/api/me");

    expect(res.status).toBe(403);
    const body = await jsonBody<Envelope>(res);
    expect(body.error?.code).toBe("FORBIDDEN");
  });

  it("署名が検証できないトークンは 403", async () => {
    const res = await anonFetch("/api/me", {
      headers: { "Cf-Access-Jwt-Assertion": "not.a.valid.jwt" },
    });

    expect(res.status).toBe(403);
  });

  it("許可リストに無いメールは 403", async () => {
    const res = await authedFetch("/api/me", {}, "stranger@example.com");

    expect(res.status).toBe(403);
  });

  it("許可されたメールなら 200 で、users に行が自動作成される", async () => {
    const res = await authedFetch("/api/me");

    expect(res.status).toBe(200);

    const row = await env.DB.prepare("SELECT * FROM users WHERE email = ?")
      .bind(ALLOWED_EMAIL)
      .first<{ display_name: string }>();
    expect(row?.display_name).toBe("me");
  });

  it("2回目のアクセスで重複した users 行を作らない", async () => {
    await authedFetch("/api/me");
    await authedFetch("/api/me");

    const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM users").first<{ count: number }>();
    expect(row?.count).toBe(1);
  });

  it("エラーレスポンスに内部情報を含めない", async () => {
    const res = await anonFetch("/api/me");
    const text = await res.text();

    expect(text).not.toContain("jwt");
    expect(text).not.toContain("JWKS");
    expect(text).toContain("アクセス権がありません");
  });

});

describe("JWT の検証", () => {
  beforeEach(async () => {
    await resetDb();
  });

  /** 鍵を差し替えたミドルウェアだけを載せた最小アプリを組み立てる。 */
  async function probeApp() {
    const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
    const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), alg: "RS256" }] });

    const app = new Hono<AppEnv>();
    app.use("*", accessAuth({ keyResolver: jwks }));
    app.get("/probe", (c) => c.json({ email: c.get("user").email }));

    const call = (token: string) =>
      app.fetch(new Request("https://warikan.test/probe", { headers: { "Cf-Access-Jwt-Assertion": token } }), {
        ...env,
        DEV_BYPASS_EMAIL: undefined,
      });

    return { privateKey, call };
  }

  const sign = (privateKey: CryptoKey, overrides: { issuer?: string; audience?: string; expiresIn?: string }) =>
    new SignJWT({ email: ALLOWED_EMAIL })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(overrides.issuer ?? `https://${env.ACCESS_TEAM_DOMAIN}`)
      .setAudience(overrides.audience ?? env.ACCESS_AUD)
      .setIssuedAt()
      .setExpirationTime(overrides.expiresIn ?? "5m")
      .sign(privateKey);

  it("正しく署名された JWT を受理する", async () => {
    const { privateKey, call } = await probeApp();
    const res = await call(await sign(privateKey, {}));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ email: ALLOWED_EMAIL });
  });

  it("issuer が違う JWT は 403", async () => {
    const { privateKey, call } = await probeApp();
    const res = await call(await sign(privateKey, { issuer: "https://evil.example.com" }));

    expect(res.status).toBe(403);
  });

  it("audience が違う JWT は 403", async () => {
    const { privateKey, call } = await probeApp();
    const res = await call(await sign(privateKey, { audience: "someone-elses-app" }));

    expect(res.status).toBe(403);
  });

  it("期限切れの JWT は 403", async () => {
    const { privateKey, call } = await probeApp();
    const res = await call(await sign(privateKey, { expiresIn: "-1m" }));

    expect(res.status).toBe(403);
  });

  it("別の鍵で署名された JWT は 403", async () => {
    const { call } = await probeApp();
    const { privateKey: otherKey } = await generateKeyPair("RS256", { extractable: true });
    const res = await call(await sign(otherKey, {}));

    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 6: `/api/me` が未実装のため失敗することを確認する**

Run: `npm test -w @warikan/api`
Expected: FAIL — `/api/me` が 404 を返し、200 を期待するテストが落ちる。403 系のテストは通る

- [ ] **Step 7: 仮の `/api/me` を追加する**

`apps/api/src/index.ts` の `app.use("/api/*", accessAuth());` の直後に追加:

```ts
app.get("/api/me", (c) => {
  const user = c.get("user");
  return c.json(ok({ userId: user.id, email: user.email, displayName: user.displayName }));
});
```

- [ ] **Step 8: テストを実行して成功することを確認する**

Run: `npm test -w @warikan/api`
Expected: PASS（health 4件 + auth 6件 + JWT 検証 5件）

- [ ] **Step 9: コミット**

```bash
git add apps/api
git commit -m "feat: Cloudflare Access の JWT 検証ミドルウェアとユーザー自動作成を追加"
```

---

## Task 9: `/api/me` と `/api/categories`

**Files:**
- Create: `apps/api/src/routes/me.ts`, `apps/api/src/routes/categories.ts`
- Create: `apps/api/src/db/categories.ts`
- Create: `apps/api/test/me.test.ts`, `apps/api/test/categories.test.ts`
- Modify: `apps/api/src/index.ts`

**Interfaces:**
- Consumes: `AppEnv`（Task 7）、`updateDisplayName`（Task 8）
- Produces:
  - `meRoutes: Hono<AppEnv>` — `GET /` と `PATCH /`
  - `categoryRoutes: Hono<AppEnv>` — `GET /`
  - `listActiveCategories(db): Promise<CategoryRow[]>`

- [ ] **Step 1: 失敗するテストを書く**

`apps/api/test/me.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";

import { ALLOWED_EMAIL, authedFetch, jsonBody, jsonInit, resetDb } from "./helpers.js";

type MeData = { userId: string; email: string; displayName: string };
type Envelope<T> = { ok: boolean; data?: T; error?: { code: string; fields?: Record<string, string> } };

describe("GET /api/me", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("自分の情報を返す", async () => {
    const res = await authedFetch("/api/me");
    const body = await jsonBody<Envelope<MeData>>(res);

    expect(res.status).toBe(200);
    expect(body.data?.email).toBe(ALLOWED_EMAIL);
    expect(body.data?.displayName).toBe("me");
    expect(body.data?.userId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("PATCH /api/me", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("表示名を変更できる", async () => {
    await authedFetch("/api/me");

    const res = await authedFetch("/api/me", jsonInit("PATCH", { displayName: "僕" }));
    const body = await jsonBody<Envelope<MeData>>(res);

    expect(res.status).toBe(200);
    expect(body.data?.displayName).toBe("僕");

    const after = await jsonBody<Envelope<MeData>>(await authedFetch("/api/me"));
    expect(after.data?.displayName).toBe("僕");
  });

  it("空の表示名は 400", async () => {
    const res = await authedFetch("/api/me", jsonInit("PATCH", { displayName: "   " }));

    expect(res.status).toBe(400);
    const body = await jsonBody<Envelope<MeData>>(res);
    expect(body.error?.code).toBe("VALIDATION_ERROR");
  });

  it("21文字以上の表示名は 400", async () => {
    const res = await authedFetch("/api/me", jsonInit("PATCH", { displayName: "あ".repeat(21) }));

    expect(res.status).toBe(400);
  });
});
```

`apps/api/test/categories.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { anonFetch, authedFetch, jsonBody, resetDb } from "./helpers.js";

type Category = { id: number; name: string };
type Envelope<T> = { ok: boolean; data?: T };

describe("GET /api/categories", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("有効なカテゴリを sort_order 順で返す", async () => {
    const res = await authedFetch("/api/categories");
    const body = await jsonBody<Envelope<Category[]>>(res);

    expect(res.status).toBe(200);
    expect(body.data?.map((category) => category.name)).toEqual([
      "食費",
      "日用品",
      "外食",
      "光熱費",
      "交通費",
      "娯楽",
      "その他",
    ]);
  });

  it("is_active が 0 のカテゴリは返さない", async () => {
    await env.DB.prepare("UPDATE categories SET is_active = 0 WHERE name = ?").bind("娯楽").run();

    const body = await jsonBody<Envelope<Category[]>>(await authedFetch("/api/categories"));

    expect(body.data?.map((category) => category.name)).not.toContain("娯楽");

    await env.DB.prepare("UPDATE categories SET is_active = 1 WHERE name = ?").bind("娯楽").run();
  });

  it("認証なしでは 403", async () => {
    const res = await anonFetch("/api/categories");

    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: テストを実行して失敗することを確認する**

Run: `npm test -w @warikan/api`
Expected: FAIL — `PATCH /api/me` と `GET /api/categories` が 404

- [ ] **Step 3: categories のクエリを書く**

`apps/api/src/db/categories.ts`:

```ts
import type { CategoryRow } from "./rows.js";

export async function listActiveCategories(db: D1Database): Promise<CategoryRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order, id")
    .all<CategoryRow>();
  return results;
}

export async function categoryExists(db: D1Database, id: number): Promise<boolean> {
  const row = await db
    .prepare("SELECT id FROM categories WHERE id = ? AND is_active = 1")
    .bind(id)
    .first<{ id: number }>();
  return row !== null;
}
```

- [ ] **Step 4: ルートを書く**

`apps/api/src/routes/me.ts`:

```ts
import { Hono } from "hono";
import { z } from "zod";

import { updateDisplayName } from "../db/users.js";
import type { AppEnv } from "../env.js";
import { fail, ok } from "../lib/response.js";

const patchSchema = z.object({
  displayName: z.string().trim().min(1).max(20),
});

export const meRoutes = new Hono<AppEnv>();

meRoutes.get("/", (c) => {
  const user = c.get("user");
  return c.json(ok({ userId: user.id, email: user.email, displayName: user.displayName }));
});

meRoutes.patch("/", async (c) => {
  const parsed = patchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(fail("VALIDATION_ERROR", "表示名は1〜20文字で入力してください", { displayName: "1〜20文字" }), 400);
  }

  const user = c.get("user");
  await updateDisplayName(c.env.DB, user.id, parsed.data.displayName);

  return c.json(ok({ userId: user.id, email: user.email, displayName: parsed.data.displayName }));
});
```

`apps/api/src/routes/categories.ts`:

```ts
import { Hono } from "hono";

import { listActiveCategories } from "../db/categories.js";
import type { AppEnv } from "../env.js";
import { ok } from "../lib/response.js";

export const categoryRoutes = new Hono<AppEnv>();

categoryRoutes.get("/", async (c) => {
  const rows = await listActiveCategories(c.env.DB);

  return c.json(ok(rows.map((row) => ({ id: row.id, name: row.name }))));
});
```

- [ ] **Step 5: ルートを登録する**

`apps/api/src/index.ts` の仮の `/api/me` ハンドラを削除し、代わりに次を追加する:

```ts
import { categoryRoutes } from "./routes/categories.js";
import { meRoutes } from "./routes/me.js";

// ... app.use("/api/*", accessAuth()); の後
app.route("/api/me", meRoutes);
app.route("/api/categories", categoryRoutes);
```

- [ ] **Step 6: テストを実行して成功することを確認する**

Run: `npm test -w @warikan/api`
Expected: PASS（health 4 + auth 7 + me 4 + categories 3 = 18 tests）

- [ ] **Step 7: コミット**

```bash
git add apps/api
git commit -m "feat: /api/me と /api/categories を追加"
```

---

## Task 10: 月次の期間取得と暗黙作成

**Files:**
- Create: `apps/api/src/db/monthly.ts`, `apps/api/src/routes/monthly.ts`, `apps/api/src/lib/ym.ts`
- Create: `apps/api/test/monthly-period.test.ts`
- Modify: `apps/api/src/index.ts`

**Interfaces:**
- Consumes: `AppEnv`（Task 7）
- Produces:
  - `parseYm(ym: string): { year: number; month: number } | null`
  - `formatYm(year: number, month: number): string`
  - `getOrCreatePeriod(db, year, month): Promise<MonthlyPeriodRow>`
  - `listPeriods(db): Promise<MonthlyPeriodRow[]>`
  - `listExpenses(db, periodId): Promise<MonthlyExpenseRow[]>`
  - `monthlyRoutes: Hono<AppEnv>`

- [ ] **Step 1: 失敗するテストを書く**

`apps/api/test/monthly-period.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { anonFetch, authedFetch, jsonBody, resetDb } from "./helpers.js";

type Period = {
  ym: string;
  year: number;
  month: number;
  status: string;
  isDirty: boolean;
};
type PeriodData = { period: Period; expenses: unknown[] };
type Envelope<T> = { ok: boolean; data?: T; error?: { code: string } };

describe("GET /api/monthly/:ym", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("存在しない月なら open の期間を作って返す", async () => {
    const res = await authedFetch("/api/monthly/2026-08");
    const body = await jsonBody<Envelope<PeriodData>>(res);

    expect(res.status).toBe(200);
    expect(body.data?.period.ym).toBe("2026-08");
    expect(body.data?.period.year).toBe(2026);
    expect(body.data?.period.month).toBe(8);
    expect(body.data?.period.status).toBe("open");
    expect(body.data?.period.isDirty).toBe(false);
    expect(body.data?.expenses).toEqual([]);
  });

  it("2回呼んでも期間の行は1つだけ", async () => {
    await authedFetch("/api/monthly/2026-08");
    await authedFetch("/api/monthly/2026-08");

    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM monthly_periods WHERE year = 2026 AND month = 8",
    ).first<{ count: number }>();

    expect(row?.count).toBe(1);
  });

  it("不正な年月フォーマットは 400", async () => {
    for (const ym of ["2026-8", "202608", "2026-13", "2026-00", "abcd-ef"]) {
      const res = await authedFetch(`/api/monthly/${ym}`);
      expect(res.status, `ym=${ym}`).toBe(400);
    }
  });

  it("認証なしでは 403", async () => {
    const res = await anonFetch("/api/monthly/2026-08");

    expect(res.status).toBe(403);
  });
});

describe("GET /api/monthly", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("期間が無ければ空配列を返す", async () => {
    const body = await jsonBody<Envelope<Period[]>>(await authedFetch("/api/monthly"));

    expect(body.data).toEqual([]);
  });

  it("新しい月が先に来る順で返す", async () => {
    await authedFetch("/api/monthly/2026-06");
    await authedFetch("/api/monthly/2026-08");
    await authedFetch("/api/monthly/2026-07");

    const body = await jsonBody<Envelope<Period[]>>(await authedFetch("/api/monthly"));

    expect(body.data?.map((period) => period.ym)).toEqual(["2026-08", "2026-07", "2026-06"]);
  });
});
```

- [ ] **Step 2: テストを実行して失敗することを確認する**

Run: `npm test -w @warikan/api`
Expected: FAIL — `/api/monthly/*` が 404

- [ ] **Step 3: 年月のパースを書く**

`apps/api/src/lib/ym.ts`:

```ts
const YM_PATTERN = /^(\d{4})-(\d{2})$/;

export function parseYm(ym: string): { year: number; month: number } | null {
  const matched = YM_PATTERN.exec(ym);
  if (!matched) return null;

  const year = Number(matched[1]);
  const month = Number(matched[2]);
  if (year < 2000 || year > 2100) return null;
  if (month < 1 || month > 12) return null;

  return { year, month };
}

export const formatYm = (year: number, month: number): string =>
  `${year}-${String(month).padStart(2, "0")}`;

/** その年月の日数。spent_on の範囲検証に使う。 */
export const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();
```

- [ ] **Step 4: monthly のクエリを書く**

`apps/api/src/db/monthly.ts`:

```ts
import { newId, nowIso } from "../lib/ids.js";
import type { MonthlyExpenseRow, MonthlyPeriodRow } from "./rows.js";

export async function getOrCreatePeriod(
  db: D1Database,
  year: number,
  month: number,
): Promise<MonthlyPeriodRow> {
  await db
    .prepare(
      `INSERT INTO monthly_periods (id, year, month, status, is_dirty, created_at)
       VALUES (?, ?, ?, 'open', 0, ?)
       ON CONFLICT (year, month) DO NOTHING`,
    )
    .bind(newId(), year, month, nowIso())
    .run();

  const row = await db
    .prepare("SELECT * FROM monthly_periods WHERE year = ? AND month = ?")
    .bind(year, month)
    .first<MonthlyPeriodRow>();

  if (!row) throw new Error(`period not found after insert: ${year}-${month}`);
  return row;
}

export async function findPeriodById(db: D1Database, id: string): Promise<MonthlyPeriodRow | null> {
  return db.prepare("SELECT * FROM monthly_periods WHERE id = ?").bind(id).first<MonthlyPeriodRow>();
}

export async function listPeriods(db: D1Database): Promise<MonthlyPeriodRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM monthly_periods ORDER BY year DESC, month DESC")
    .all<MonthlyPeriodRow>();
  return results;
}

export async function listExpenses(db: D1Database, periodId: string): Promise<MonthlyExpenseRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM monthly_expenses WHERE period_id = ? ORDER BY spent_on DESC, created_at DESC")
    .bind(periodId)
    .all<MonthlyExpenseRow>();
  return results;
}

export async function sumByPeriod(db: D1Database, periodId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM monthly_expenses WHERE period_id = ?")
    .bind(periodId)
    .first<{ total: number }>();
  return row?.total ?? 0;
}
```

- [ ] **Step 5: ルートを書く**

`apps/api/src/routes/monthly.ts`:

```ts
import { Hono } from "hono";

import { getOrCreatePeriod, listExpenses, listPeriods } from "../db/monthly.js";
import type { MonthlyExpenseRow, MonthlyPeriodRow } from "../db/rows.js";
import type { AppEnv } from "../env.js";
import { fail, ok } from "../lib/response.js";
import { formatYm, parseYm } from "../lib/ym.js";

export const monthlyRoutes = new Hono<AppEnv>();

const toPeriodJson = (row: MonthlyPeriodRow) => ({
  ym: formatYm(row.year, row.month),
  year: row.year,
  month: row.month,
  status: row.status,
  isDirty: row.is_dirty === 1,
  settledAt: row.settled_at,
});

const toExpenseJson = (row: MonthlyExpenseRow) => ({
  id: row.id,
  paidBy: row.paid_by,
  amount: row.amount,
  itemName: row.item_name,
  categoryId: row.category_id,
  spentOn: row.spent_on,
});

const invalidYm = () => fail("VALIDATION_ERROR", "年月は YYYY-MM 形式で指定してください", { ym: "YYYY-MM" });

monthlyRoutes.get("/", async (c) => {
  const rows = await listPeriods(c.env.DB);
  return c.json(ok(rows.map(toPeriodJson)));
});

monthlyRoutes.get("/:ym", async (c) => {
  const parsed = parseYm(c.req.param("ym"));
  if (!parsed) return c.json(invalidYm(), 400);

  const period = await getOrCreatePeriod(c.env.DB, parsed.year, parsed.month);
  const expenses = await listExpenses(c.env.DB, period.id);

  return c.json(ok({ period: toPeriodJson(period), expenses: expenses.map(toExpenseJson) }));
});
```

- [ ] **Step 6: ルートを登録する**

`apps/api/src/index.ts` に追加:

```ts
import { monthlyRoutes } from "./routes/monthly.js";

// ... app.route("/api/categories", categoryRoutes); の後
app.route("/api/monthly", monthlyRoutes);
```

- [ ] **Step 7: テストを実行して成功することを確認する**

Run: `npm test -w @warikan/api`
Expected: PASS（24 tests）

- [ ] **Step 8: コミット**

```bash
git add apps/api
git commit -m "feat: 月次の期間取得と暗黙作成を追加"
```

---

## Task 11: 月次の支出 CRUD と is_dirty

**Files:**
- Modify: `apps/api/src/db/monthly.ts`, `apps/api/src/routes/monthly.ts`
- Create: `apps/api/test/monthly-expense.test.ts`

**Interfaces:**
- Consumes: `getOrCreatePeriod` / `findPeriodById`（Task 10）、`categoryExists`（Task 9）、`listUsers`（Task 8）、`daysInMonth`（Task 10）
- Produces:
  - `insertExpense(db, input: ExpenseInput): Promise<MonthlyExpenseRow>`
  - `updateExpense(db, id, periodId, patch): Promise<void>`
  - `deleteExpense(db, id, periodId): Promise<void>`
  - `findExpenseById(db, id): Promise<MonthlyExpenseRow | null>`
  - `markDirtyStatement(db, periodId): D1PreparedStatement`
  - `findUserById(db, id): Promise<UserRow | null>`

- [ ] **Step 1: 失敗するテストを書く**

`apps/api/test/monthly-expense.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { authedFetch, jsonBody, jsonInit, resetDb } from "./helpers.js";

type Expense = {
  id: string;
  paidBy: string;
  amount: number;
  itemName: string;
  categoryId: number | null;
  spentOn: string;
};
type Envelope<T> = { ok: boolean; data?: T; error?: { code: string } };

async function meId(): Promise<string> {
  const body = await jsonBody<Envelope<{ userId: string }>>(await authedFetch("/api/me"));
  return body.data!.userId;
}

async function addExpense(overrides: Partial<Expense> = {}): Promise<Expense> {
  const userId = await meId();
  const res = await authedFetch(
    "/api/monthly/2026-08/expenses",
    jsonInit("POST", {
      paidBy: userId,
      amount: 1200,
      itemName: "牛乳と卵",
      categoryId: 1,
      spentOn: "2026-08-03",
      ...overrides,
    }),
  );
  const body = await jsonBody<Envelope<Expense>>(res);
  if (!body.data) throw new Error(`addExpense failed: ${res.status} ${JSON.stringify(body)}`);
  return body.data;
}

describe("POST /api/monthly/:ym/expenses", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("支出を追加できる", async () => {
    const expense = await addExpense();

    expect(expense.amount).toBe(1200);
    expect(expense.itemName).toBe("牛乳と卵");
    expect(expense.spentOn).toBe("2026-08-03");
    expect(expense.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("追加した支出が一覧に出る", async () => {
    await addExpense({ itemName: "ティッシュ" });

    const body = await jsonBody<Envelope<{ expenses: Expense[] }>>(await authedFetch("/api/monthly/2026-08"));

    expect(body.data?.expenses).toHaveLength(1);
    expect(body.data?.expenses[0]?.itemName).toBe("ティッシュ");
  });

  it("金額が負なら 400", async () => {
    const userId = await meId();
    const res = await authedFetch(
      "/api/monthly/2026-08/expenses",
      jsonInit("POST", { paidBy: userId, amount: -1, itemName: "x", categoryId: 1, spentOn: "2026-08-03" }),
    );

    expect(res.status).toBe(400);
  });

  it("金額が小数なら 400", async () => {
    const userId = await meId();
    const res = await authedFetch(
      "/api/monthly/2026-08/expenses",
      jsonInit("POST", { paidBy: userId, amount: 10.5, itemName: "x", categoryId: 1, spentOn: "2026-08-03" }),
    );

    expect(res.status).toBe(400);
  });

  it("品目名が空なら 400", async () => {
    const userId = await meId();
    const res = await authedFetch(
      "/api/monthly/2026-08/expenses",
      jsonInit("POST", { paidBy: userId, amount: 100, itemName: "  ", categoryId: 1, spentOn: "2026-08-03" }),
    );

    expect(res.status).toBe(400);
  });

  it("その月に属さない日付なら 400", async () => {
    const userId = await meId();
    const res = await authedFetch(
      "/api/monthly/2026-08/expenses",
      jsonInit("POST", { paidBy: userId, amount: 100, itemName: "x", categoryId: 1, spentOn: "2026-09-01" }),
    );

    expect(res.status).toBe(400);
  });

  it("存在しないユーザーを支払者にすると 400", async () => {
    const res = await authedFetch(
      "/api/monthly/2026-08/expenses",
      jsonInit("POST", {
        paidBy: "00000000-0000-0000-0000-000000000000",
        amount: 100,
        itemName: "x",
        categoryId: 1,
        spentOn: "2026-08-03",
      }),
    );

    expect(res.status).toBe(400);
  });

  it("存在しないカテゴリなら 400", async () => {
    const userId = await meId();
    const res = await authedFetch(
      "/api/monthly/2026-08/expenses",
      jsonInit("POST", { paidBy: userId, amount: 100, itemName: "x", categoryId: 9999, spentOn: "2026-08-03" }),
    );

    expect(res.status).toBe(400);
  });
});

describe("PATCH / DELETE /api/monthly/expenses/:id", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("支出を更新できる", async () => {
    const created = await addExpense();

    const res = await authedFetch(
      `/api/monthly/expenses/${created.id}`,
      jsonInit("PATCH", { amount: 2000, itemName: "牛乳と卵とパン" }),
    );
    const body = await jsonBody<Envelope<Expense>>(res);

    expect(res.status).toBe(200);
    expect(body.data?.amount).toBe(2000);
    expect(body.data?.itemName).toBe("牛乳と卵とパン");
  });

  it("支出を削除できる", async () => {
    const created = await addExpense();

    const res = await authedFetch(`/api/monthly/expenses/${created.id}`, { method: "DELETE" });
    expect(res.status).toBe(200);

    const body = await jsonBody<Envelope<{ expenses: Expense[] }>>(await authedFetch("/api/monthly/2026-08"));
    expect(body.data?.expenses).toEqual([]);
  });

  it("存在しない支出の更新は 404", async () => {
    const res = await authedFetch(
      "/api/monthly/expenses/00000000-0000-0000-0000-000000000000",
      jsonInit("PATCH", { amount: 1 }),
    );

    expect(res.status).toBe(404);
  });

  it("存在しない支出の削除は 404", async () => {
    const res = await authedFetch("/api/monthly/expenses/00000000-0000-0000-0000-000000000000", {
      method: "DELETE",
    });

    expect(res.status).toBe(404);
  });
});

describe("確定済み期間への変更は is_dirty を立てる", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function markSettled(): Promise<string> {
    const body = await jsonBody<Envelope<{ period: { ym: string } }>>(await authedFetch("/api/monthly/2026-08"));
    void body;
    const row = await env.DB.prepare("SELECT id FROM monthly_periods WHERE year = 2026 AND month = 8").first<{
      id: string;
    }>();
    await env.DB.prepare("UPDATE monthly_periods SET status = 'settled', is_dirty = 0 WHERE id = ?")
      .bind(row!.id)
      .run();
    return row!.id;
  }

  async function isDirty(periodId: string): Promise<number> {
    const row = await env.DB.prepare("SELECT is_dirty FROM monthly_periods WHERE id = ?")
      .bind(periodId)
      .first<{ is_dirty: number }>();
    return row!.is_dirty;
  }

  it("追加で is_dirty が 1 になる", async () => {
    await meId();
    const periodId = await markSettled();

    await addExpense();

    expect(await isDirty(periodId)).toBe(1);
  });

  it("更新で is_dirty が 1 になる", async () => {
    const created = await addExpense();
    const periodId = await markSettled();

    await authedFetch(`/api/monthly/expenses/${created.id}`, jsonInit("PATCH", { amount: 999 }));

    expect(await isDirty(periodId)).toBe(1);
  });

  it("削除で is_dirty が 1 になる", async () => {
    const created = await addExpense();
    const periodId = await markSettled();

    await authedFetch(`/api/monthly/expenses/${created.id}`, { method: "DELETE" });

    expect(await isDirty(periodId)).toBe(1);
  });

  it("open の期間では is_dirty は 0 のまま", async () => {
    await addExpense();

    const row = await env.DB.prepare("SELECT is_dirty FROM monthly_periods WHERE year = 2026 AND month = 8").first<{
      is_dirty: number;
    }>();

    expect(row?.is_dirty).toBe(0);
  });
});
```

- [ ] **Step 2: テストを実行して失敗することを確認する**

Run: `npm test -w @warikan/api`
Expected: FAIL — 支出系のエンドポイントが 404

- [ ] **Step 3: 支出のクエリを追加する**

`apps/api/src/db/monthly.ts` の末尾に追記:

```ts
export type ExpenseInput = {
  periodId: string;
  paidBy: string;
  amount: number;
  itemName: string;
  categoryId: number | null;
  spentOn: string;
};

export async function findExpenseById(db: D1Database, id: string): Promise<MonthlyExpenseRow | null> {
  return db.prepare("SELECT * FROM monthly_expenses WHERE id = ?").bind(id).first<MonthlyExpenseRow>();
}

/**
 * 確定済み（status='settled'）の期間だけ is_dirty を立てる文を返す。
 * 呼び出し側で本体の更新文と一緒に batch に渡し、原子的に実行する。
 */
export const markDirtyStatement = (db: D1Database, periodId: string) =>
  db
    .prepare("UPDATE monthly_periods SET is_dirty = 1 WHERE id = ? AND status = 'settled'")
    .bind(periodId);

export async function insertExpense(db: D1Database, input: ExpenseInput): Promise<MonthlyExpenseRow> {
  const timestamp = nowIso();
  const row: MonthlyExpenseRow = {
    id: newId(),
    period_id: input.periodId,
    paid_by: input.paidBy,
    amount: input.amount,
    item_name: input.itemName,
    category_id: input.categoryId,
    spent_on: input.spentOn,
    created_at: timestamp,
    updated_at: timestamp,
  };

  await db.batch([
    db
      .prepare(
        `INSERT INTO monthly_expenses
           (id, period_id, paid_by, amount, item_name, category_id, spent_on, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        row.id,
        row.period_id,
        row.paid_by,
        row.amount,
        row.item_name,
        row.category_id,
        row.spent_on,
        row.created_at,
        row.updated_at,
      ),
    markDirtyStatement(db, input.periodId),
  ]);

  return row;
}

export async function updateExpense(
  db: D1Database,
  id: string,
  periodId: string,
  patch: { paidBy: string; amount: number; itemName: string; categoryId: number | null; spentOn: string },
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `UPDATE monthly_expenses
            SET paid_by = ?, amount = ?, item_name = ?, category_id = ?, spent_on = ?, updated_at = ?
          WHERE id = ?`,
      )
      .bind(patch.paidBy, patch.amount, patch.itemName, patch.categoryId, patch.spentOn, nowIso(), id),
    markDirtyStatement(db, periodId),
  ]);
}

export async function deleteExpense(db: D1Database, id: string, periodId: string): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM monthly_expenses WHERE id = ?").bind(id),
    markDirtyStatement(db, periodId),
  ]);
}
```

- [ ] **Step 4: 支出のルートを追加する**

`apps/api/src/routes/monthly.ts` の import に追加:

```ts
import { z } from "zod";

import { categoryExists } from "../db/categories.js";
import {
  deleteExpense,
  findExpenseById,
  findPeriodById,
  insertExpense,
  updateExpense,
} from "../db/monthly.js";
import { findUserById } from "../db/users.js";
import { daysInMonth } from "../lib/ym.js";
```

`apps/api/src/db/users.ts` に次を追記する:

```ts
export async function findUserById(db: D1Database, id: string): Promise<UserRow | null> {
  return db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();
}
```

`apps/api/src/routes/monthly.ts` の末尾に追記:

```ts
const expenseSchema = z.object({
  paidBy: z.string().min(1),
  amount: z.number().int().min(0).max(10_000_000),
  itemName: z.string().trim().min(1).max(60),
  categoryId: z.number().int().positive().nullable().optional(),
  spentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

type ExpensePayload = z.infer<typeof expenseSchema>;

/** spentOn がその年月の実在する日付かを確認する。 */
function spentOnInPeriod(spentOn: string, year: number, month: number): boolean {
  const [y, m, d] = spentOn.split("-").map(Number);
  if (y !== year || m !== month) return false;
  return d !== undefined && d >= 1 && d <= daysInMonth(year, month);
}

/** 支払者とカテゴリの実在を確認する。問題があればエラーメッセージを返す。 */
async function validateRefs(
  db: D1Database,
  payload: ExpensePayload,
): Promise<{ message: string; fields: Record<string, string> } | null> {
  const user = await findUserById(db, payload.paidBy);
  if (!user) return { message: "支払者が見つかりません", fields: { paidBy: "存在しないユーザー" } };

  const categoryId = payload.categoryId ?? null;
  if (categoryId !== null && !(await categoryExists(db, categoryId))) {
    return { message: "カテゴリが見つかりません", fields: { categoryId: "存在しないカテゴリ" } };
  }

  return null;
}

monthlyRoutes.post("/:ym/expenses", async (c) => {
  const parsedYm = parseYm(c.req.param("ym"));
  if (!parsedYm) return c.json(invalidYm(), 400);

  const parsed = expenseSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(fail("VALIDATION_ERROR", "入力内容を確認してください"), 400);
  }

  if (!spentOnInPeriod(parsed.data.spentOn, parsedYm.year, parsedYm.month)) {
    return c.json(
      fail("VALIDATION_ERROR", "日付はその月の範囲で指定してください", { spentOn: "対象月外" }),
      400,
    );
  }

  const refError = await validateRefs(c.env.DB, parsed.data);
  if (refError) return c.json(fail("VALIDATION_ERROR", refError.message, refError.fields), 400);

  const period = await getOrCreatePeriod(c.env.DB, parsedYm.year, parsedYm.month);
  const row = await insertExpense(c.env.DB, {
    periodId: period.id,
    paidBy: parsed.data.paidBy,
    amount: parsed.data.amount,
    itemName: parsed.data.itemName,
    categoryId: parsed.data.categoryId ?? null,
    spentOn: parsed.data.spentOn,
  });

  return c.json(ok(toExpenseJson(row)), 201);
});

monthlyRoutes.patch("/expenses/:id", async (c) => {
  const existing = await findExpenseById(c.env.DB, c.req.param("id"));
  if (!existing) return c.json(fail("NOT_FOUND", "支出が見つかりません"), 404);

  const period = await findPeriodById(c.env.DB, existing.period_id);
  if (!period) return c.json(fail("NOT_FOUND", "期間が見つかりません"), 404);

  const merged = {
    paidBy: existing.paid_by,
    amount: existing.amount,
    itemName: existing.item_name,
    categoryId: existing.category_id,
    spentOn: existing.spent_on,
    ...((await c.req.json().catch(() => ({}))) as Partial<ExpensePayload>),
  };

  const parsed = expenseSchema.safeParse(merged);
  if (!parsed.success) return c.json(fail("VALIDATION_ERROR", "入力内容を確認してください"), 400);

  if (!spentOnInPeriod(parsed.data.spentOn, period.year, period.month)) {
    return c.json(
      fail("VALIDATION_ERROR", "日付はその月の範囲で指定してください", { spentOn: "対象月外" }),
      400,
    );
  }

  const refError = await validateRefs(c.env.DB, parsed.data);
  if (refError) return c.json(fail("VALIDATION_ERROR", refError.message, refError.fields), 400);

  await updateExpense(c.env.DB, existing.id, period.id, {
    paidBy: parsed.data.paidBy,
    amount: parsed.data.amount,
    itemName: parsed.data.itemName,
    categoryId: parsed.data.categoryId ?? null,
    spentOn: parsed.data.spentOn,
  });

  const updated = await findExpenseById(c.env.DB, existing.id);
  return c.json(ok(toExpenseJson(updated!)));
});

monthlyRoutes.delete("/expenses/:id", async (c) => {
  const existing = await findExpenseById(c.env.DB, c.req.param("id"));
  if (!existing) return c.json(fail("NOT_FOUND", "支出が見つかりません"), 404);

  await deleteExpense(c.env.DB, existing.id, existing.period_id);

  return c.json(ok({ id: existing.id }));
});
```

ルートの登録順に注意する。Hono は先に登録したものが優先されるため、`/:ym/expenses` より `/expenses/:id` を後に置いても、パターンが異なるので衝突しない。ただし `GET /:ym` は `expenses` という文字列にもマッチしうるので、`parseYm` が `null` を返して 400 になる。これは意図した挙動。

- [ ] **Step 5: テストを実行して成功することを確認する**

Run: `npm test -w @warikan/api`
Expected: PASS（40 tests）

- [ ] **Step 6: コミット**

```bash
git add apps/api
git commit -m "feat: 月次の支出 CRUD と is_dirty の伝播を追加"
```

---

## Task 12: 月次の集計・精算（settle）

**Files:**
- Create: `apps/api/src/services/settle.ts`
- Modify: `apps/api/src/db/monthly.ts`, `apps/api/src/routes/monthly.ts`
- Create: `apps/api/test/monthly-settle.test.ts`

**Interfaces:**
- Consumes: `calculateSettlement`（`@warikan/shared`）、`listUsers`（Task 8）、`listExpenses` / `findPeriodById`（Task 10）
- Produces:
  - `type Snapshot = { total; perPerson; byUser; byCategory; transfers; settledAt }`
  - `buildSnapshot(db, period): Promise<Snapshot>`
  - `mergeIsPaid(next: Snapshot, previous: Snapshot | null): Snapshot`
  - `saveSnapshot(db, periodId, snapshotJson: string): Promise<void>`
  - `updateSnapshotJson(db, periodId, snapshotJson: string): Promise<void>`
  - `readSnapshot(period: MonthlyPeriodRow): Snapshot | null`

- [ ] **Step 1: 失敗するテストを書く**

`apps/api/test/monthly-settle.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";

import { ALLOWED_EMAIL, PARTNER_EMAIL, authedFetch, jsonBody, jsonInit, resetDb } from "./helpers.js";

type Transfer = { fromId: string; toId: string; amount: number; isPaid: boolean };
type Snapshot = {
  total: number;
  perPerson: number;
  byUser: { userId: string; displayName: string; paid: number; share: number }[];
  byCategory: { categoryId: number | null; name: string; amount: number }[];
  transfers: Transfer[];
  settledAt: string;
};
type Envelope<T> = { ok: boolean; data?: T; error?: { code: string } };

async function userId(email: string): Promise<string> {
  const body = await jsonBody<Envelope<{ userId: string }>>(await authedFetch("/api/me", {}, email));
  return body.data!.userId;
}

async function add(paidBy: string, amount: number, categoryId: number, itemName = "x"): Promise<void> {
  const res = await authedFetch(
    "/api/monthly/2026-08/expenses",
    jsonInit("POST", { paidBy, amount, itemName, categoryId, spentOn: "2026-08-10" }),
  );
  if (res.status !== 201) throw new Error(`add failed: ${res.status} ${await res.text()}`);
}

describe("POST /api/monthly/:ym/settle", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("2人の支出を集計して1件の送金を返す", async () => {
    const me = await userId(ALLOWED_EMAIL);
    const partner = await userId(PARTNER_EMAIL);

    await add(me, 51000, 1);
    await add(partner, 33300, 2);

    const res = await authedFetch("/api/monthly/2026-08/settle", { method: "POST" });
    const body = await jsonBody<Envelope<Snapshot>>(res);

    expect(res.status).toBe(200);
    expect(body.data?.total).toBe(84300);
    expect(body.data?.perPerson).toBe(42150);
    expect(body.data?.transfers).toEqual([
      { fromId: partner, toId: me, amount: 8850, isPaid: false },
    ]);
  });

  it("byUser に各人の支払額と負担額が入る", async () => {
    const me = await userId(ALLOWED_EMAIL);
    const partner = await userId(PARTNER_EMAIL);

    await add(me, 51000, 1);
    await add(partner, 33300, 2);

    const body = await jsonBody<Envelope<Snapshot>>(
      await authedFetch("/api/monthly/2026-08/settle", { method: "POST" }),
    );
    const mine = body.data?.byUser.find((entry) => entry.userId === me);

    expect(mine?.paid).toBe(51000);
    expect(mine?.share).toBe(42150);
  });

  it("byCategory がカテゴリ別に合算され金額降順で並ぶ", async () => {
    const me = await userId(ALLOWED_EMAIL);

    await add(me, 3000, 1);
    await add(me, 5000, 2);
    await add(me, 4000, 1);

    const body = await jsonBody<Envelope<Snapshot>>(
      await authedFetch("/api/monthly/2026-08/settle", { method: "POST" }),
    );

    expect(body.data?.byCategory).toEqual([
      { categoryId: 1, name: "食費", amount: 7000 },
      { categoryId: 2, name: "日用品", amount: 5000 },
    ]);
  });

  it("確定すると status が settled になり is_dirty が下りる", async () => {
    const me = await userId(ALLOWED_EMAIL);
    await add(me, 1000, 1);

    await authedFetch("/api/monthly/2026-08/settle", { method: "POST" });

    const body = await jsonBody<Envelope<{ period: { status: string; isDirty: boolean } }>>(
      await authedFetch("/api/monthly/2026-08"),
    );

    expect(body.data?.period.status).toBe("settled");
    expect(body.data?.period.isDirty).toBe(false);
  });

  it("確定後に支出を足すと is_dirty が立つ", async () => {
    const me = await userId(ALLOWED_EMAIL);
    await add(me, 1000, 1);
    await authedFetch("/api/monthly/2026-08/settle", { method: "POST" });

    await add(me, 500, 1);

    const body = await jsonBody<Envelope<{ period: { isDirty: boolean } }>>(
      await authedFetch("/api/monthly/2026-08"),
    );

    expect(body.data?.period.isDirty).toBe(true);
  });

  it("支出が無い月を確定しても落ちない", async () => {
    await userId(ALLOWED_EMAIL);

    const res = await authedFetch("/api/monthly/2026-08/settle", { method: "POST" });
    const body = await jsonBody<Envelope<Snapshot>>(res);

    expect(res.status).toBe(200);
    expect(body.data?.total).toBe(0);
    expect(body.data?.transfers).toEqual([]);
  });
});

describe("GET /api/monthly/:ym/result", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("未確定の月は 404", async () => {
    await userId(ALLOWED_EMAIL);
    const res = await authedFetch("/api/monthly/2026-08/result");

    expect(res.status).toBe(404);
  });

  it("確定済みならスナップショットと isDirty を返す", async () => {
    const me = await userId(ALLOWED_EMAIL);
    await add(me, 1000, 1);
    await authedFetch("/api/monthly/2026-08/settle", { method: "POST" });

    const body = await jsonBody<Envelope<{ snapshot: Snapshot; isDirty: boolean }>>(
      await authedFetch("/api/monthly/2026-08/result"),
    );

    expect(body.data?.snapshot.total).toBe(1000);
    expect(body.data?.isDirty).toBe(false);
  });
});

describe("PATCH /api/monthly/:ym/result/transfers/:index", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function settleTwoPeople(): Promise<{ me: string; partner: string }> {
    const me = await userId(ALLOWED_EMAIL);
    const partner = await userId(PARTNER_EMAIL);
    await add(me, 10000, 1);
    await add(partner, 0, 1);
    await authedFetch("/api/monthly/2026-08/settle", { method: "POST" });
    return { me, partner };
  }

  it("支払い済みに切り替えられる", async () => {
    await settleTwoPeople();

    const res = await authedFetch(
      "/api/monthly/2026-08/result/transfers/0",
      jsonInit("PATCH", { isPaid: true }),
    );
    const body = await jsonBody<Envelope<Snapshot>>(res);

    expect(res.status).toBe(200);
    expect(body.data?.transfers[0]?.isPaid).toBe(true);
  });

  it("範囲外の index は 404", async () => {
    await settleTwoPeople();

    const res = await authedFetch(
      "/api/monthly/2026-08/result/transfers/9",
      jsonInit("PATCH", { isPaid: true }),
    );

    expect(res.status).toBe(404);
  });

  it("再計算で金額が変わらなければ isPaid を引き継ぐ", async () => {
    await settleTwoPeople();
    await authedFetch("/api/monthly/2026-08/result/transfers/0", jsonInit("PATCH", { isPaid: true }));

    const body = await jsonBody<Envelope<Snapshot>>(
      await authedFetch("/api/monthly/2026-08/settle", { method: "POST" }),
    );

    expect(body.data?.transfers[0]?.isPaid).toBe(true);
  });

  it("再計算で金額が変われば isPaid を false に戻す", async () => {
    const { me } = await settleTwoPeople();
    await authedFetch("/api/monthly/2026-08/result/transfers/0", jsonInit("PATCH", { isPaid: true }));

    await add(me, 2000, 1);

    const body = await jsonBody<Envelope<Snapshot>>(
      await authedFetch("/api/monthly/2026-08/settle", { method: "POST" }),
    );

    expect(body.data?.transfers[0]?.amount).toBe(6000);
    expect(body.data?.transfers[0]?.isPaid).toBe(false);
  });
});
```

- [ ] **Step 2: テストを実行して失敗することを確認する**

Run: `npm test -w @warikan/api`
Expected: FAIL — settle / result 系が 404

- [ ] **Step 3: スナップショット生成サービスを書く**

`apps/api/src/services/settle.ts`:

```ts
import { calculateSettlement, compareStr } from "@warikan/shared";
import type { Participant } from "@warikan/shared";

import { listActiveCategories } from "../db/categories.js";
import { listExpenses } from "../db/monthly.js";
import type { MonthlyPeriodRow } from "../db/rows.js";
import { listUsers } from "../db/users.js";
import { nowIso } from "../lib/ids.js";

export type SnapshotTransfer = {
  fromId: string;
  toId: string;
  amount: number;
  isPaid: boolean;
};

export type Snapshot = {
  total: number;
  perPerson: number;
  byUser: { userId: string; displayName: string; paid: number; share: number }[];
  byCategory: { categoryId: number | null; name: string; amount: number }[];
  transfers: SnapshotTransfer[];
  settledAt: string;
};

const UNCATEGORIZED = "未分類";

export async function buildSnapshot(db: D1Database, period: MonthlyPeriodRow): Promise<Snapshot> {
  const [users, expenses, categories] = await Promise.all([
    listUsers(db),
    listExpenses(db, period.id),
    listActiveCategories(db),
  ]);

  const paidByUser = new Map<string, number>(users.map((user) => [user.id, 0]));
  for (const expense of expenses) {
    paidByUser.set(expense.paid_by, (paidByUser.get(expense.paid_by) ?? 0) + expense.amount);
  }

  const participants: Participant[] = users.map((user) => ({
    id: user.id,
    name: user.display_name,
    paid: paidByUser.get(user.id) ?? 0,
  }));

  const settlement = calculateSettlement(participants);
  const shareById = new Map(settlement.shares.map((share) => [share.id, share.share]));

  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  const amountByCategory = new Map<number | null, number>();
  for (const expense of expenses) {
    const key = expense.category_id;
    amountByCategory.set(key, (amountByCategory.get(key) ?? 0) + expense.amount);
  }

  const byCategory = [...amountByCategory.entries()]
    .map(([categoryId, amount]) => ({
      categoryId,
      name: categoryId === null ? UNCATEGORIZED : (categoryNames.get(categoryId) ?? UNCATEGORIZED),
      amount,
    }))
    .sort((a, b) => b.amount - a.amount || compareStr(a.name, b.name));

  return {
    total: settlement.total,
    perPerson: settlement.perPerson,
    byUser: users.map((user) => ({
      userId: user.id,
      displayName: user.display_name,
      paid: paidByUser.get(user.id) ?? 0,
      share: shareById.get(user.id) ?? 0,
    })),
    byCategory,
    transfers: settlement.transfers.map((transfer) => ({ ...transfer, isPaid: false })),
    settledAt: nowIso(),
  };
}

/**
 * 再計算後の送金に、旧スナップショットの isPaid を引き継ぐ。
 * fromId / toId / amount がすべて一致するものだけ引き継ぐ。
 * 「すでに渡した」という事実は金額とセットでしか意味を持たないため、
 * 1円でも変わっていれば未払いに戻す。
 */
export function mergeIsPaid(next: Snapshot, previous: Snapshot | null): Snapshot {
  if (!previous) return next;

  const paidKeys = new Set(
    previous.transfers
      .filter((transfer) => transfer.isPaid)
      .map((transfer) => `${transfer.fromId}|${transfer.toId}|${transfer.amount}`),
  );

  return {
    ...next,
    transfers: next.transfers.map((transfer) => ({
      ...transfer,
      isPaid: paidKeys.has(`${transfer.fromId}|${transfer.toId}|${transfer.amount}`),
    })),
  };
}

export function readSnapshot(period: MonthlyPeriodRow): Snapshot | null {
  if (!period.snapshot_json) return null;
  return JSON.parse(period.snapshot_json) as Snapshot;
}
```

- [ ] **Step 4: スナップショット保存のクエリを追加する**

`apps/api/src/db/monthly.ts` の末尾に追記:

```ts
export async function saveSnapshot(db: D1Database, periodId: string, snapshotJson: string): Promise<void> {
  await db
    .prepare(
      `UPDATE monthly_periods
          SET snapshot_json = ?, status = 'settled', is_dirty = 0, settled_at = ?
        WHERE id = ?`,
    )
    .bind(snapshotJson, nowIso(), periodId)
    .run();
}

/** 支払い済みフラグの更新。status と is_dirty には触れない。 */
export async function updateSnapshotJson(
  db: D1Database,
  periodId: string,
  snapshotJson: string,
): Promise<void> {
  await db
    .prepare("UPDATE monthly_periods SET snapshot_json = ? WHERE id = ?")
    .bind(snapshotJson, periodId)
    .run();
}
```

- [ ] **Step 5: settle / result のルートを追加する**

`apps/api/src/routes/monthly.ts` の import に追加:

```ts
import { saveSnapshot, updateSnapshotJson } from "../db/monthly.js";
import { buildSnapshot, mergeIsPaid, readSnapshot } from "../services/settle.js";
```

末尾に追記:

```ts
const isPaidSchema = z.object({ isPaid: z.boolean() });

monthlyRoutes.post("/:ym/settle", async (c) => {
  const parsedYm = parseYm(c.req.param("ym"));
  if (!parsedYm) return c.json(invalidYm(), 400);

  const period = await getOrCreatePeriod(c.env.DB, parsedYm.year, parsedYm.month);
  const previous = readSnapshot(period);
  const snapshot = mergeIsPaid(await buildSnapshot(c.env.DB, period), previous);

  await saveSnapshot(c.env.DB, period.id, JSON.stringify(snapshot));

  return c.json(ok(snapshot));
});

monthlyRoutes.get("/:ym/result", async (c) => {
  const parsedYm = parseYm(c.req.param("ym"));
  if (!parsedYm) return c.json(invalidYm(), 400);

  const period = await getOrCreatePeriod(c.env.DB, parsedYm.year, parsedYm.month);
  const snapshot = readSnapshot(period);
  if (!snapshot) return c.json(fail("NOT_FOUND", "まだ計算されていません"), 404);

  return c.json(ok({ snapshot, isDirty: period.is_dirty === 1 }));
});

monthlyRoutes.patch("/:ym/result/transfers/:index", async (c) => {
  const parsedYm = parseYm(c.req.param("ym"));
  if (!parsedYm) return c.json(invalidYm(), 400);

  const parsed = isPaidSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(fail("VALIDATION_ERROR", "isPaid は真偽値で指定してください"), 400);

  const period = await getOrCreatePeriod(c.env.DB, parsedYm.year, parsedYm.month);
  const snapshot = readSnapshot(period);
  if (!snapshot) return c.json(fail("NOT_FOUND", "まだ計算されていません"), 404);

  const index = Number(c.req.param("index"));
  if (!Number.isInteger(index) || index < 0 || index >= snapshot.transfers.length) {
    return c.json(fail("NOT_FOUND", "該当する送金がありません"), 404);
  }

  const updated = {
    ...snapshot,
    transfers: snapshot.transfers.map((transfer, position) =>
      position === index ? { ...transfer, isPaid: parsed.data.isPaid } : transfer,
    ),
  };

  await updateSnapshotJson(c.env.DB, period.id, JSON.stringify(updated));

  return c.json(ok(updated));
});
```

`/:ym/result` と `/:ym/settle` は `/:ym` より後に登録しても、Hono はパスセグメント数で区別するため衝突しない。

- [ ] **Step 6: テストを実行して成功することを確認する**

Run: `npm test -w @warikan/api`
Expected: PASS（55 tests）

`byCategory` の順序テストが落ちる場合、同額のときの tie-break（名前のコードユニット昇順）が実装と一致しているか確認する。「食費」と「日用品」はどちらも 5000 円なので、`compareStr` の結果で順序が決まる。

- [ ] **Step 7: コミット**

```bash
git add apps/api
git commit -m "feat: 月次の集計・精算とスナップショット保存を追加"
```

---

## Task 13: 単発割り勘（events）API

**Files:**
- Create: `apps/api/src/db/events.ts`, `apps/api/src/routes/events.ts`
- Create: `apps/api/test/events.test.ts`
- Modify: `apps/api/src/index.ts`

**Interfaces:**
- Consumes: `calculateSettlement`（`@warikan/shared`）、`newId` / `nowIso`（Task 7）
- Produces:
  - `createEvent(db, input): Promise<string>` — 作成した event の id
  - `findEventDetail(db, id): Promise<EventDetail | null>`
  - `listEventSummaries(db): Promise<EventRow[]>`
  - `deleteEvent(db, id): Promise<void>`
  - `setSettlementPaid(db, settlementId, isPaid): Promise<void>`
  - `eventRoutes: Hono<AppEnv>`

- [ ] **Step 1: 失敗するテストを書く**

`apps/api/test/events.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";

import { anonFetch, authedFetch, jsonBody, jsonInit, resetDb } from "./helpers.js";

type Member = { id: string; name: string; paid: number };
type Settlement = { id: string; fromMemberId: string; toMemberId: string; amount: number; isPaid: boolean };
type EventDetail = {
  id: string;
  title: string;
  mode: string;
  total: number;
  perPerson: number;
  members: Member[];
  items: { id: string; name: string; amount: number; paidByMemberId: string }[];
  settlements: Settlement[];
};
type Envelope<T> = { ok: boolean; data?: T; error?: { code: string } };

const simplePayload = {
  title: "飲み会 8/5",
  mode: "simple",
  members: [
    { name: "田中", paid: 10000 },
    { name: "佐藤", paid: 2000 },
    { name: "鈴木", paid: 0 },
  ],
  items: [],
};

const itemsPayload = {
  title: "旅行",
  mode: "items",
  members: [{ name: "田中", paid: 0 }, { name: "佐藤", paid: 0 }],
  items: [
    { name: "宿代", amount: 20000, paidByIndex: 0 },
    { name: "ガソリン", amount: 6000, paidByIndex: 1 },
    { name: "food", amount: 4000, paidByIndex: 0 },
  ],
};

async function createEvent(payload: unknown): Promise<EventDetail> {
  const res = await authedFetch("/api/events", jsonInit("POST", payload));
  const body = await jsonBody<Envelope<EventDetail>>(res);
  if (!body.data) throw new Error(`create failed: ${res.status} ${JSON.stringify(body)}`);
  return body.data;
}

describe("POST /api/events", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("シンプルモードで精算まで計算して保存する", async () => {
    const event = await createEvent(simplePayload);

    expect(event.total).toBe(12000);
    expect(event.perPerson).toBe(4000);
    expect(event.members).toHaveLength(3);
    expect(event.settlements).toHaveLength(2);

    const tanaka = event.members.find((member) => member.name === "田中")!;
    const received = event.settlements
      .filter((settlement) => settlement.toMemberId === tanaka.id)
      .reduce((sum, settlement) => sum + settlement.amount, 0);
    expect(received).toBe(6000);
  });

  it("品目モードで支払者ごとに合算される", async () => {
    const event = await createEvent(itemsPayload);

    expect(event.total).toBe(30000);
    expect(event.perPerson).toBe(15000);

    const tanaka = event.members.find((member) => member.name === "田中")!;
    const sato = event.members.find((member) => member.name === "佐藤")!;
    expect(tanaka.paid).toBe(24000);
    expect(sato.paid).toBe(6000);

    expect(event.settlements).toEqual([
      expect.objectContaining({ fromMemberId: sato.id, toMemberId: tanaka.id, amount: 9000 }),
    ]);
  });

  it("同名のメンバーが2人いても別々に集計される", async () => {
    const event = await createEvent({
      title: "同名テスト",
      mode: "simple",
      members: [
        { name: "田中", paid: 6000 },
        { name: "田中", paid: 0 },
      ],
      items: [],
    });

    expect(event.members).toHaveLength(2);
    expect(event.members[0]?.paid).toBe(6000);
    expect(event.members[1]?.paid).toBe(0);
    expect(event.settlements).toEqual([
      expect.objectContaining({ amount: 3000 }),
    ]);
  });

  it("タイトルが空なら日付から自動生成する", async () => {
    const event = await createEvent({ ...simplePayload, title: "" });

    expect(event.title).toMatch(/^割り勘 \d{2}\/\d{2}$/);
  });

  it("メンバーが1人未満なら 400", async () => {
    const res = await authedFetch("/api/events", jsonInit("POST", { ...simplePayload, members: [] }));

    expect(res.status).toBe(400);
  });

  it("メンバーが21人以上なら 400", async () => {
    const members = Array.from({ length: 21 }, (_, index) => ({ name: `M${index}`, paid: 0 }));
    const res = await authedFetch("/api/events", jsonInit("POST", { ...simplePayload, members }));

    expect(res.status).toBe(400);
  });

  it("品目の paidByIndex が範囲外なら 400", async () => {
    const res = await authedFetch(
      "/api/events",
      jsonInit("POST", { ...itemsPayload, items: [{ name: "x", amount: 100, paidByIndex: 5 }] }),
    );

    expect(res.status).toBe(400);
  });

  it("モードが不正なら 400", async () => {
    const res = await authedFetch("/api/events", jsonInit("POST", { ...simplePayload, mode: "unknown" }));

    expect(res.status).toBe(400);
  });

  it("認証なしでは 403", async () => {
    const res = await anonFetch("/api/events", jsonInit("POST", simplePayload));

    expect(res.status).toBe(403);
  });
});

describe("GET /api/events", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("新しい順で一覧を返す", async () => {
    await createEvent({ ...simplePayload, title: "古い" });
    await createEvent({ ...simplePayload, title: "新しい" });

    const body = await jsonBody<Envelope<{ id: string; title: string }[]>>(await authedFetch("/api/events"));

    expect(body.data?.[0]?.title).toBe("新しい");
    expect(body.data).toHaveLength(2);
  });

  it("6件以上でも切り捨てない", async () => {
    for (let index = 0; index < 7; index += 1) {
      await createEvent({ ...simplePayload, title: `会 ${index}` });
    }

    const body = await jsonBody<Envelope<unknown[]>>(await authedFetch("/api/events"));

    expect(body.data).toHaveLength(7);
  });
});

describe("GET / DELETE /api/events/:id", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("詳細を取得できる", async () => {
    const created = await createEvent(simplePayload);

    const body = await jsonBody<Envelope<EventDetail>>(await authedFetch(`/api/events/${created.id}`));

    expect(body.data?.title).toBe("飲み会 8/5");
    expect(body.data?.members).toHaveLength(3);
  });

  it("存在しない id は 404", async () => {
    const res = await authedFetch("/api/events/00000000-0000-0000-0000-000000000000");

    expect(res.status).toBe(404);
  });

  it("削除すると一覧から消え、関連行も消える", async () => {
    const created = await createEvent(simplePayload);

    const res = await authedFetch(`/api/events/${created.id}`, { method: "DELETE" });
    expect(res.status).toBe(200);

    const detail = await authedFetch(`/api/events/${created.id}`);
    expect(detail.status).toBe(404);

    const { env } = await import("cloudflare:workers");
    const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM event_members WHERE event_id = ?")
      .bind(created.id)
      .first<{ count: number }>();
    expect(row?.count).toBe(0);
  });
});

describe("PATCH /api/events/:id/settlements/:settlementId", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("支払い済みに切り替えられる", async () => {
    const created = await createEvent(simplePayload);
    const target = created.settlements[0]!;

    const res = await authedFetch(
      `/api/events/${created.id}/settlements/${target.id}`,
      jsonInit("PATCH", { isPaid: true }),
    );
    const body = await jsonBody<Envelope<EventDetail>>(res);

    expect(res.status).toBe(200);
    expect(body.data?.settlements.find((s) => s.id === target.id)?.isPaid).toBe(true);
  });

  it("別イベントの settlement id を渡すと 404", async () => {
    const first = await createEvent(simplePayload);
    const second = await createEvent(simplePayload);

    const res = await authedFetch(
      `/api/events/${first.id}/settlements/${second.settlements[0]!.id}`,
      jsonInit("PATCH", { isPaid: true }),
    );

    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: テストを実行して失敗することを確認する**

Run: `npm test -w @warikan/api`
Expected: FAIL — `/api/events` が 404

- [ ] **Step 3: events のクエリを書く**

`apps/api/src/db/events.ts`:

```ts
import { newId, nowIso } from "../lib/ids.js";
import type {
  EventItemRow,
  EventMemberRow,
  EventRow,
  EventSettlementRow,
} from "./rows.js";

export type EventDetail = {
  event: EventRow;
  members: EventMemberRow[];
  items: EventItemRow[];
  settlements: EventSettlementRow[];
};

export type CreateEventInput = {
  title: string;
  mode: string;
  total: number;
  perPerson: number;
  members: { id: string; name: string; paid: number }[];
  items: { name: string; amount: number; paidByMemberId: string }[];
  settlements: { fromMemberId: string; toMemberId: string; amount: number }[];
};

export async function createEvent(db: D1Database, input: CreateEventInput): Promise<string> {
  const eventId = newId();
  const createdAt = nowIso();

  const statements = [
    db
      .prepare(
        "INSERT INTO events (id, title, mode, total, per_person, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(eventId, input.title, input.mode, input.total, input.perPerson, createdAt),
    ...input.members.map((member, position) =>
      db
        .prepare("INSERT INTO event_members (id, event_id, name, paid, position) VALUES (?, ?, ?, ?, ?)")
        .bind(member.id, eventId, member.name, member.paid, position),
    ),
    ...input.items.map((item, position) =>
      db
        .prepare(
          "INSERT INTO event_items (id, event_id, name, amount, paid_by_member_id, position) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(newId(), eventId, item.name, item.amount, item.paidByMemberId, position),
    ),
    ...input.settlements.map((settlement, position) =>
      db
        .prepare(
          `INSERT INTO event_settlements
             (id, event_id, from_member_id, to_member_id, amount, is_paid, position)
           VALUES (?, ?, ?, ?, ?, 0, ?)`,
        )
        .bind(newId(), eventId, settlement.fromMemberId, settlement.toMemberId, settlement.amount, position),
    ),
  ];

  await db.batch(statements);

  return eventId;
}

export async function findEventDetail(db: D1Database, id: string): Promise<EventDetail | null> {
  const event = await db.prepare("SELECT * FROM events WHERE id = ?").bind(id).first<EventRow>();
  if (!event) return null;

  const [members, items, settlements] = await Promise.all([
    db.prepare("SELECT * FROM event_members WHERE event_id = ? ORDER BY position").bind(id).all<EventMemberRow>(),
    db.prepare("SELECT * FROM event_items WHERE event_id = ? ORDER BY position").bind(id).all<EventItemRow>(),
    db
      .prepare("SELECT * FROM event_settlements WHERE event_id = ? ORDER BY position")
      .bind(id)
      .all<EventSettlementRow>(),
  ]);

  return {
    event,
    members: members.results,
    items: items.results,
    settlements: settlements.results,
  };
}

export async function listEventSummaries(db: D1Database): Promise<EventRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM events ORDER BY created_at DESC, id DESC")
    .all<EventRow>();
  return results;
}

export async function deleteEvent(db: D1Database, id: string): Promise<void> {
  // D1 は既定で外部キーを強制しないため、子テーブルも明示的に消す
  await db.batch([
    db.prepare("DELETE FROM event_settlements WHERE event_id = ?").bind(id),
    db.prepare("DELETE FROM event_items WHERE event_id = ?").bind(id),
    db.prepare("DELETE FROM event_members WHERE event_id = ?").bind(id),
    db.prepare("DELETE FROM events WHERE id = ?").bind(id),
  ]);
}

export async function findSettlement(
  db: D1Database,
  eventId: string,
  settlementId: string,
): Promise<EventSettlementRow | null> {
  return db
    .prepare("SELECT * FROM event_settlements WHERE id = ? AND event_id = ?")
    .bind(settlementId, eventId)
    .first<EventSettlementRow>();
}

export async function setSettlementPaid(db: D1Database, id: string, isPaid: boolean): Promise<void> {
  await db
    .prepare("UPDATE event_settlements SET is_paid = ? WHERE id = ?")
    .bind(isPaid ? 1 : 0, id)
    .run();
}
```

- [ ] **Step 4: events のルートを書く**

`apps/api/src/routes/events.ts`:

```ts
import { calculateSettlement } from "@warikan/shared";
import type { Participant } from "@warikan/shared";
import { Hono } from "hono";
import { z } from "zod";

import {
  createEvent,
  deleteEvent,
  findEventDetail,
  findSettlement,
  listEventSummaries,
  setSettlementPaid,
} from "../db/events.js";
import type { EventDetail } from "../db/events.js";
import type { AppEnv } from "../env.js";
import { newId } from "../lib/ids.js";
import { fail, ok } from "../lib/response.js";

const payloadSchema = z.object({
  title: z.string().trim().max(60),
  mode: z.enum(["simple", "items"]),
  members: z
    .array(z.object({ name: z.string().trim().min(1).max(30), paid: z.number().int().min(0).max(10_000_000) }))
    .min(1)
    .max(20),
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(60),
        amount: z.number().int().min(0).max(10_000_000),
        paidByIndex: z.number().int().min(0),
      }),
    )
    .max(200)
    .default([]),
});

export const eventRoutes = new Hono<AppEnv>();

const defaultTitle = (): string => {
  const today = new Date();
  const month = String(today.getUTCMonth() + 1).padStart(2, "0");
  const day = String(today.getUTCDate()).padStart(2, "0");
  return `割り勘 ${month}/${day}`;
};

const toDetailJson = (detail: EventDetail) => ({
  id: detail.event.id,
  title: detail.event.title,
  mode: detail.event.mode,
  total: detail.event.total,
  perPerson: detail.event.per_person,
  createdAt: detail.event.created_at,
  members: detail.members.map((member) => ({ id: member.id, name: member.name, paid: member.paid })),
  items: detail.items.map((item) => ({
    id: item.id,
    name: item.name,
    amount: item.amount,
    paidByMemberId: item.paid_by_member_id,
  })),
  settlements: detail.settlements.map((settlement) => ({
    id: settlement.id,
    fromMemberId: settlement.from_member_id,
    toMemberId: settlement.to_member_id,
    amount: settlement.amount,
    isPaid: settlement.is_paid === 1,
  })),
});

eventRoutes.get("/", async (c) => {
  const rows = await listEventSummaries(c.env.DB);

  return c.json(
    ok(
      rows.map((row) => ({
        id: row.id,
        title: row.title,
        mode: row.mode,
        total: row.total,
        perPerson: row.per_person,
        createdAt: row.created_at,
      })),
    ),
  );
});

eventRoutes.post("/", async (c) => {
  const parsed = payloadSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(fail("VALIDATION_ERROR", "入力内容を確認してください"), 400);

  const { title, mode, items } = parsed.data;

  // メンバーに id を振る。名前ではなく id で識別するので同名でも破綻しない。
  const members = parsed.data.members.map((member) => ({ ...member, id: newId() }));

  for (const item of items) {
    if (item.paidByIndex >= members.length) {
      return c.json(
        fail("VALIDATION_ERROR", "品目の支払者が不正です", { items: "paidByIndex が範囲外" }),
        400,
      );
    }
  }

  // 品目モードでは、品目の金額を支払者ごとに合算して paid とする
  const paidByMemberId = new Map(members.map((member) => [member.id, member.paid]));
  if (mode === "items") {
    for (const member of members) paidByMemberId.set(member.id, 0);
    for (const item of items) {
      const memberId = members[item.paidByIndex]!.id;
      paidByMemberId.set(memberId, (paidByMemberId.get(memberId) ?? 0) + item.amount);
    }
  }

  const participants: Participant[] = members.map((member) => ({
    id: member.id,
    name: member.name,
    paid: paidByMemberId.get(member.id) ?? 0,
  }));

  const settlement = calculateSettlement(participants);

  const eventId = await createEvent(c.env.DB, {
    title: title.length > 0 ? title : defaultTitle(),
    mode,
    total: settlement.total,
    perPerson: settlement.perPerson,
    members: members.map((member) => ({
      id: member.id,
      name: member.name,
      paid: paidByMemberId.get(member.id) ?? 0,
    })),
    items: items.map((item) => ({
      name: item.name,
      amount: item.amount,
      paidByMemberId: members[item.paidByIndex]!.id,
    })),
    settlements: settlement.transfers.map((transfer) => ({
      fromMemberId: transfer.fromId,
      toMemberId: transfer.toId,
      amount: transfer.amount,
    })),
  });

  const detail = await findEventDetail(c.env.DB, eventId);
  return c.json(ok(toDetailJson(detail!)), 201);
});

eventRoutes.get("/:id", async (c) => {
  const detail = await findEventDetail(c.env.DB, c.req.param("id"));
  if (!detail) return c.json(fail("NOT_FOUND", "見つかりません"), 404);

  return c.json(ok(toDetailJson(detail)));
});

eventRoutes.delete("/:id", async (c) => {
  const detail = await findEventDetail(c.env.DB, c.req.param("id"));
  if (!detail) return c.json(fail("NOT_FOUND", "見つかりません"), 404);

  await deleteEvent(c.env.DB, detail.event.id);

  return c.json(ok({ id: detail.event.id }));
});

eventRoutes.patch("/:id/settlements/:settlementId", async (c) => {
  const parsed = z
    .object({ isPaid: z.boolean() })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(fail("VALIDATION_ERROR", "isPaid は真偽値で指定してください"), 400);

  const eventId = c.req.param("id");
  const target = await findSettlement(c.env.DB, eventId, c.req.param("settlementId"));
  if (!target) return c.json(fail("NOT_FOUND", "該当する送金がありません"), 404);

  await setSettlementPaid(c.env.DB, target.id, parsed.data.isPaid);

  const detail = await findEventDetail(c.env.DB, eventId);
  return c.json(ok(toDetailJson(detail!)));
});
```

- [ ] **Step 5: ルートを登録する**

`apps/api/src/index.ts` に追加:

```ts
import { eventRoutes } from "./routes/events.js";

// ... app.route("/api/monthly", monthlyRoutes); の後
app.route("/api/events", eventRoutes);
```

- [ ] **Step 6: テストを実行して成功することを確認する**

Run: `npm test -w @warikan/api`
Expected: PASS（73 tests）

「6件以上でも切り捨てない」テストが落ちる場合、`created_at` が ISO 文字列の同一秒に並んで順序が不定になっている可能性がある。`listEventSummaries` の `ORDER BY created_at DESC, id DESC` で決まるが、件数だけを見るテストなので順序は影響しない。件数が7でなければクエリを見直すこと。

- [ ] **Step 7: 型チェックとカバレッジを確認する**

```bash
npm run typecheck -w @warikan/api
npm test -w @warikan/api -- --coverage
```

Expected: 型エラーなし。`src/` のカバレッジが 80% 以上

- [ ] **Step 8: コミット**

```bash
git add apps/api
git commit -m "feat: 単発割り勘の events API を追加"
```

---

## Task 14: 仕上げ

**Files:**
- Create: `apps/api/.dev.vars.example`
- Modify: `CLAUDE.md`, `README.md`（無ければ作成）

**Interfaces:**
- Consumes: これまでの全タスク
- Produces: なし

- [ ] **Step 1: 全テストを通す**

Run: `npm test`
Expected: shared 31 + api 73 = 104 tests すべて PASS

- [ ] **Step 2: ローカル開発用の環境変数サンプルを作る**

`apps/api/.dev.vars.example`:

```
# ローカル開発用。このファイルをコピーして .dev.vars を作る（.dev.vars は gitignore 済み）
# DEV_BYPASS_EMAIL を設定すると Cloudflare Access の JWT 検証を飛ばす。
# ただし ACCESS_ALLOWED_EMAILS に含まれないメールは変わらず 403 になる。
DEV_BYPASS_EMAIL="me@example.com"
ACCESS_ALLOWED_EMAILS="me@example.com,partner@example.com"
ACCESS_TEAM_DOMAIN="example.cloudflareaccess.com"
ACCESS_AUD="local-dev"
```

- [ ] **Step 3: ローカルで Worker を起動して動作を確認する**

```bash
cp apps/api/.dev.vars.example apps/api/.dev.vars
npm run migrate:local -w @warikan/api
npm run dev -w @warikan/api
```

別のターミナルで:

```bash
curl -s http://localhost:8787/api/health
curl -s http://localhost:8787/api/me
curl -s http://localhost:8787/api/categories
```

Expected: 順に `{"ok":true,"data":{"status":"ok"}}`、自分のユーザー情報、カテゴリ7件

確認できたら Ctrl+C で停止する。

- [ ] **Step 4: README を書く**

`README.md`（既存が無ければ新規作成）:

```markdown
# 割り勘 (warikan)

夫婦2人で使う割り勘アプリ。Cloudflare Workers + D1 で動く。

## 構成

| ディレクトリ | 内容 |
|---|---|
| `packages/shared` | 精算ロジック（純関数）と共通の型 |
| `apps/api` | Hono の API（Cloudflare Workers） |
| `legacy` | 移行前の Flask 実装。パリティ確認用 |
| `docs/superpowers/specs` | 設計書 |
| `docs/superpowers/plans` | 実装計画 |

## セットアップ

    npm install
    cp apps/api/.dev.vars.example apps/api/.dev.vars
    npm run migrate:local -w @warikan/api

## 開発

    npm run dev -w @warikan/api    # http://localhost:8787
    npm test                        # 全テスト
    npm run typecheck               # 型チェック

## 割り勘のモード

| モード | 内容 |
|---|---|
| シンプル | 参加者ごとに立て替えた金額を直接入力する |
| 品目別 | 品目・金額・支払者を記録し、支払者ごとに合算する |
| 月次 | 支払いの都度記録し、月末に集計して精算する（登録済みの2人専用） |

いずれも均等割りで、送金回数が最小になるように精算する。
```

- [ ] **Step 5: CLAUDE.md を現状に合わせる**

`CLAUDE.md` の「アーキテクチャ」節を、Flask の説明から現構成の説明に差し替える。`legacy/` の説明は残す。「アプリの起動方法」を `npm run dev -w @warikan/api` に更新する。

- [ ] **Step 6: コミット**

```bash
git add -A
git commit -m "docs: README と CLAUDE.md を現構成に合わせて更新"
```

---

## Self-Review メモ

このプランを設計書と突き合わせた結果、次を確認した。

| 設計書の項目 | 対応タスク |
|---|---|
| §3.1 モノレポ構成 | Task 2, 7 |
| §3.2 Access の JWT 検証 | Task 8 |
| §3.3 環境変数・シークレット | Task 7, 14 |
| §4 D1 スキーマ | Task 7 |
| §4.1 現行からの改善4点 | Task 4（整数演算）、Task 13（メンバー ID 識別、上限撤廃）。Cookie 依存の解消は Plan 2 |
| §4.2 is_dirty | Task 11, 12 |
| §4.3 カテゴリ初期データ | Task 7 |
| §4.4 batch による原子性 | Task 11, 13 |
| §4.5 ユーザー自動作成 | Task 8 |
| §5 精算ロジック | Task 3, 4 |
| §5.3 テストする性質 | Task 5, 6 |
| §6.1〜6.3 API | Task 9〜13 |
| §6.4 バリデーション規則 | Task 11, 13 |
| §7 画面設計 | Plan 2 の範囲 |
| §8 テスト戦略（ユニット・統合） | Task 5, 7 以降。E2E は Plan 3 |
| §9 Playwright MCP とサブエージェント | Task 1 |
| §10 Phase 0〜2 | 本プラン全体 |

**Plan 2 以降に持ち越す項目**

- React フロントエンド一式（設計書 §7）
- Worker の `assets` 設定と SPA フォールバック
- Cloudflare Access のダッシュボード設定、secret の投入、本番デプロイ（設計書 §11 の前提のとおり利用者本人の作業を含む）
- Playwright E2E 3本
- `legacy/` の削除

**このプランで意図的に採用した判断**

- `GET /api/health` だけ認証を通さない。疎通確認専用でデータを返さないため
- `DEV_BYPASS_EMAIL` は JWT 検証のみを飛ばし、許可リストの検査は常に効かせる。開発用の穴が本番の許可条件を緩めないようにするため
- `event_settlements` などの子テーブルは `deleteEvent` で明示的に削除する。D1 は既定で外部キー制約を強制しないため、`ON DELETE CASCADE` に依存しない
- 統合テストの `exports.default.fetch` が使えない環境では `SELF.fetch` に読み替える手順を Task 7 Step 11 に明記した
