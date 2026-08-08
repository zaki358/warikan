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

```bash
npm install
```

```bash
cp apps/api/.dev.vars.example apps/api/.dev.vars
```

```bash
npm run migrate:local -w @warikan/api
```

## 開発

ローカルで API を起動する（http://localhost:8787）:

```bash
npm run dev -w @warikan/api
```

フロントエンドを開発する（http://localhost:5173、`/api` はローカルの Worker に転送される）:

```bash
npm run dev -w @warikan/web
```

このとき、別のターミナルで API も起動しておく:

```bash
npm run dev -w @warikan/api
```

本番と同じ構成（単一 Worker が画面と API の両方を返す）で確認する:

```bash
npm run build -w @warikan/web
npm run dev -w @warikan/api
```

全テストと型チェック:

```bash
npm test
```

```bash
npm run typecheck
```

## 割り勘のモード

| モード | 内容 |
|---|---|
| シンプル | 参加者ごとに立て替えた金額を直接入力する |
| 品目別 | 品目・金額・支払者を記録し、支払者ごとに合算する |
| 月次 | 支払いの都度記録し、月末に集計して精算する（登録済みの2人専用） |

いずれも均等割りで、送金回数が最小になるように精算する。金額はすべて整数（円）で計算するため、送金額の合計と各人の過不足は厳密に一致する。

## API

すべて `{ ok: true, data }` または `{ ok: false, error: { code, message, fields? } }` のエンベロープを返す。`/api/health` 以外は Cloudflare Access の認証を必要とする。

| メソッド | パス | 内容 |
|---|---|---|
| `GET` | `/api/health` | 疎通確認（認証不要） |
| `GET` `/` `PATCH` | `/api/me` | 自分の情報 / 表示名の変更 |
| `GET` | `/api/categories` | 有効なカテゴリ一覧 |
| `GET` | `/api/monthly` | 月次の期間一覧 |
| `GET` | `/api/monthly/:ym` | 期間と支出（無ければ暗黙作成） |
| `POST` | `/api/monthly/:ym/expenses` | 支出の追加 |
| `PATCH` `/` `DELETE` | `/api/monthly/expenses/:id` | 支出の更新 / 削除 |
| `POST` | `/api/monthly/:ym/settle` | 集計してスナップショットを保存 |
| `GET` | `/api/monthly/:ym/result` | 精算結果と `isDirty` |
| `PATCH` | `/api/monthly/:ym/result/transfers/:index` | 支払い済みの切り替え |
| `GET` `/` `POST` | `/api/events` | 単発割り勘の一覧 / 作成 |
| `GET` `/` `DELETE` | `/api/events/:id` | 単発割り勘の詳細 / 削除 |
| `PATCH` | `/api/events/:id/settlements/:settlementId` | 支払い済みの切り替え |
