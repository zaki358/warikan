# 割り勘アプリ Plan 3（E2E・本番デプロイ・移行完了）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**作成日:** 2026-08-09
**対応する設計書:** [2026-08-05-warikan-cloudflare-design.md](../specs/2026-08-05-warikan-cloudflare-design.md) の Phase 5〜7（§8 テスト戦略、§10 実装フェーズ、§11 前提）
**前提:** Plan 2（[2026-08-07-warikan-phase2-react-frontend.md](./2026-08-07-warikan-phase2-react-frontend.md)）が完了していること。全7ルートの画面が動き、`npm test` が **shared 31 + api 76 + web 126 = 233 tests** で通り、`npm run typecheck` がエラーなしの状態から始める。

**Goal:** Plan 2 が積み残した API の欠落を埋め、Playwright の E2E 3本でブラウザからの通しを固定し、レビューを通したうえで本番へデプロイし、`legacy/` を消して移行を完了する。

**Architecture:** 新しい仕組みは増やさない。`GET /api/users` は既存の `listUsers`（Plan 1 で書かれたが、どのルートからも使われていない）に薄いルートを1本足すだけ。E2E は独立した npm workspace `e2e` に置き、**ビルド済みの SPA を配信する `wrangler dev`** に対して実行する（本番と同じ経路を通すため）。デプロイと Cloudflare Access の設定は、アカウント操作を伴うため**利用者本人が実行**し、エージェントは準備と検証だけを行う。

**Tech Stack:** Playwright 1.62 / Hono 4 + zod 4 / React 19 + TanStack Query 5 / Wrangler 4 / Vitest 4

---

## Global Constraints

すべてのタスクの要件に、以下が暗黙に含まれる。

- 金額はすべて**整数（円）**。浮動小数点を金額計算に使わない
- 文字列比較は `localeCompare` を使わず、`@warikan/shared` の `compareStr`（コードユニット比較）を使う
- API レスポンスは共通エンベロープ `{ ok: true, data }` / `{ ok: false, error: { code, message, fields? } }`
- **実在のメールアドレスをソース・マイグレーション・テストフィクスチャ・E2E に書かない。** `me@example.com` / `partner@example.com` を使う
- **`Cf-Access-Authenticated-User-Email` ヘッダを信用しない。必ず `Cf-Access-Jwt-Assertion` の署名を検証する**
- `ACCESS_AUD` と `ACCESS_ALLOWED_EMAILS` は secret として設定し、`wrangler.jsonc` の `vars` に書かない
- `DEV_BYPASS_EMAIL` は JWT 検証を省くだけで、`ACCESS_ALLOWED_EMAILS` の許可リスト判定は常に適用される
- エラーレスポンスに内部情報を漏らさない（汎用の 403「アクセス権がありません」、汎用の 500）
- ファイルは1つの責務に絞る。200〜400行を目安、800行を上限とする
- **既存のテストを壊さない。** 233 tests は常に通ったままにする。型チェックも常に通す
- 繰り返す行のボタン・ラベルには行を識別できる情報をアクセシブル名に入れる（Plan 2 で3回踏んだ）
- **`wrangler deploy` / `migrate:remote` / `wrangler secret put` / `--remote` 系はエージェントが実行しない。** Task 7 で利用者に手順を提示し、実行は利用者が行う
- **ローカルの `wrangler dev` はポート 8788 を使う。** 8787 は別プロジェクト（`kakei-dashboard-3`）が常駐している

### 実測済みの前提（推測で書き換えないこと）

Plan 3 を書く時点で、実際にコードを読んで確認した。

| 項目 | 実測値 |
|---|---|
| `@playwright/test` の最新 | **1.62.1**（未インストール。Task 4 で入れる） |
| `@types/node` | **未インストール**（`node_modules/@types/node` が無い）。Task 4 で `^24.13.3` を入れる。ローカルの Node は v24.13.1 |
| `<input type="date">` の ARIA ロール | **無し**。`getByRole("textbox")` では拾えないので、日付だけ `getByLabel("日付")` を使う（`ExpenseForm.tsx:89-97`） |
| `apps/api/src/db/users.ts` の `listUsers` | 実装済み・**どのルートからも未使用**。`SELECT * FROM users ORDER BY created_at, id` |
| `POST /api/events` の上限 | `title ≤ 60` / メンバー名 `1〜30` / メンバー数 `1〜20` / 品目名 `1〜60` / 品目数 `≤ 200` / 金額 `0〜10,000,000`（`apps/api/src/routes/events.ts:19-36`） |
| クライアント側にある上限 | タイトル `maxLength=60`、参加者名 `maxLength=30`、品目名 `maxLength=60`、参加者数 `MAX_MEMBERS=20` |
| クライアント側に**無い**上限 | **金額の上限**（`AmountInput` は下限と整数だけ見る）、**品目数の上限**（`addItem` は無制限） |
| テストの許可メール | `ACCESS_ALLOWED_EMAILS: "me@example.com,partner@example.com"`（`apps/api/vitest.config.ts`） |
| `wrangler.jsonc` の `vars` | `ACCESS_TEAM_DOMAIN: ""`（**空。デプロイ前に埋める必要がある**） |
| `flask-parity.json` | `packages/shared/src/__fixtures__/` にコミット済み。`settlement.parity.test.ts` が import する |

**`ApiError.fields` を UI に出す案は採用しない。** `fail()` の呼び出し27箇所のうち `fields` を伴うのは6箇所だけで、いずれもメッセージ側（「日付はその月の範囲で指定してください」等）が既に利用者向けの日本語になっている。`fields` の中身は `{ spentOn: "対象月外" }` のような開発者向けの短句なので、画面に出しても情報が増えない。**Plan 2 の持ち越し候補から外す。**

### 設計書との差異（意図的）

設計書 §10 は Phase 5（デプロイ）→ Phase 6（E2E）の順だが、**この計画では E2E を先に置く**。理由は2つ。

1. `GET /api/users` は画面の挙動を変える。E2E を先に書くと、直後に書き換えることになる
2. 本番へ出す前にブラウザからの通しを固定しておきたい。デプロイ後に E2E が落ちると、原因がコードか Access 設定か切り分けられない

`security-reviewer` はデプロイの**直前**に置く（設計書「Phase 2 と 5 の終わりには `security-reviewer`」の趣旨を満たす）。

---

## ファイル構成

このプランで作る／変えるファイルと、それぞれの責務。

| パス | 新規/変更 | 責務 |
|---|---|---|
| `apps/api/src/routes/users.ts` | 新規 | `GET /api/users`。登録ユーザーの `userId` と `displayName` だけを返す |
| `apps/api/src/index.ts` | 変更 | `/api/users` のルート登録（1行） |
| `apps/api/test/users.test.ts` | 新規 | 上記の統合テスト（認証・レスポンス形・email 非露出） |
| `apps/web/src/lib/types.ts` | 変更 | `UserSummary` 型の追加 |
| `apps/web/src/lib/queryKeys.ts` | 変更 | `users()` キーの追加 |
| `apps/web/src/features/monthly/queries.ts` | 変更 | `useUsers` フックの追加 |
| `apps/web/src/routes/MonthlyRecord.tsx` | 変更 | 支払者候補の作り方を `useUsers` に差し替え |
| `apps/web/src/routes/MonthlyRecord.test.tsx` | 新規 | 支払者候補が API 由来になったことを固定 |
| `apps/web/src/lib/limits.ts` | 新規 | API の zod と対になる上限値。金額と品目数 |
| `apps/web/src/components/AmountInput.tsx` | 変更 | 金額の上限を入力段階で弾く |
| `apps/web/src/features/events/wizardReducer.ts` | 変更 | 品目数の上限 |
| `e2e/package.json` | 新規 | `@warikan/e2e` ワークスペース。`test:e2e` スクリプト |
| `e2e/playwright.config.ts` | 新規 | 対象 URL、globalSetup、レポータ |
| `e2e/global-setup.ts` | 新規 | サーバ疎通の確認、テスト用データの初期化、ユーザー2人の担保 |
| `e2e/helpers/db.ts` | 新規 | `wrangler d1 execute --local` の薄いラッパ |
| `e2e/helpers/locators.ts` | 新規 | 行・カードを一意に絞るロケータ。同じ金額や名前が複数箇所に出るため |
| `e2e/monthly.spec.ts` | 新規 | フロー1（月次） |
| `e2e/event-simple.spec.ts` | 新規 | フロー2（単発シンプル） |
| `e2e/event-items.spec.ts` | 新規 | フロー3（単発品目別） |
| `package.json`（ルート） | 変更 | `e2e` をワークスペースに追加、`test:e2e` スクリプト |
| `apps/api/wrangler.jsonc` | 変更 | `ACCESS_TEAM_DOMAIN` の実値（Task 7） |
| `README.md` / `CLAUDE.md` | 変更 | E2E の実行方法、Access 設定、`legacy/` の記述削除 |
| `legacy/` | 削除 | Task 8 |

**`e2e` を独立したワークスペースにする理由**: `apps/web` に置くと jsdom の Vitest と Playwright が同じ `test` スクリプトに同居する。E2E はサーバの起動を要求し実行も遅いので、`npm test`（ルート）からは切り離し、`npm run test:e2e` で明示的に呼ぶ形にする。

---

## Task 1: `GET /api/users`

月次の支払者トグルに相手が出ない制約を解消するための API。Plan 1 で `listUsers` は書かれたが、公開するルートが無かった。

**Files:**
- Create: `apps/api/src/routes/users.ts`
- Create: `apps/api/test/users.test.ts`
- Modify: `apps/api/src/index.ts`

**Interfaces:**
- Consumes: `listUsers(db)`（`apps/api/src/db/users.ts:12`）、`ok`（`apps/api/src/lib/response.ts`）、`AppEnv`（`apps/api/src/env.ts`）
- Produces: `GET /api/users` → `{ ok: true, data: { userId: string; displayName: string }[] }`。Task 2 のフロントが使う

- [ ] **Step 1: 失敗するテストを書く**

`apps/api/test/users.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";

import { ALLOWED_EMAIL, PARTNER_EMAIL, anonFetch, authedFetch, jsonBody, resetDb } from "./helpers.js";

type UserSummary = { userId: string; displayName: string };
type Envelope<T> = { ok: boolean; data?: T; error?: { code: string } };

/** 認証を1回通すと、その email の users 行が無ければ作られる（middleware/auth.ts）。 */
const signIn = (email: string) => authedFetch("/api/me", {}, email);

describe("GET /api/users", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("登録済みのユーザーを返す", async () => {
    await signIn(ALLOWED_EMAIL);
    await signIn(PARTNER_EMAIL);

    const res = await authedFetch("/api/users");
    const body = await jsonBody<Envelope<UserSummary[]>>(res);

    expect(res.status).toBe(200);
    // 並び順は created_at → id。同じミリ秒に作られると id（乱数）で決まるため、
    // 順序は固定できない。集合として一致することだけを見る。
    expect(body.data?.map((user) => user.displayName).sort()).toEqual(["me", "partner"]);
  });

  it("email を返さない", async () => {
    await signIn(ALLOWED_EMAIL);

    const res = await authedFetch("/api/users");
    const raw = await res.text();

    // 相手のメールアドレスを配る理由が無い。JSON 全体を文字列で見て、
    // キー名だけでなく値の混入も同時に弾く。
    expect(raw).not.toContain("@");
    expect(raw).not.toContain("email");
  });

  it("自分しか居なければ1件返る", async () => {
    await signIn(ALLOWED_EMAIL);

    const body = await jsonBody<Envelope<UserSummary[]>>(await authedFetch("/api/users"));

    expect(body.data).toHaveLength(1);
    expect(body.data?.[0]?.userId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("認証を通らないと 403", async () => {
    const res = await anonFetch("/api/users");
    const body = await jsonBody<Envelope<UserSummary[]>>(res);

    expect(res.status).toBe(403);
    expect(body.error?.code).toBe("FORBIDDEN");
  });
});
```

- [ ] **Step 2: テストを実行して失敗することを確認する**

Run: `npm test -w @warikan/api`
Expected: FAIL — `GET /api/users` が 404（`app.notFound` のエンベロープ）を返す

- [ ] **Step 3: ルートを実装する**

`apps/api/src/routes/users.ts`:

```ts
import { Hono } from "hono";

import { listUsers } from "../db/users.js";
import type { AppEnv } from "../env.js";
import { ok } from "../lib/response.js";

export const userRoutes = new Hono<AppEnv>();

/**
 * 登録済みユーザーの一覧。月次の支払者トグルが使う。
 *
 * email は返さない。画面が要るのは表示名だけで、相手のメールアドレスを
 * 配る理由が無い（GET /api/me は自分の分だけ返す）。
 */
userRoutes.get("/", async (c) => {
  const rows = await listUsers(c.env.DB);

  return c.json(ok(rows.map((row) => ({ userId: row.id, displayName: row.display_name }))));
});
```

- [ ] **Step 4: ルートを登録する**

`apps/api/src/index.ts` の import に追加:

```ts
import { userRoutes } from "./routes/users.js";
```

`app.route("/api/me", meRoutes);` の直後に追加:

```ts
app.route("/api/users", userRoutes);
```

- [ ] **Step 5: テストを実行して通ることを確認する**

Run: `npm test -w @warikan/api`
Expected: PASS（api 80 tests）

Run: `npm run typecheck -w @warikan/api`
Expected: エラーなし

- [ ] **Step 6: ミューテーションで「email を返さない」が本当に守られているか確かめる**

`users.ts` の map を一時的に `({ userId: row.id, displayName: row.display_name, email: row.email })` に変えて `npm test -w @warikan/api` を実行する。

Expected: 「email を返さない」が FAIL する。確認できたら**必ず元に戻す**。

- [ ] **Step 7: コミット**

```bash
git add apps/api
git commit -m "feat: 登録ユーザー一覧を返す GET /api/users を追加"
```

---

## Task 2: 月次の支払者候補を `GET /api/users` に載せ替える

Plan 2 の既知の制約（相手が1件も記録していない月では相手を選べず、表示名が「パートナー」の固定文言になる）を解消する。

**Files:**
- Modify: `apps/web/src/lib/types.ts`, `apps/web/src/lib/queryKeys.ts`
- Modify: `apps/web/src/features/monthly/queries.ts`
- Modify: `apps/web/src/routes/MonthlyRecord.tsx`
- Create: `apps/web/src/routes/MonthlyRecord.test.tsx`

**Interfaces:**
- Consumes: Task 1 の `GET /api/users`、`apiGet`（`apps/web/src/lib/api.ts`）
- Produces: `useUsers()` → `UseQueryResult<UserSummary[]>`。`queryKeys.users()` = `["users"]`

- [ ] **Step 1: 失敗するテストを書く**

`apps/web/src/routes/MonthlyRecord.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MonthlyRecord } from "./MonthlyRecord.js";

/**
 * 支払者の候補は「自分 + その月の支出に現れた人」ではなく
 * GET /api/users から作る。相手がまだ1件も記録していない月でも
 * 相手を選べ、表示名も本人の設定どおりになることを固定する。
 */
const envelope = (data: unknown) =>
  new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const routeFor = (path: string): unknown => {
  if (path === "/api/me") return { userId: "u1", email: "me@example.com", displayName: "わたし" };
  if (path === "/api/users") {
    return [
      { userId: "u1", displayName: "わたし" },
      { userId: "u2", displayName: "つれあい" },
    ];
  }
  if (path === "/api/categories") return [{ id: 1, name: "食費" }];
  if (path.startsWith("/api/monthly/")) {
    return {
      period: { ym: "2026-08", year: 2026, month: 8, status: "open", isDirty: false, settledAt: null },
      // 支出は自分の分だけ。それでも相手が候補に出ることを見る。
      expenses: [
        { id: "e1", paidBy: "u1", amount: 3000, itemName: "牛乳", categoryId: 1, spentOn: "2026-08-03" },
      ],
    };
  }
  throw new Error(`予期しないパス: ${path}`);
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => envelope(routeFor(String(input)))),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const setup = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/monthly/2026-08"]}>
        <Routes>
          <Route path="/monthly/:ym" element={<MonthlyRecord />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("MonthlyRecord の支払者候補", () => {
  it("支出が無い相手も候補に出す", async () => {
    setup();

    expect(await screen.findByRole("radio", { name: "わたし" })).toBeInTheDocument();
    expect(await screen.findByRole("radio", { name: "つれあい" })).toBeInTheDocument();
  });

  it("固定文言の「パートナー」を出さない", async () => {
    setup();

    await screen.findByRole("radio", { name: "つれあい" });
    expect(screen.queryByText("パートナー")).not.toBeInTheDocument();
  });

  it("支出一覧の支払者名も API の表示名で出す", async () => {
    setup();

    expect(await screen.findByText(/わたし/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: テストを実行して失敗することを確認する**

Run: `npm test -w @warikan/web`
Expected: FAIL — `/api/users` が呼ばれず `routeFor` が「予期しないパス」で投げる、もしくは候補が1件しか出ない

- [ ] **Step 3: 型とクエリキーを足す**

`apps/web/src/lib/types.ts` の `Me` の直後に追加:

```ts
/** GET /api/users。email は返らない。 */
export type UserSummary = {
  userId: string;
  displayName: string;
};
```

`apps/web/src/lib/queryKeys.ts` の `me` の直後に追加:

```ts
  users: () => ["users"] as const,
```

- [ ] **Step 4: フックを足す**

`apps/web/src/features/monthly/queries.ts` の import に `UserSummary` を追加し、`useMe` の直後に追加:

```ts
/** 登録済みユーザー。2人しか居らず、増えることも稀なので長めに寝かせる。 */
export const useUsers = () =>
  useQuery({
    queryKey: queryKeys.users(),
    queryFn: () => apiGet<UserSummary[]>("/api/users"),
    staleTime: 5 * 60 * 1000,
  });
```

- [ ] **Step 5: MonthlyRecord を差し替える**

`apps/web/src/routes/MonthlyRecord.tsx` の import に `useUsers` を足し、`const categories = useCategories();` の直後に追加:

```ts
  const users = useUsers();
```

`const error = ...` の行に `users.error` を足す:

```ts
  const error =
    me.error ?? users.error ?? categories.error ?? monthly.error ?? addExpense.error ?? deleteExpense.error;
```

支払者候補を組み立てている次のブロックを**まるごと削除**する:

```ts
  // 支払者の候補は「自分」と「支出に現れたもう一人」から作る。
  // 制約は Task 7 の注記および README の「既知の制約」を参照。
  const users = me.data ? [{ userId: me.data.userId, displayName: me.data.displayName }] : [];
  const known = new Set(users.map((user) => user.userId));
  for (const expense of monthly.data?.expenses ?? []) {
    if (!known.has(expense.paidBy)) {
      known.add(expense.paidBy);
      users.push({ userId: expense.paidBy, displayName: "パートナー" });
    }
  }
```

`ExpenseForm` と `ExpenseList` に渡している `users` を `users.data ?? []` に変える:

```tsx
        <ExpenseForm
          ym={ym}
          users={users.data ?? []}
          categories={categories.data ?? []}
          defaultPaidBy={me.data.userId}
          isSubmitting={addExpense.isPending}
          onSubmit={(input) => addExpense.mutate(input)}
        />
```

```tsx
        <ExpenseList
          expenses={monthly.data?.expenses ?? []}
          users={users.data ?? []}
          categories={categories.data ?? []}
          deletingId={deleteExpense.isPending ? (deleteExpense.variables ?? null) : null}
          onDelete={(id) => deleteExpense.mutate(id)}
        />
```

- [ ] **Step 6: テストと型チェックを通す**

Run: `npm test -w @warikan/web`
Expected: PASS（web 129 tests）

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 7: 残る制約を README に反映する**

**この変更でも解消しきらない部分がある。** `users` 行は Access を通った初回リクエストで作られる（`apps/api/src/middleware/auth.ts:67-68`）ため、**相手が一度もログインしていないうちは `GET /api/users` が1件しか返さない**。

`README.md` の「既知の制約」節（見出しと、その下の1段落）を次に差し替える:

```markdown
## 既知の制約

月次モードの支払者トグルには、`users` テーブルに行があるユーザーだけが出る。行は Cloudflare Access を通った初回アクセスで作られるため、**相手が一度もログインしていない間は相手を選べない**。相手が1回ログインすれば以後は常に出る。
```

`README.md` の API 表の `| GET | /api/categories | 有効なカテゴリ一覧 |` の直前に1行足す:

```markdown
| `GET` | `/api/users` | 登録済みユーザーの一覧（`userId` と `displayName` のみ） |
```

- [ ] **Step 8: ミューテーションで確かめる**

`useUsers` の `queryFn` を `() => apiGet<UserSummary[]>("/api/me").then(() => [])` に一時的に変える（空配列を返す）。

Run: `npm test -w @warikan/web`
Expected: 「支出が無い相手も候補に出す」が FAIL。確認できたら**必ず元に戻す**。

- [ ] **Step 9: コミット**

```bash
git add apps/web README.md
git commit -m "feat: 月次の支払者候補を GET /api/users から作る"
```

---

## Task 3: 金額と品目数のクライアント側上限

API は `0〜10,000,000` と `品目 ≤ 200` を弾くが、画面側に上限が無い。長いフォームを埋めきってから汎用の 400 が返るのは体験が悪い。

**Files:**
- Create: `apps/web/src/lib/limits.ts`
- Create: `apps/web/src/lib/limits.test.ts`
- Modify: `apps/web/src/components/AmountInput.tsx`
- Modify: `apps/web/src/features/events/wizardReducer.ts`
- Modify: `apps/web/src/features/events/wizardReducer.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `MAX_AMOUNT = 10_000_000`, `MAX_ITEMS = 200`（`apps/web/src/lib/limits.ts`）

- [ ] **Step 1: 失敗するテストを書く**

`apps/web/src/lib/limits.test.ts`:

```ts
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { AmountInput } from "../components/AmountInput.js";
import { MAX_AMOUNT } from "./limits.js";

/**
 * API の zod は amount を 0〜10,000,000 で弾く（apps/api/src/routes/events.ts）。
 * 画面側に上限が無いと、利用者はフォームを全部埋めてから汎用の 400 を受け取る。
 * 入力段階で弾く（負値・小数を弾いているのと同じ扱い）。
 */
it("上限を超える金額は反映しない", async () => {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(<AmountInput id="amount" value="" onChange={onChange} />);

  await user.type(screen.getByRole("spinbutton"), String(MAX_AMOUNT + 1));

  // 途中の桁は上限内なので通る。最後の1文字で上限を超えた時点だけ落ちる。
  expect(onChange).not.toHaveBeenCalledWith(MAX_AMOUNT + 1);
});

it("上限ちょうどは通す", async () => {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(<AmountInput id="amount" value="" onChange={onChange} />);

  await user.type(screen.getByRole("spinbutton"), String(MAX_AMOUNT));

  expect(onChange).toHaveBeenCalledWith(MAX_AMOUNT);
});
```

`apps/web/src/features/events/wizardReducer.test.ts` に追記:

```ts
import { MAX_ITEMS } from "../../lib/limits.js";

it("品目は上限を超えて増えない", () => {
  let state = initialWizardState();
  for (let i = 0; i < MAX_ITEMS + 5; i += 1) {
    state = wizardReducer(state, { type: "addItem" });
  }

  expect(state.items).toHaveLength(MAX_ITEMS);
});
```

- [ ] **Step 2: テストを実行して失敗することを確認する**

Run: `npm test -w @warikan/web`
Expected: FAIL — `./limits.js` が解決できない

- [ ] **Step 3: 上限値のファイルを作る**

`apps/web/src/lib/limits.ts`:

```ts
/**
 * API 側の zod スキーマ（apps/api/src/routes/events.ts, monthly.ts）と対になる値。
 * **片方だけ変えない。** 画面で弾くのは、フォームを埋めきってから
 * 汎用の 400 を返されるのを避けるため。最終的な検証は常にサーバ側で行う。
 */
export const MAX_AMOUNT = 10_000_000;
export const MAX_ITEMS = 200;
```

- [ ] **Step 4: AmountInput に上限を足す**

`apps/web/src/components/AmountInput.tsx` の import に追加:

```ts
import { MAX_AMOUNT } from "../lib/limits.js";
```

`max` 属性を足し、`onChange` の判定を1行変える:

```tsx
      max={MAX_AMOUNT}
```

```tsx
        const parsed = Number(raw);
        if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_AMOUNT) return;
        onChange(parsed);
```

- [ ] **Step 5: wizardReducer に上限を足す**

`apps/web/src/features/events/wizardReducer.ts` の import に追加:

```ts
import { MAX_ITEMS } from "../../lib/limits.js";
```

`addItem` を差し替える:

```ts
    case "addItem":
      return state.items.length >= MAX_ITEMS
        ? state
        : { ...state, items: [...state.items, { name: "", amount: "", paidByIndex: 0 }] };
```

- [ ] **Step 6: テストと型チェックを通す**

Run: `npm test -w @warikan/web`
Expected: PASS（web 132 tests）

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 7: コミット**

```bash
git add apps/web
git commit -m "fix: 金額と品目数の上限を入力段階で弾く"
```

---

## Task 4: Playwright の土台と E2E フロー1（月次）

**Files:**
- Create: `e2e/package.json`, `e2e/playwright.config.ts`, `e2e/global-setup.ts`, `e2e/helpers/db.ts`, `e2e/helpers/locators.ts`, `e2e/monthly.spec.ts`, `e2e/tsconfig.json`
- Modify: `package.json`（ルート）

**Interfaces:**
- Consumes: 起動中の `wrangler dev --port 8788`（ビルド済み `apps/web/dist` を配信）
- Produces: `npm run test:e2e`。`e2e/helpers/db.ts` の `execSql(sql)`、`e2e/helpers/locators.ts` の `rowWith(scope, label)` / `cardWith(page, heading)`、`e2e/global-setup.ts` の `BASE_URL` / `TEST_YM` を Task 5 も使う

- [ ] **Step 1: ワークスペースを作る**

`npm install -w @warikan/e2e` はワークスペースが登録済みでないと失敗する。**先にこの2ファイルを書いてから** install する。

`e2e/package.json`:

```json
{
  "name": "@warikan/e2e",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test:e2e": "playwright test",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  }
}
```

ルート `package.json` の `workspaces` に `"e2e"` を追加し、`scripts` に追加する（`test` には**入れない**。E2E はサーバの起動を要求し実行も遅い）:

```json
  "scripts": {
    "test": "npm run test --workspaces --if-present",
    "test:e2e": "npm run test:e2e -w @warikan/e2e",
    "typecheck": "npm run typecheck --workspaces --if-present"
  },
  "workspaces": [
    "packages/*",
    "apps/*",
    "e2e"
  ]
```

そのうえで Playwright を入れる。`@types/node` も一緒に入れる — **このリポジトリにはまだ入っていない**（`node_modules/@types/node` が無いことを確認済み）。`global-setup.ts` と `helpers/db.ts` が `node:child_process` / `node:url` を import するので、無いと Step 11 の型チェックが落ちる。ローカルの Node は v24 なので major を合わせる:

```bash
npm install -D -w @warikan/e2e @playwright/test@^1.62.1 @types/node@^24.13.3
```

ブラウザ本体も入れる（初回のみ）:

```bash
npx playwright install chromium
```

- [ ] **Step 2: tsconfig を置く**

`e2e/tsconfig.json`（他ワークスペースと同じく `--noEmit` の型チェック用）:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["**/*.ts"]
}
```

- [ ] **Step 3: D1 ヘルパを書く**

`e2e/helpers/db.ts`:

```ts
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// `new URL(...).pathname` は Windows で "/C:/Users/..." になり cwd に渡せない。
// fileURLToPath を通す。
const API_DIR = fileURLToPath(new URL("../../apps/api/", import.meta.url));
const WRANGLER = fileURLToPath(new URL("../../node_modules/wrangler/bin/wrangler.js", import.meta.url));

/**
 * ローカルの D1 に SQL を流す。
 *
 * E2E は wrangler dev（--local）が握っている miniflare の SQLite を見るため、
 * 同じ `wrangler d1 execute --local` 経由でしか触れない。
 * **`--remote` は絶対に付けない。** 本番の DB を壊す。
 *
 * `npx wrangler` ではなく node で wrangler.js を直に叩くのは、Windows では
 * .cmd を shell 無しで起動できず、shell 経由にすると SQL 内の空白・引用符・
 * セミコロンがシェルに再解釈されるため。引数配列のまま渡せばその問題が起きない。
 *
 * `wrangler dev` が同じ SQLite を開いたままでも書き込みは通り、走っている
 * サーバ側にも反映される（Plan 2 Task 12 で実際に確認済み）。
 */
export function execSql(sql: string): void {
  execFileSync(
    process.execPath,
    [WRANGLER, "d1", "execute", "warikan-db", "--local", "--command", sql],
    { cwd: API_DIR, stdio: "pipe" },
  );
}
```

- [ ] **Step 4: ロケータのヘルパを書く**

`e2e/helpers/locators.ts`:

```ts
import type { Locator, Page } from "@playwright/test";

/**
 * 同じ金額が「合計」「一人あたり」「カテゴリ別内訳」「送金」に同時に現れうる。
 * getByText だけだと複数一致して strict mode で落ちる。ラベルで行を絞ってから
 * 金額を見れば、対応関係まで一緒に確かめられる。
 */
export const rowWith = (scope: Page | Locator, label: string): Locator =>
  scope.locator(".list-row").filter({ hasText: label });

/**
 * 見出しでカードを1枚に絞る。品目別の結果画面では、支払者名（"1. 山田"）が
 * 「支払い状況」の行と「品目」の行の両方に出るため、カードで絞らないと
 * 行が一意にならない。
 */
export const cardWith = (page: Page, heading: string): Locator =>
  page.locator(".card").filter({ has: page.getByRole("heading", { name: heading, exact: true }) });
```

- [ ] **Step 5: globalSetup を書く**

`e2e/global-setup.ts`:

```ts
import { execSql } from "./helpers/db.js";

export const BASE_URL = "http://localhost:8788";

/** 実在の月に触れないよう、遠い未来の月をテスト専用に使う。 */
export const TEST_YM = "2099-01";

/**
 * E2E は「起動済みの wrangler dev」に対して実行する。
 *
 * playwright.config.ts の webServer で起動させない理由:
 * Windows では wrangler を落としても子の workerd が残り、親が生きていると
 * 再生成される（CLAUDE.md 参照）。Playwright の webServer は
 * プロセスツリーを親から順に落とす保証が無く、テストのたびに
 * 8788 を掴んだ workerd が積み上がる。手で起動・停止させるほうが安全。
 */
export default async function globalSetup(): Promise<void> {
  const health = await fetch(`${BASE_URL}/api/health`).catch(() => null);
  if (!health || !health.ok) {
    throw new Error(
      [
        `${BASE_URL} に繋がりません。先に次の2つを実行してください。`,
        "  npm run build -w @warikan/web",
        "  npm run dev -w @warikan/api -- --port 8788",
      ].join("\n"),
    );
  }

  // テスト専用の月だけを消す。利用者の実データには触れない。
  execSql(
    `DELETE FROM monthly_expenses WHERE period_ym = '${TEST_YM}';` +
      ` DELETE FROM monthly_periods WHERE ym = '${TEST_YM}';`,
  );

  // 月次は登録済みユーザー全員で割る（apps/api/src/services/settle.ts）。
  // 相手がローカルで一度もログインしていないと1人になり、
  // 一人あたりが総額と一致してしまって精算を確認できない。
  execSql(
    "INSERT OR IGNORE INTO users (id, email, display_name, created_at)" +
      " VALUES ('e2e-partner', 'partner@example.com', 'つれあい', '2000-01-01T00:00:00.000Z')",
  );

  const res = await fetch(`${BASE_URL}/api/users`);
  const body = (await res.json()) as { ok: boolean; data?: { userId: string }[] };
  if (!body.ok || body.data?.length !== 2) {
    throw new Error(
      `登録ユーザーがちょうど2人である前提です（実際: ${body.data?.length ?? "取得失敗"}人）。` +
        " ローカルの users テーブルを確認してください。",
    );
  }
}
```

- [ ] **Step 6: Playwright の設定を書く**

`e2e/playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";

import { BASE_URL } from "./global-setup.js";

export default defineConfig({
  testDir: ".",
  globalSetup: "./global-setup.ts",
  // 同じ D1 を共有するため直列で流す。並列にすると月次の期間を取り合う。
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    browserName: "chromium",
    // スマホ前提のアプリなので視野を狭くする。devices["iPhone 13"] を展開すると
    // defaultBrowserType: "webkit" まで持ち込まれ、入れていない WebKit を
    // 起動しようとして落ちる。必要な値だけを直に書く。
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    trace: "retain-on-failure",
  },
});
```

- [ ] **Step 7: フロー1のテストを書く**

`e2e/monthly.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

import { TEST_YM } from "./global-setup.js";
import { rowWith } from "./helpers/locators.js";

/**
 * 設計書 §8 のフロー1。
 * 支出を3件記録 → 計算 → 精算額が期待値と一致 → 支払い済みにする。
 *
 * 3000 + 1200 + 4800 = 9000。登録ユーザーは2人なので一人あたり 4500。
 * 全額を自分が払っているので、相手 → 自分へ 4500 の送金が1件出る。
 */
const EXPENSES = [
  { amount: "3000", item: "牛乳と卵", date: `${TEST_YM}-05` },
  { amount: "1200", item: "洗剤", date: `${TEST_YM}-09` },
  { amount: "4800", item: "外食", date: `${TEST_YM}-14` },
];

// 2本目は1本目が計算済みであることを前提にする（is_dirty を立てるため）。
test.describe.configure({ mode: "serial" });

test("月次 — 記録して計算し、送金を消し込む", async ({ page }) => {
  await page.goto(`/monthly/${TEST_YM}`);

  for (const expense of EXPENSES) {
    await page.getByRole("spinbutton", { name: "金額" }).fill(expense.amount);
    await page.getByRole("textbox", { name: "品目" }).fill(expense.item);
    // 既定は「今日」で、テスト用の月の範囲外なので必ず入れ直す（API が 400 を返す）。
    // 日付だけ getByLabel を使う。<input type="date"> には対応する ARIA ロールが
    // 無く、getByRole("textbox") では拾えない（金額は type="number" で spinbutton、
    // 品目は type="text" で textbox）。
    await page.getByLabel("日付").fill(expense.date);
    await page.getByRole("button", { name: "記録する" }).click();

    await expect(page.getByRole("button", { name: `${expense.item} を削除` })).toBeVisible();
  }

  // 送信後に消えるのは金額と品目だけ。日付とカテゴリは残る（設計書 §7.1）。
  await expect(page.getByRole("spinbutton", { name: "金額" })).toHaveValue("");
  await expect(page.getByLabel("日付")).toHaveValue(`${TEST_YM}-14`);

  await page.getByRole("link", { name: "計算する" }).click();
  await expect(page).toHaveURL(`/monthly/${TEST_YM}/result`);

  await page.getByRole("button", { name: "計算する" }).click();

  await expect(rowWith(page, "今月の合計")).toContainText("¥9,000");
  await expect(rowWith(page, "一人あたり")).toContainText("¥4,500");

  const toggle = page.getByRole("button", { name: /支払い済みにする$/ });
  await expect(toggle).toHaveCount(1);
  await toggle.click();

  await expect(page.getByRole("button", { name: /未払いに戻す$/ })).toHaveCount(1);
});

test("記録を足すと精算に再計算の警告が出る", async ({ page }) => {
  await page.goto(`/monthly/${TEST_YM}`);

  await page.getByRole("spinbutton", { name: "金額" }).fill("1000");
  await page.getByRole("textbox", { name: "品目" }).fill("追加の記録");
  await page.getByLabel("日付").fill(`${TEST_YM}-20`);
  await page.getByRole("button", { name: "記録する" }).click();
  await expect(page.getByRole("button", { name: "追加の記録 を削除" })).toBeVisible();

  await page.getByRole("link", { name: "計算する" }).click();

  await expect(page.getByRole("alert")).toContainText("記録が変わっています");

  await page.getByRole("button", { name: "再計算する" }).click();

  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(rowWith(page, "今月の合計")).toContainText("¥10,000");
  await expect(rowWith(page, "一人あたり")).toContainText("¥5,000");
});
```

- [ ] **Step 8: サーバを起動して E2E を実行する**

```bash
npm run build -w @warikan/web
```

別のターミナルで:

```bash
npm run dev -w @warikan/api -- --port 8788
```

```bash
npm run test:e2e
```

Expected: 2 passed

**落ちた場合**: `globalSetup` のメッセージを読む。「繋がりません」ならサーバ未起動、「ちょうど2人である前提」ならローカルの `users` に3人以上いる（`npx wrangler d1 execute warikan-db --local --command "SELECT id, email FROM users"` で確認する）。

- [ ] **Step 9: 2回続けて実行し、繰り返し実行できることを確認する**

Run: `npm run test:e2e`
Expected: 2 passed（`globalSetup` がテスト用の月を消すので、状態が残らない）

- [ ] **Step 10: サーバを停止する**

Ctrl+C だけでは子の `workerd` が残り、親が生きていると再生成される。warikan のツリーだけを親から順に落とす。**別プロジェクト（`kakei-dashboard-3`）も同じ `workerd` 名で 8787 に常駐しているので、名前だけで一括終了しないこと。**

まず対象を目で確認する。`CommandLine` に `Project\warikan` を含むものだけが対象:

```bash
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { \$_.CommandLine -like '*Project\\warikan*' -and \$_.Name -in @('node.exe','workerd.exe') } | Select-Object ProcessId,ParentProcessId,Name,CommandLine | Format-List"
```

一覧が warikan のものだけであることを確かめてから、親（`wrangler.js` / `wrangler-dist/cli.js` の node）→ 子（`workerd.exe`）の順に落とす:

```bash
powershell -NoProfile -Command "$p = Get-CimInstance Win32_Process | Where-Object { \$_.CommandLine -like '*Project\\warikan*' -and \$_.Name -in @('node.exe','workerd.exe') }; $p | Where-Object { \$_.Name -eq 'node.exe' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }; $p | Where-Object { \$_.Name -eq 'workerd.exe' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }"
```

最初の一覧コマンドをもう一度実行し、**0件になっていること**を確認する。残っていたらもう一度落とす（親を先に落としているので再生成はされない）。

- [ ] **Step 11: 型チェックとコミット**

Run: `npm run typecheck`
Expected: エラーなし

```bash
git add e2e package.json package-lock.json
git commit -m "test: Playwright の土台と月次の E2E を追加"
```

---

## Task 5: E2E フロー2・3（単発シンプル／品目別）

**Files:**
- Create: `e2e/event-simple.spec.ts`, `e2e/event-items.spec.ts`

**Interfaces:**
- Consumes: Task 4 の `playwright.config.ts`（`baseURL` が効くので `page.goto` は相対パスで書く）、`e2e/helpers/locators.ts` の `rowWith(scope, label)` / `cardWith(page, heading)`
- Produces: なし

- [ ] **Step 1: フロー2を書く**

`e2e/event-simple.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

import { rowWith } from "./helpers/locators.js";

/**
 * 設計書 §8 のフロー2。3人・金額入力 → 精算結果を確認。
 *
 * 10000 + 3500 + 0 = 13500、一人あたり 4500。
 * 田中 +5500 / 佐藤 -1000 / 鈴木 -4500 なので、
 * 鈴木 → 田中 4500、佐藤 → 田中 1000 の2件になる。
 */
test("単発シンプル — 3人で割り勘して結果を確認する", async ({ page, request }) => {
  await page.goto("/events/new");

  await page.getByRole("textbox", { name: "タイトル" }).fill("E2E シンプル");
  await page.getByRole("button", { name: "＋ 参加者を追加" }).click();

  await page.getByRole("textbox", { name: "参加者 1 の名前" }).fill("田中");
  await page.getByRole("textbox", { name: "参加者 2 の名前" }).fill("佐藤");
  await page.getByRole("textbox", { name: "参加者 3 の名前" }).fill("鈴木");

  await page.getByRole("button", { name: "次へ" }).click();

  await page.getByRole("spinbutton", { name: "1. 田中" }).fill("10000");
  await page.getByRole("spinbutton", { name: "2. 佐藤" }).fill("3500");
  // 鈴木は空欄のまま。立て替えていない人は 0 として扱われる。

  await page.getByRole("button", { name: "計算する" }).click();

  await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "E2E シンプル" })).toBeVisible();

  // ¥4,500 は「一人あたり」の行と「鈴木 → 田中」の送金行の両方に出る。
  // getByText だと2件一致して strict mode で落ちるので、行で絞る。
  await expect(rowWith(page, "合計")).toContainText("¥13,500");
  await expect(rowWith(page, "一人あたり")).toContainText("¥4,500");

  // 送金は2件。行番号つきのアクセシブル名で、どの行かを取り違えずに指せる。
  await expect(page.getByRole("button", { name: /支払い済みにする$/ })).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "1. 鈴木 から 田中 への ¥4,500を支払い済みにする" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "2. 佐藤 から 田中 への ¥1,000を支払い済みにする" }),
  ).toBeVisible();

  // 2行目だけを消し込む。1行目が巻き込まれないことまで見る。
  await page.getByRole("button", { name: "2. 佐藤 から 田中 への ¥1,000を支払い済みにする" }).click();
  await expect(
    page.getByRole("button", { name: "2. 佐藤 から 田中 への ¥1,000を未払いに戻す" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "1. 鈴木 から 田中 への ¥4,500を支払い済みにする" }),
  ).toBeVisible();

  // 後片付け。ホームの一覧に残さない。
  const eventId = page.url().split("/").pop();
  expect((await request.delete(`/api/events/${eventId}`)).ok()).toBe(true);
});
```

- [ ] **Step 2: フロー3を書く**

`e2e/event-items.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

import { cardWith, rowWith } from "./helpers/locators.js";

/**
 * 設計書 §8 のフロー3。品目を追加 → 支払者ごとに集計されることを確認。
 *
 * 宿代 18000（山田）/ レンタカー 9400（川口）/ 夕食 7300（川口）。
 * 山田 18000・川口 16700、合計 34700、一人あたり 17350。
 * 川口 → 山田 650 の1件になる。
 */
test("単発品目別 — 支払者ごとに合算されることを確認する", async ({ page, request }) => {
  await page.goto("/events/new");

  await page.getByRole("textbox", { name: "タイトル" }).fill("E2E 品目別");
  await page.getByRole("radio", { name: "品目別" }).click();

  await page.getByRole("textbox", { name: "参加者 1 の名前" }).fill("山田");
  await page.getByRole("textbox", { name: "参加者 2 の名前" }).fill("川口");

  await page.getByRole("button", { name: "次へ" }).click();

  const items = [
    { name: "宿代", amount: "18000", payer: "山田" },
    { name: "レンタカー", amount: "9400", payer: "川口" },
    { name: "夕食", amount: "7300", payer: "川口" },
  ];

  for (const [index, item] of items.entries()) {
    await page.getByRole("button", { name: "＋ 品目を追加" }).click();
    await page.getByRole("textbox", { name: `品目 ${index + 1} の品目名` }).fill(item.name);
    await page.getByRole("spinbutton", { name: `品目 ${index + 1} の金額` }).fill(item.amount);
    await page.getByLabel(`品目 ${index + 1} の支払った人`).selectOption({ label: item.payer });
  }

  // 入力画面の「合計」行（ItemsInput）。入力しながら積み上がることを見る。
  await expect(rowWith(page, "合計")).toContainText("¥34,700");

  await page.getByRole("button", { name: "計算する" }).click();

  await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}$/);

  // 品目別では、入力した「立て替え額」ではなく品目の合算が支払額になる。
  // ¥18,000 は「支払い状況」の 山田 の行と「品目」の 宿代 の行の両方に出るので、
  // カードで絞ってから行を指す。ここで見たいのは「合算された支払額」のほう。
  const paidCard = cardWith(page, "支払い状況");
  await expect(rowWith(paidCard, "1. 山田")).toContainText("¥18,000");
  await expect(rowWith(paidCard, "2. 川口")).toContainText("¥16,700");
  await expect(rowWith(page, "一人あたり")).toContainText("¥17,350");

  await expect(
    page.getByRole("button", { name: "1. 川口 から 山田 への ¥650を支払い済みにする" }),
  ).toBeVisible();

  const eventId = page.url().split("/").pop();
  expect((await request.delete(`/api/events/${eventId}`)).ok()).toBe(true);
});
```

- [ ] **Step 3: サーバを起動して3本とも実行する**

```bash
npm run build -w @warikan/web
```

別のターミナルで `npm run dev -w @warikan/api -- --port 8788` を起動したうえで:

```bash
npm run test:e2e
```

Expected: 4 passed（月次2本 + 単発2本）

- [ ] **Step 4: 落ちる変更を入れて、E2E が本当に検知することを確かめる**

`apps/web/src/routes/EventDetail.tsx` の送金一覧で `detail.settlements` を `[...detail.settlements].reverse()` に一時的に変え、`npm run build -w @warikan/web` してから `npm run test:e2e` を実行する。

Expected: `event-simple` が FAIL（行番号と当事者の組み合わせが入れ替わる）。確認できたら**必ず元に戻して再ビルドする**。

- [ ] **Step 5: サーバを停止する**

Ctrl+C だけでは子の `workerd` が残り、親が生きていると再生成される。**別プロジェクト（`kakei-dashboard-3`）も同じ `workerd` 名で 8787 に常駐しているので、名前だけで一括終了しないこと。**

まず対象を目で確認する:

```bash
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { \$_.CommandLine -like '*Project\\warikan*' -and \$_.Name -in @('node.exe','workerd.exe') } | Select-Object ProcessId,ParentProcessId,Name,CommandLine | Format-List"
```

warikan のものだけであることを確かめてから、親（node）→ 子（`workerd.exe`）の順に落とす:

```bash
powershell -NoProfile -Command "$p = Get-CimInstance Win32_Process | Where-Object { \$_.CommandLine -like '*Project\\warikan*' -and \$_.Name -in @('node.exe','workerd.exe') }; $p | Where-Object { \$_.Name -eq 'node.exe' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }; $p | Where-Object { \$_.Name -eq 'workerd.exe' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }"
```

最初の一覧コマンドをもう一度実行し、**0件になっていること**を確認する。

- [ ] **Step 6: README に E2E の実行方法を書く**

`README.md` の「開発」節の末尾に追加:

```markdown
E2E（Playwright）。**起動済みの `wrangler dev` に対して実行する**ので、先にビルドとサーバ起動が要る:

```bash
npm run build -w @warikan/web
```

```bash
npm run dev -w @warikan/api -- --port 8788
```

```bash
npm run test:e2e
```

ブラウザ本体が入っていなければ `npx playwright install chromium` を一度だけ実行する。E2E は `2099-01` をテスト専用の月として使い、実行のたびにその月だけを消す。実データには触れない。
```

- [ ] **Step 7: 型チェックとコミット**

Run: `npm run typecheck`
Expected: エラーなし

```bash
git add e2e README.md
git commit -m "test: 単発割り勘の E2E を2本追加"
```

---

## Task 6: `code-reviewer` と `security-reviewer` の通し

設計書 §10「各フェーズの終わりに `code-reviewer` を、Phase 2 と 5 の終わりには `security-reviewer` を通す」。デプロイの直前に置く。

**Files:**
- Modify: レビューの指摘に応じて（範囲は指摘を見てから決める）

**Interfaces:**
- Consumes: なし
- Produces: なし

- [ ] **Step 1: `code-reviewer` を呼ぶ**

次の入力で `code-reviewer` サブエージェントを呼ぶ。

```
対象: warikan（夫婦2人の割り勘アプリ、Cloudflare Workers + D1 + React）の全コード。
    packages/shared, apps/api/src, apps/web/src, e2e を見てください。

このプロジェクト固有の制約は CLAUDE.md にあります。特に次を重点的に見てください。

- 金額はすべて整数（円）。浮動小数点が金額計算に混じっていないか
- 文字列比較に localeCompare が使われていないか（compareStr を使う）
- D1 で複数文を原子的に実行すべき箇所が env.DB.batch([...]) になっているか
- API レスポンスが共通エンベロープに揃っているか
- ファイルが1つの責務に絞られているか（200〜400行目安、800行上限）

報告のみで、コードは直さないでください。重大度をつけてください。
```

- [ ] **Step 2: `security-reviewer` を呼ぶ**

次の入力で `security-reviewer` サブエージェントを呼ぶ。

```
対象: warikan の認証まわりと、本番デプロイ前の最終確認。

重点:
- apps/api/src/middleware/auth.ts — Cloudflare Access の JWT 検証。
  Cf-Access-Authenticated-User-Email ヘッダを信用していないか、
  issuer / audience の検証が抜けていないか、JWKS のキャッシュに問題が無いか
- DEV_BYPASS_EMAIL が本番で有効にならないか。
  許可リスト（ACCESS_ALLOWED_EMAILS）の判定がバイパス時も効いているか
- ソース・マイグレーション・テスト・E2E に実在のメールアドレスが書かれていないか
- ハードコードされた秘密情報が無いか
- エラーレスポンスが内部情報を漏らしていないか（403 と 500 は汎用文言）
- GET /api/users が email を返していないか
- SQL がすべてプレースホルダで組まれているか（文字列連結が無いか）

報告のみで、コードは直さないでください。重大度をつけてください。
```

- [ ] **Step 3: 指摘を自分で確かめる**

**報告をそのまま信じない。** 各指摘について、該当箇所を実際に読み、可能ならミューテーション（意図的に壊してテストが落ちるか）で裏を取る。Plan 2 では「テストが通っている」ことが正しさの証拠にならない例を6件踏んだ。

- [ ] **Step 4: CRITICAL / HIGH を直す**

確認できた CRITICAL と HIGH は、このタスクの中で直す。直すときは**先に落ちるテストを書く**。MEDIUM 以下は判断して取捨し、見送るものは理由とともにこの計画へ書き残す。

- [ ] **Step 5: 全テストと型チェックを通す**

Run: `npm test`
Expected: すべて PASS

Run: `npm run typecheck`
Expected: エラーなし

サーバを起動して `npm run test:e2e` も通す（4 passed）。

- [ ] **Step 6: コミット**

```bash
git add -A
git commit -m "fix: code-reviewer と security-reviewer の指摘に対応"
```

指摘が無く修正が発生しなかった場合はコミットしない。結果はこの計画に追記する。

---

## Task 7: Cloudflare Access の設定と本番デプロイ

**このタスクの実行主体は利用者本人。** エージェントは準備・手順提示・デプロイ後の検証だけを行い、`wrangler deploy` / `wrangler secret put` / `migrate:remote` は実行しない（Global Constraints）。

**Files:**
- Modify: `apps/api/wrangler.jsonc`（`ACCESS_TEAM_DOMAIN` の実値）

**Interfaces:**
- Consumes: なし
- Produces: `https://warikan.y-kakeibo.workers.dev` が2人だけに開いている状態

- [ ] **Step 1: 利用者に Cloudflare Access の設定を依頼する**

次を利用者に提示し、**完了の返答を待つ**。エージェントはダッシュボードを操作しない。

```
Cloudflare ダッシュボードで次を行ってください。

1. Zero Trust → Access → Applications → Add an application → Self-hosted
2. Application name: warikan
   Session Duration: 任意（1 week 程度）
   Public hostname: warikan.y-kakeibo.workers.dev
3. Policy を1つ作る
   Policy name: allowed-two
   Action: Allow
   Include: Emails → ご自身とパートナーのメールアドレス2件
4. 作成後、Application の Overview に出る **Application Audience (AUD) Tag** を控える
5. Zero Trust のチーム名（<team>.cloudflareaccess.com の <team> 部分）を控える

控えた2つは次のステップで使います。**AUD Tag はここに貼らず**、
ご自身の手元で wrangler secret に入れてください。
```

- [ ] **Step 2: `ACCESS_TEAM_DOMAIN` を `wrangler.jsonc` に書く**

チームドメインは秘密情報ではない（設計書 §3.3 で var 扱い）。利用者から受け取った値で `apps/api/wrangler.jsonc` の空欄を埋める:

```jsonc
  "vars": {
    "ACCESS_TEAM_DOMAIN": "<team>.cloudflareaccess.com"
  }
```

**`ACCESS_AUD` と `ACCESS_ALLOWED_EMAILS` はここに書かない。** secret として入れる。

- [ ] **Step 3: 利用者に secret 投入とデプロイを依頼する**

次を利用者に提示し、**実行はしない**。

```bash
npx wrangler secret put ACCESS_AUD --cwd apps/api
```

```bash
npx wrangler secret put ACCESS_ALLOWED_EMAILS --cwd apps/api
```

（カンマ区切りで2件。空白は入れても除去されます）

本番の D1 にマイグレーションを流す:

```bash
npm run migrate:remote -w @warikan/api
```

画面をビルドしてからデプロイする（`dist` が古いと古い画面が出ます）:

```bash
npm run build -w @warikan/web
```

```bash
npm run deploy -w @warikan/api
```

- [ ] **Step 4: デプロイ後の検証（エージェントが実行してよい範囲）**

Access が有効なら、認証を通らないリクエストは Cloudflare のログイン画面へ飛ぶ。**Worker まで届かない**ので、Worker の 403 は観測できない。確認できるのは「素通しになっていないこと」。

```bash
curl -si https://warikan.y-kakeibo.workers.dev/api/health | head -20
```

Expected: `302`（`<team>.cloudflareaccess.com` へのリダイレクト）。`200` かつ `{"ok":true,...}` が返る場合、**Access が効いていない**。Step 1 の設定を見直す。

- [ ] **Step 5: 利用者に2人でのログイン確認を依頼する**

```
1. ご自身のブラウザで https://warikan.y-kakeibo.workers.dev を開き、
   Access のログインを通して画面が出ることを確認してください
2. パートナーにも一度ログインしてもらってください。
   **これをしないと users テーブルに行ができず、月次の支払者トグルに
   相手が出ません**（Task 2 の注記）
3. 許可していない第三者のアカウントでは入れないことを確認してください
```

- [ ] **Step 6: コミット**

```bash
git add apps/api/wrangler.jsonc
git commit -m "chore: Access のチームドメインを設定する"
```

---

## Task 8: `legacy/` の削除と文書の最終更新

設計書 Phase 7。完了条件は「旧 Flask 実装への参照が残っていない」。

**Files:**
- Delete: `legacy/`
- Modify: `CLAUDE.md`, `README.md`
- Modify: `packages/shared/src/settlement.parity.test.ts`（コメントのみ）

**Interfaces:**
- Consumes: なし
- Produces: なし

- [ ] **Step 1: パリティテストが `legacy/` に依存していないことを確認する**

`packages/shared/src/settlement.parity.test.ts` は `__fixtures__/flask-parity.json` を import しているだけで、`legacy/` のコードは読まない。フィクスチャはコミット済みなので、`legacy/` を消してもテストは通る。

Run: `npm test -w @warikan/shared`
Expected: PASS（31 tests）— 削除前の基準値

- [ ] **Step 2: パリティテストに、再生成できなくなることを書き残す**

`packages/shared/src/settlement.parity.test.ts` の `describe` の直前に追記:

```ts
/**
 * このフィクスチャは移行前の Flask 実装（旧 legacy/parity_dump.py）が出力したもの。
 * Flask 実装は Plan 3 で削除したため、**再生成はできない**。
 * 作り直すには git 履歴から legacy/ を取り出す必要がある。
 * 値を手で書き換えると、同値性の証拠でなくなる。
 */
```

- [ ] **Step 3: `legacy/` を消す**

```bash
git rm -r legacy
```

- [ ] **Step 4: テストと型チェックを通す**

Run: `npm test`
Expected: すべて PASS（削除前と同じ件数）

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 5: `CLAUDE.md` から Flask の記述を消す**

**5-1.** 冒頭の「注意」ブロック。次の6行を

```markdown
> **注意:** このリポジトリは Cloudflare Workers + D1 + React への移行作業中です。
> `legacy/` 配下は移行前の Flask 実装で、パリティ確認のために残しています。
> 新規の作業は `apps/` と `packages/` で行ってください。
>
> - 設計書: [docs/superpowers/specs/2026-08-05-warikan-cloudflare-design.md](docs/superpowers/specs/2026-08-05-warikan-cloudflare-design.md)
> - 実装計画: [docs/superpowers/plans/](docs/superpowers/plans/)
```

次に差し替える:

```markdown
> **設計と実装計画:**
>
> - 設計書: [docs/superpowers/specs/2026-08-05-warikan-cloudflare-design.md](docs/superpowers/specs/2026-08-05-warikan-cloudflare-design.md)
> - 実装計画: [docs/superpowers/plans/](docs/superpowers/plans/)
```

**5-2.** ディレクトリ構成表から次の1行を削除する:

```markdown
| `legacy` | 移行前の Flask 実装。パリティ確認用で、移行完了後に削除する |
```

**5-3.** 「## legacy/ の Flask 実装について」の節を、見出しから節末（`docs/app-analysis.md` に触れている段落まで）**丸ごと削除**する。

**5-4.** 「開発コマンド」節の末尾（カバレッジ・`vitest` の注記より前）に E2E を追記する:

```markdown
E2E（Playwright）は**起動済みの `wrangler dev` に対して**実行する。`playwright.config.ts` の `webServer` で起動させていないのは、Windows では wrangler を落としても子の `workerd` が残り、Playwright がツリーを親から落とす保証が無いため。ポートは 8788 を使う（8787 は別プロジェクトが常駐）。先に web をビルドし、別ターミナルで `npm run dev -w @warikan/api -- --port 8788` を起動しておくこと。

```bash
npm run test:e2e
```
```

- [ ] **Step 6: `README.md` を更新する**

**6-1.** 構成表から次の1行を削除する:

```markdown
| `legacy` | 移行前の Flask 実装。パリティ確認用 |
```

**6-2.** リポジトリ全体を見て `docs/app-analysis.md` への参照が残っていれば、文言を「移行前の Flask 実装の解析記録」に変える。**このドキュメント自体は消さない** — 移行の経緯と、修正した既知の問題（メンバーを名前で識別、端数の丸め誤差、履歴5件上限、ウィザード状態の Cookie 依存）の記録として価値がある。

**6-3.** Task 2 Step 7 で差し替えた「既知の制約」節が、まだ「Plan 3 で `GET /api/users` を追加して解消する」と書いていないか確認する。書いてあれば Task 2 Step 7 の適用漏れなので、そこで指定した文面に直す。

- [ ] **Step 7: 残っている参照を洗う**

```bash
grep -rn "legacy\|Flask\|app\.py" --include="*.md" --include="*.ts" --include="*.tsx" --include="*.json" --include="*.jsonc" . | grep -v node_modules | grep -v "docs/superpowers/plans/" | grep -v "docs/app-analysis.md" | grep -v ".claude/worktrees/"
```

Expected: `settlement.parity.test.ts` のコメント（Step 2 で書いたもの）だけが残る。過去の計画書（`docs/superpowers/plans/`）は履歴なので書き換えない。

- [ ] **Step 8: 使われていない worktree を確認する**

```bash
git worktree list
```

`.claude/worktrees/` 配下に古い worktree が残っている場合、**利用者に確認してから**消す。git の管理外（`.git/info/exclude`）なので `git status` には出ないが、リポジトリ全体の grep を汚す。

- [ ] **Step 9: コミット**

```bash
git add -A
git commit -m "chore: legacy の Flask 実装を削除し移行を完了する"
```

---

## Self-Review メモ

この計画を設計書と突き合わせた結果。

| 設計書の項目 | 対応タスク |
|---|---|
| Phase 5 Cloudflare Access 設定 + デプロイ | Task 7 |
| Phase 6 Playwright E2E 3本 | Task 4（フロー1）、Task 5（フロー2・3） |
| Phase 7 `legacy/` 削除・README・CLAUDE.md | Task 8 |
| §8 E2E は `DEV_BYPASS_EMAIL` のローカル `wrangler dev` に対して実行 | Task 4 Step 5（`globalSetup` の疎通確認）・Step 8（実行） |
| §10「各フェーズの終わりに `code-reviewer`」「Phase 5 の終わりに `security-reviewer`」 | Task 6（デプロイ直前に置いた） |
| §11「Access の有効化と許可メール登録は利用者本人が行う」 | Task 7 Step 1・3・5 |
| Plan 2 の持ち越し「`GET /api/users`」 | Task 1・2 |
| Plan 2 の持ち越し「クライアント側の上限」 | Task 3 |
| Plan 2 の持ち越し「`ApiError.fields` を UI に出す」 | **採用しない**（理由は「実測済みの前提」節） |

**この計画で意図的に採用した判断**

| 判断 | 理由 |
|---|---|
| E2E をデプロイより前に置く | 本番で落ちたとき、コードと Access 設定を切り分けられなくなる。設計書の順序からは外れる |
| `webServer` を使わず、起動済みサーバを前提にする | Windows では wrangler を落としても子の `workerd` が残る。Playwright の webServer はツリーを親から落とす保証が無く、8788 を掴んだ workerd が積み上がる |
| E2E を `workers: 1` の直列にする | 同じローカル D1 を共有する。並列にすると月次の期間を取り合う |
| テスト専用の月に `2099-01` を使う | 実データのある月を消さないため。日付の既定値（今日）が範囲外になるので、E2E は日付を必ず明示する |
| `globalSetup` で相手ユーザーを `INSERT OR IGNORE` する | 月次は登録ユーザー全員で割る。1人しか居ないと一人あたりが総額と一致し、精算を確認できない |
| `GET /api/users` が `email` を返さない | 画面が要るのは表示名だけ。相手のメールアドレスを配る理由が無い。テストでレスポンス全文に `@` が無いことまで見る |
| ユーザー一覧の並び順をテストしない | `created_at` が同じミリ秒だと id（乱数）で決まる。順序を固定できないので集合として見る |
| 金額の検証を `getByText` でなく `rowWith` / `cardWith` で行う | 同じ金額・同じ支払者名が複数箇所に出る（`¥4,500` は「一人あたり」と送金行、`¥18,000` は「支払い状況」と「品目」）。`getByText` は複数一致して Playwright の strict mode で落ちる。行で絞れば対応関係まで一緒に確かめられる |
| `devices["iPhone 13"]` を展開せず、幅・タッチ・ブラウザを直に書く | プリセットは `defaultBrowserType: "webkit"` を持ち込む。入れているのは chromium だけなので、起動しようとして落ちる |
| `execSql` を `npx wrangler` でなく `node wrangler.js` で呼ぶ | Windows では `.cmd` を shell 無しで起動できず、shell 経由にすると SQL 内の空白・引用符・セミコロンが再解釈される。引数配列のまま渡せば起きない |
| `legacy/` を消してもパリティテストは残す | フィクスチャはコミット済みで、同値性の証拠として価値がある。再生成できなくなることをテストに書き残す |
| `docs/app-analysis.md` は消さない | 移行前の解析記録。Flask のコードとは別物で、なぜ今の仕様になったかの根拠になる |
| デプロイをエージェントが実行しない | 利用者のアカウント・課金・本番データに触れる。手順提示と検証にとどめる |

**Plan 3 では扱わないもの（設計書 §11「将来の拡張余地」）**

- 月次の負担割合を 50:50 以外にする
- 品目ごとの参加者指定
- 精算結果の共有（テキストコピー / URL 発行）
- カスタムドメインへの移行

**Plan 2 の `ui-inspector` 指摘のうち、見送ったまま残っているもの**

Task 6 のレビューで再度上がる可能性がある。上がったら判断する。

- 「品目を追加」直後に、未入力を責めるバナーが即座に出る（`submitted` 状態の追加が要る）
- スマホでソフトキーボードが「記録する」を隠す（フォーム位置の再設計が要る）
- `Toggle` に矢印キー移動と roving tabindex が無い
- カテゴリ別内訳の割合の合計が 100% にならないことがある（各カテゴリを独立に四捨五入しているため）
- `input:focus` が `:focus-visible` でないため、マウス操作でもリングが出る
