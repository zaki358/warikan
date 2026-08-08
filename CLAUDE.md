# CLAUDE.md

このファイルは、このリポジトリでコードを扱う際に Claude Code (claude.ai/code) へガイダンスを提供するものです。

## 概要

割り勘 (warikan) — 夫婦2人で使う割り勘アプリ。

> **注意:** このリポジトリは Cloudflare Workers + D1 + React への移行作業中です。
> `legacy/` 配下は移行前の Flask 実装で、パリティ確認のために残しています。
> 新規の作業は `apps/` と `packages/` で行ってください。
>
> - 設計書: [docs/superpowers/specs/2026-08-05-warikan-cloudflare-design.md](docs/superpowers/specs/2026-08-05-warikan-cloudflare-design.md)
> - 実装計画: [docs/superpowers/plans/](docs/superpowers/plans/)

## ディレクトリ構成

| パス | 内容 |
|---|---|
| `packages/shared` | 精算ロジック（純関数）と共通の型。DB にも HTTP にも依存しない |
| `apps/api` | Hono の API（Cloudflare Workers + D1） |
| `apps/web` | React + Vite のフロントエンド（Plan 2 で作成） |
| `legacy` | 移行前の Flask 実装。パリティ確認用で、移行完了後に削除する |
| `docs/superpowers/specs` | 設計書 |
| `docs/superpowers/plans` | 実装計画 |
| `.claude/agents` | プロジェクト固有のサブエージェント |

## 開発コマンド

```bash
npm install
```

```bash
cp apps/api/.dev.vars.example apps/api/.dev.vars
```

```bash
npm run migrate:local -w @warikan/api
```

```bash
npm run dev -w @warikan/api
```

`http://localhost:8787` で立つ。`npm test` で全テスト（`packages/shared` と `apps/api`）、`npm run typecheck` で型チェック。

`.dev.vars` の `DEV_BYPASS_EMAIL` は Access の JWT 検証を飛ばすだけで、`ACCESS_ALLOWED_EMAILS` の許可リストは常に効く。

**`wrangler dev` の停止に注意**: Ctrl+C やプロセス終了だけでは子の `workerd` が残り、親が生きていると再生成される。停止するときは `wrangler.js` → `wrangler-dist/cli.js` → `workerd` のツリーを親から順に落とす。このマシンでは別プロジェクト（`kakei-dashboard-3`）の `wrangler dev` も同じポート 8787 で常駐しているため、PID をコマンドラインとパスで確認してから落とすこと。`workerd` を名前だけで一括終了しない。

カバレッジは v8 プロバイダが workerd 上で動かない（`node:inspector/promises` を解決できない）。計測するときは `@vitest/coverage-istanbul` を入れて `--coverage.provider=istanbul` を使う。

**`vitest` では静的配信を検証できない**: `@cloudflare/vitest-pool-workers` は `wrangler.jsonc` の `assets` を読み込むが Asset Worker を再現しない。テスト内では `/` も `/monthly/2026-08` も Hono の 404 になる。`run_worker_first` を壊しても全テストが通ってしまうため、`assets` の振り分けを変えたときは `wrangler dev` を起動して手で確認すること（`run_worker_first: ["/api/*"]` を外すと `/api/health` が SPA の HTML を返し API が全滅する）。

## 移行の要点

**認証**: Cloudflare Access で `warikan.y-kakeibo.workers.dev` を保護し、許可メール2件のみ通す。Worker 側は `Cf-Access-Jwt-Assertion` の JWT を JWKS で検証してからメールを取り出す。`Cf-Access-Authenticated-User-Email` ヘッダは Access を経由しないリクエストで詐称できるため信用しない。

**割り勘の3モード**:

| モード | 参加者 | 内容 |
|---|---|---|
| シンプル | 任意人数（1〜20） | 参加者ごとに立て替えた金額を直接入力 |
| 品目別 | 任意人数（1〜20） | 品目・金額・支払者を記録し、支払者ごとに合算 |
| 月次 | 登録済みの2人固定 | 支払いの都度記録し、月末に集計して精算 |

いずれも均等割り。月次は 50:50 固定。

**精算アルゴリズム**: 合計を人数で割った負担額を各人から引いて過不足を出し、債権者と債務者を金額の大きい順に貪欲マッチングする。送金回数は最大で「人数 − 1」回。**すべて整数（円）で計算する**ため、送金額の合計と各人の過不足は厳密に一致する。端数は名前のコードユニット昇順で先頭から1円ずつ配る。

**月次の締め**: 「計算」で精算結果をスナップショット保存し `status='settled'` にする。支出の編集はその後も自由で、確定済み期間の支出が変わると `is_dirty=1` が立ち、画面に再計算を促す警告が出る。

## コーディング上の制約

- 金額はすべて整数（円）。浮動小数点を金額計算に使わない
- 文字列比較は `localeCompare` を使わず、コードユニット比較（`compareStr`）で行う。ロケール差で結果が変わらないようにするため
- D1 は対話的トランザクション非対応。複数文を原子的に実行する箇所は `env.DB.batch([...])` を使う
- メールアドレスをソース・マイグレーション・テストフィクスチャに実在の値で書かない。テストは `me@example.com` / `partner@example.com` を使う
- API レスポンスは共通エンベロープ `{ ok: true, data }` / `{ ok: false, error: { code, message, fields? } }`
- ファイルは1つの責務に絞る。200〜400行を目安、800行を上限とする

## サブエージェント

`.claude/agents/` に2つ。どちらも Playwright MCP（`.mcp.json` で宣言）を使う。

| エージェント | 用途 |
|---|---|
| `ui-inspector` | スマホ／タブレット／PC 幅でレイアウトを検査し報告する。**コードは修正しない** |
| `web-debugger` | ブラウザで再現する不具合を追跡し、原因を特定して修正する |

## legacy/ の Flask 実装について

移行前の実装。`legacy/app.py` の `calculate_settlements()` は、TS 実装との同値性検証（パリティテスト）の参照元として使う。

起動するには:

```bash
python legacy/app.py
```

`http://127.0.0.1:5000` で `debug=True` の開発サーバーが立つ。debug モードはリローダーが親子2プロセスで動くため、停止時は両方落とすこと。Flask がインストールされている必要がある（`requirements.txt` は無い）。

現行 Flask 実装の詳細な解析は [docs/app-analysis.md](docs/app-analysis.md) にある。移行で修正する既知の問題（メンバーを名前で識別、端数の丸め誤差、履歴5件上限、ウィザード状態の Cookie 依存）もそこに記載されている。
