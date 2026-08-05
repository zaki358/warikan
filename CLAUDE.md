# CLAUDE.md

このファイルは、このリポジトリでコードを扱う際に Claude Code (claude.ai/code) へガイダンスを提供するものです。

## 概要

割り勘 (warikan) — 小規模な単一ファイル構成の Flask アプリ。ビルドシステムやパッケージマニフェスト、テストスイートは存在せず、すべて [app.py](app.py) と `templates/` 配下の Jinja テンプレートに収まっている。

## アプリの起動方法

```bash
python app.py
```

Flask の開発用サーバーが `http://127.0.0.1:5000` で `debug=True` の状態で起動する。Windows では [start_warikan.bat](start_warikan.bat) を使うと、サーバー起動とブラウザでの URL オープンが自動で行われる。

実行中の Python 環境に Flask がインストールされている必要がある（`requirements.txt` は存在しないため、無ければ `pip install flask` でインストールすること）。

lint・フォーマット・テストのコマンドはこのプロジェクトには設定されていない。

## アーキテクチャ

すべての処理は [app.py](app.py) 内の単一の Flask アプリを経由する。3ステップのウィザード形式になっており、ステップ間の状態保持にはサーバーサイドの `session`（`app.secret_key` で署名される Cookie ベース）のみを使い、データベースは使用していない。

**ウィザードの流れ:** `/new` で session をクリアしてフローを開始する。
- `step1` — タイトル、メンバー数 `count`、`mode`（`"simple"` または品目ベース）を session に格納する。
- `step2` — `mode` に応じて `step2_simple.html` または `step2_items.html` を描画する。simple モードでは各メンバーの `paid` 金額を直接入力する。品目モードでは個々の明細（`item_name`/`item_amount`/`item_paid_by`）を入力し、メンバーごとの `paid` 合計に集計する。いずれの場合も本ステップで `members` を算出し `calculate_settlements()` を呼び出し、`total`・`per_person`・`settlements` を session に保存する。
- `step3` — 精算プラン（誰が誰にいくら払うか）を表示し、各精算項目の `paid` チェックボックスの切り替え、またはセッションのディスクへの保存を行える。

補足: `templates/step2.html` はどのルートからも参照されていない残存ファイルであり、実際に描画されるのは `step2_simple.html` と `step2_items.html` の方である。

**精算アルゴリズム**（[app.py](app.py:28) の `calculate_settlements`）: 各メンバーの収支（`paid` から平均 `per_person` を引いた値）を算出したうえで、金額の大きい順に並べた債権者と債務者を貪欲法でマッチングし、送金回数が最小になる精算リストを生成する。

**永続化:** 保存済みセッションは [data/sessions.json](data/sessions.json) にフラットな JSON 配列として保持され、`MAX_SESSIONS`（5件）を上限に新しい順で格納される。`_persist_session()` は、ユーザーが step3 で明示的に「保存」を押した場合（または `editing_id` を持つ既存の保存済みセッションで paid チェックボックスを切り替えた場合）にのみここへ書き込む。トップページ（`/`）は保存済みセッションの一覧を表示し、`/history/<id>` は該当セッションを現在の session に再ロードして閲覧・編集を再開できるようにし、`/history/<id>/delete` は削除を行う。

ウィザードの状態は完全に Flask の session Cookie に依存しているため、通常のフローを経ずに `/step2` や `/step3` を直接開いた場合の挙動は、その時点で session に何が入っているか次第であり、step1 が先に実行されたことをサーバー側で検証する仕組みはない。
