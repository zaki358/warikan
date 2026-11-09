# 割り勘 (warikan) — プログラムの動作順番

> [program-flow.html](program-flow.html) の Markdown 版（GitHub 上で読むためのもの）。

URL を開いてから画面に金額が出るまで、そして「計算する」を押してから精算結果が保存されるまで、**どのファイルが・どの順番で・どこで**動くのかを追った文書。
技術の一覧は [技術構成ドキュメント](tech-stack.md) 側にある。各プログラムの役割を確認したいときは [全体構成図](architecture-overview.md) へ。

| 表記 | 意味 |
|---|---|
| **[ブラウザ]** | あなたのスマホ / PC の中で動く |
| **[Access]** | Cloudflare の認証の関所 |
| **[Worker]** | Cloudflare のサーバー上で動く |
| **[shared]** | 精算ロジック（純関数） |
| **[D1]** | データベース |

## 目次

1. [まず全体像 — プログラムは3か所で動く](#overview)
2. [① 初回アクセス — index.html が出るまで、その後データが出るまで](#boot)
3. [② 単発の割り勘 — 入力してから計算が走るまで](#event)
4. [③ 月次 — 記録して、締めて、あとから直す](#monthly)
5. [精算アルゴリズムが動く順番](#algo)
6. [どのファイルがいつ動くか（一覧）](#when)
7. [開発中と本番で順番が変わるところ](#devprod)
8. [用語のちいさな辞書](#glossary)

<a id="overview"></a>

## 1. まず全体像 — プログラムは3か所で動く

「アプリ」と言っても1本のプログラムが上から下へ流れるわけではない。**別々の場所で動く3つのプログラムが、HTTP で会話しながら進む**。順番を追うときは、いま自分がどこの話をしているかを常に意識するとよい。

| | ① 画面（ブラウザの中） | ② API（Cloudflare の Worker の中） | ③ 精算ロジック（②から呼ばれる） |
|---|---|---|---|
| 場所 | `apps/web/src/**` | `apps/api/src/**` | `packages/shared/src/settlement.ts` |
| 内容 | React の SPA。ボタンを押す・文字を打つといった操作を受け、必要になったらサーバーへ聞きに行く。 | Hono のサーバー。認証を確かめ、入力を検証し、計算し、D1 に読み書きして JSON を返す。 | 「誰が誰にいくら払うか」を決める純関数。DB も HTTP も知らない。入力を渡すと答えを返すだけ。 |
| 主なファイル | 入口: `main.tsx`<br>画面の振り分け: `App.tsx`<br>通信: `lib/api.ts` | 入口: `index.ts`<br>関所: `middleware/auth.ts`<br>SQL: `db/*.ts` | `computeShares`<br>`calculateSettlement` |

> [!NOTE]
> **覚えておくと迷わない一点**
> ①と②は**同じ 1 つの Worker から配信される**。画面の HTML も API も `https://warikan.y-kakeibo.workers.dev` という同じ住所から返ってくる。`/api/` で始まる URL だけ ② が処理し、それ以外は ① の SPA が返る。振り分けているのは `apps/api/wrangler.jsonc` の `run_worker_first: ["/api/*"]` という 1 行。

```text
          あなた
            │  URL を開く / ボタンを押す
            ▼
   ┌─────────────────────┐
   │  Cloudflare Access  │  許可メール2件だけ通す。通ったリクエストに JWT を貼る
   └─────────────────────┘
            │
            ▼
   ┌──────────────────────────────────────────────┐
   │            Worker（1つだけ）                  │
   │                                              │
   │  URL が /api/* か？                           │
   │    ├─ はい → Hono（②）→ 精算ロジック（③）    │
   │    │                   └→ D1（SQLite）        │
   │    └─ いいえ → Asset Worker                   │
   │                 → apps/web/dist の index.html │
   └──────────────────────────────────────────────┘
```

<a id="boot"></a>

## 2. ① 初回アクセス — index.html が出るまで、その後データが出るまで

ここがいちばん質問の多いところ。**「HTML が出る」と「数字が出る」は別の往復**で、画面は先に出て、データはあとから届いて差し替わる。

### 前半 — 画面の骨格が出るまで（1往復目）

1. **[ブラウザ] URL を開く**
   `https://warikan.y-kakeibo.workers.dev/` にリクエストが飛ぶ。この時点ではまだ自分のコードは 1 行も動いていない。

2. **[Access] 関所で止められる**
   Cloudflare Access がリクエストを横取りする。未ログインならログイン画面が出て、許可された 2 件のメール以外はここで終わり。通過すると、以降のリクエストに `Cf-Access-Jwt-Assertion` という署名付きのヘッダが自動で貼られる。

3. **[Worker] URL を見て振り分ける**
   `/` は `/api/*` に一致しないので、Hono は呼ばれない。Cloudflare の Asset Worker が `apps/web/dist/index.html` を返す。`/monthly/2026-08` のようなアプリ内の URL を直接開いても、`not_found_handling: "single-page-application"` の指定によって同じ `index.html` が返る。

4. **[ブラウザ] index.html を読む**
   中身はほとんど空で、実質この 2 行しかない。`#root` は**空の箱**で、画面はまだ何も無い。

   ```html
   <div id="root"></div>
   <script type="module" src="/assets/index-xxxxxxxx.js"></script>
   ```

   （元のソースは `apps/web/index.html` の `src="/src/main.tsx"`。`npm run build -w @warikan/web` のときに Vite がハッシュ付きの JS へ書き換える）

5. **[ブラウザ] JS を取りに行く（Worker がまた返す）**
   この JS も `/api/*` ではないので Asset Worker が `dist` から返す。ここまでで往復 2 回。

6. **[ブラウザ] main.tsx — ここが自分のコードの本当の 1 行目**
   `apps/web/src/main.tsx` が上から順に走る。

   ```text
   1. QueryClient を作る（サーバーから取った値の置き場。staleTime: 0 ＝ 古い金額を見せない）
   2. document.getElementById("root") で箱を掴む（無ければ即 throw）
   3. createRoot(root).render(...) で React を起動する
        StrictMode
          └ QueryClientProvider   ← 以降どこからでもキャッシュを触れるようにする
              └ BrowserRouter     ← URL を React に見せる
                  └ App           ← ここから下が画面
   ```

7. **[ブラウザ] App.tsx — URL を見て画面を1つ選ぶ**
   `useReducer` でウィザードの下書き状態を用意し、`<Routes>` が今の URL と各 `<Route>` を突き合わせる。`/` なら `Home`、`/monthly/2026-08` なら `MonthlyRecord`、知らない URL なら `/` へ飛ばす。

8. **[ブラウザ] Home.tsx — 画面が描かれる（ただし数字はまだ空）**
   `useMonthly(todayYm())` と `useEvents()` を呼ぶ。この2行が「サーバーに聞いてきて」という**注文**で、待たずに先へ進む。だから最初の一瞬はカードの枠と「読み込み中…」だけが表示される。

### 後半 — 数字が届くまで（3往復目以降。ここで初めて API が動く）

1. **[ブラウザ] TanStack Query — キャッシュに無ければ取りに行く**
   `queryKeys.monthly("2026-08")` ＝ `["monthly","2026-08"]` という鍵で置き場を見る。初回は空なので `queryFn` を実行 → `apiGet("/api/monthly/2026-08")`。

2. **[ブラウザ] lib/api.ts — fetch を投げる**
   URL は必ず**相対パス**で書く（`/api/...`）。同じ住所なので、Access が貼った JWT も自動で付いていく。通信そのものが失敗したときは、英語の `Failed to fetch` を素通ししないで `ApiError("NETWORK_ERROR", …, status 0)` に包み直す。

3. **[Worker] index.ts — 今度は Hono が呼ばれる**
   URL が `/api/*` なので `run_worker_first` により Worker が先に処理する。`apps/api/src/index.ts` の登録順がそのまま実行順になる。

   ```text
   app.onError(onError)                  ← 例外の受け皿を先に張る
   app.get("/api/health", …)             ← 認証の前に置く（監視用。ここだけ素通し）
   app.use("/api/*", accessAuth())       ← 以降すべてこの関所を通る
   app.route("/api/me",         meRoutes)
   app.route("/api/users",      userRoutes)
   app.route("/api/categories", categoryRoutes)
   app.route("/api/monthly",    monthlyRoutes)   ← 今回はこれ
   app.route("/api/events",     eventRoutes)
   ```

4. **[Worker] middleware/auth.ts — 本人確認（毎リクエスト）**
   `Cf-Access-Jwt-Assertion` の JWT を JWKS で**署名検証**し、そこから初めてメールを取り出す。`Cf-Access-Authenticated-User-Email` ヘッダは Access を経由しない経路で詐称できるので使わない。取り出したメールを許可リストと照合し、`users` に行が無ければ作り、`c.set("user", …)` に載せてから `next()` で先へ渡す。
   *ローカル開発では `DEV_BYPASS_EMAIL` があると JWT 検証だけ飛ばす（許可リストの照合は常に効く）。*

5. **[Worker] routes/monthly.ts — 該当のハンドラが動く**
   `GET /:ym` が選ばれる。`parseYm("2026-08")` で形式を確かめ（駄目なら 400）、`getOrCreatePeriod` → `listExpenses` の順に `db/monthly.ts` を呼ぶ。

6. **[D1] SQL が走る**
   `db/*.ts` だけが SQL を書く場所。ルータは SQL を直接書かない。その月の `monthly_periods` の行が無ければ `INSERT … ON CONFLICT DO NOTHING` で作ってから読み直す。

7. **[Worker] lib/response.ts — 決まった封筒に入れて返す**
   成功も失敗も形を揃える。この形は全エンドポイント共通。

   ```text
   成功: { "ok": true,  "data": { "period": {…}, "expenses": [ … ] } }
   失敗: { "ok": false, "error": { "code": "VALIDATION_ERROR", "message": "…" } }
   ```

8. **[ブラウザ] lib/api.ts — 封筒を開ける**
   `ok: true` なら `data` だけを取り出して返す。`ok: false` なら `ApiError` を投げる。画面側は `data` の中身だけを見ればよくなる。

9. **[ブラウザ] React — 数字が入って描き直される**
   `useQuery` が値を持ったことで `Home` が再描画され、「読み込み中…」が実際の金額に変わる。**ここで初めて画面が完成する。**

> [!NOTE]
> **2回目以降は前半が丸ごと省かれる**
> 画面内のリンクを押しても、ブラウザはページを読み直さない。`BrowserRouter` が URL だけを書き換え、`App` の `<Routes>` が別のコンポーネントに差し替える。つまり `main.tsx` が走るのは**最初の1回だけ**で、以降は「後半」の API 往復だけが繰り返される。F5 を押すと前半からやり直しになる。

<a id="event"></a>

## 3. ② 単発の割り勘 — 入力してから計算が走るまで

「入力するとこのプログラムが起動する」の実際。**入力中はサーバーと一切通信しない**。通信するのは最後に「計算する」を押した 1 回だけで、割り勘の計算はそこでサーバー側が行う。

1. **[ブラウザ] EventNew.tsx — ステップ1 — タイトル・モード・参加者**
   文字を打つたびに `dispatch({ type: "setMemberName", … })` が呼ばれる。受けるのは `features/events/wizardReducer.ts`。**元の状態は書き換えず、変更を反映した新しいオブジェクトを返す**ので、React はそれを見て描き直す。ここまでネットワークは 0 回。

2. **[ブラウザ] App.tsx — 下書きの置き場は App が持っている**
   ウィザードの途中状態は `App` の `useReducer` にあり、`EventNew` / `EventInput` へ props で渡される。だからステップ間を行き来しても入力が消えない。（旧 Flask 版は Cookie に載せていて別タブで壊れた。その依存を無くした形）

3. **[ブラウザ] EventInput.tsx — ステップ2 — 金額 or 品目**
   モードによって `SimpleInput`（参加者ごとの立替額）か `ItemsInput`（品目・金額・支払者）が描かれる。画面が変わっただけで、まだ通信していない。

4. **[ブラウザ] wizardReducer.ts — 送る前の下調べ**
   `wizardErrors(state)` が名前の空欄や品目の金額未入力を人が読める文言で返す。1件でもあればボタンは `disabled` のままで、押しても `submit` は即 return する。

5. **[ブラウザ]「計算する」を押す — ここで初めてサーバーへ**
   `toCreatePayload(state)` が画面用の下書きを API の形に変換する（品目モードでは `paid` を 0 で送り、サーバー側で品目から積み直す）。続いて `createEvent.mutate(payload)` → `apiSend("POST", "/api/events", payload)`。

6. **[Worker] middleware/auth.ts → routes/events.ts — 関所を通ってハンドラへ**
   `eventRoutes.post("/")` が受け取り、**まず zod で検証し直す**。画面の検証は親切のためのもので、サーバーは受け取った JSON を信用しない（人数 1〜20、名前 30 字、金額は 0 以上 1,000 万以下の整数、品目 200 件まで）。

7. **[Worker] routes/events.ts — 参加者に id を振る**
   `newId()`（＝ `crypto.randomUUID()`）で全員に id を付ける。以降は名前ではなく id で識別するので、同名の参加者が2人いても破綻しない。品目モードなら、ここで品目の金額を支払者ごとに合算して各人の `paid` を組み立てる。

8. **[shared] packages/shared — 割り勘の計算本体が走る**
   `calculateSettlement(participants)` を呼ぶ。ここが「このプログラムが起動する」瞬間で、誰が誰にいくら送るかが決まる（詳しい順番は[次章](#algo)）。**この関数は D1 も HTTP も知らない**ので、単体でテストできる。

9. **[D1] db/events.ts — まとめて保存する**
   イベント本体・参加者・品目・送金の 4 種類を `env.DB.batch([...])` で**一括で**書く。D1 は対話的トランザクションを持たないため、複数文を原子的に実行したい箇所は必ず `batch` を使う。

10. **[Worker] → ブラウザ — 作った内容を丸ごと返す**
    `{ ok: true, data: { id, title, total, perPerson, members, items, settlements } }`。

11. **[ブラウザ] features/events/queries.ts — 成功後の後片付け**
    `onSuccess` で `invalidateQueries(queryKeys.events())`。**手元のキャッシュを書き換えるのではなく「この鍵の値は古い」と印を付ける**だけで、次にホームを開いたときサーバーから取り直される。金額を扱うので楽観更新はしない。

12. **[ブラウザ] EventInput.tsx → EventDetail.tsx — 結果画面へ**
    `onCreated()` でウィザードを `reset`（次回に前の入力を持ち越さない）してから `navigate("/events/" + event.id)`。移った先の `EventDetail` が `useEvent(id)` を呼び、`GET /api/events/:id` でもう一往復して確定した内容を表示する。

> [!NOTE]
> **なぜ計算をブラウザでやらないのか**
> 保存する数字と画面に出す数字を必ず一致させるため。計算をサーバーの1か所に寄せておけば、「表示は合っているが DB の値が違う」という食い違いが原理的に起きない。ブラウザ側の計算は、合計を足すといった**表示のためだけの足し算**に限っている。

<a id="monthly"></a>

## 4. ③ 月次 — 記録して、締めて、あとから直す

単発と違い、月次は「その都度記録 → 月末に締める」という2段構え。締めたあとの編集も許すぶん、順番が少し込み入る。

### 4-1. 画面を開く — 4本の問い合わせが同時に走る

`MonthlyRecord` は `useMe()` / `useUsers()` / `useCategories()` / `useMonthly(ym)` を並べて呼ぶ。これらは**順番待ちをせず同時に**飛び、届いたものから画面に入る。`users` と `categories` は滅多に変わらないので `staleTime: 5分`、金額を含む `monthly` は 0 秒。

### 4-2. 支出を1件足す

```text
ExpenseForm で入力 → onSubmit
  → useAddExpense(ym).mutate(input)                   [ブラウザ]
  → POST /api/monthly/2026-08/expenses                [通信]
  → accessAuth → monthlyRoutes.post("/:ym/expenses")  [Worker]
      ├ zod で形を検証（金額は整数、itemName は 60 字まで…）
      ├ spentOnInPeriod() でその日付が本当にその月に在るか（2月31日を弾く）
      ├ validateRefs() で支払者とカテゴリが実在するかを D1 に問い合わせ
      ├ getOrCreatePeriod() でその月の期間行を用意
      └ insertExpense() → env.DB.batch([ INSERT 支出, 期間を is_dirty=1 にする ])
  → { ok: true, data: 支出 } を 201 で返す
  → onSuccess: monthly(ym) と monthlyResult(ym) を invalidate      [ブラウザ]
  → 印の付いたクエリが自動で再取得され、一覧と合計が更新される
```

`is_dirty` を立てる UPDATE を同じ `batch` に入れているのが要点。支出だけ入って「確定済みなのに印が付いていない」という中途半端な状態を作らない。なお `markDirtyStatement` の SQL には `AND status = 'settled'` が付いていて、まだ締めていない月では何も起きない。

### 4-3. 締める（「計算する」）

```text
MonthlyResult の「計算する」→ useSettle(ym).mutate()
  → POST /api/monthly/2026-08/settle
  → monthlyRoutes.post("/:ym/settle")
      ├ readSnapshot(period)   … 前回の結果があれば読む
      ├ buildSnapshot(db, period)                       [services/settle.ts]
      │    ├ listUsers / listExpenses / listActiveCategories を Promise.all で同時に取得
      │    ├ 支払者ごとに合算して participants を組む
      │    ├ calculateSettlement(participants)          [packages/shared] ← 計算本体
      │    └ カテゴリ別の内訳を金額の降順（同額は名前順）で並べる
      ├ mergeIsPaid(次, 前) … from/to/金額が完全一致する送金だけ「支払済み」を引き継ぐ
      └ saveSnapshot() → snapshot_json に保存し status='settled', is_dirty=0
  → 結果をそのまま返す → invalidate → 画面に反映
```

結果は表示のたびに計算し直すのではなく、**その時点の答えを JSON で焼き付けて保存する**（スナップショット）。「渡した/渡していない」のチェックはこの JSON の中の `isPaid` を書き換えるだけなので、`status` や `is_dirty` は動かず、無効化するのも `monthlyResult(ym)` だけで済む。

### 4-4. 締めたあとに支出を直したとき

編集・削除も 4-2 と同じく `batch` の中で `is_dirty=1` を立てる。次にホームや精算画面を開くと `isDirty` が `true` で返り、「計算後に記録が変わっています」という警告が出る。**保存済みのスナップショット自体は勝手に書き換えない** — もう一度「計算する」を押すまで、前の答えがそのまま残る。

<a id="algo"></a>

## 5. 精算アルゴリズムが動く順番

`packages/shared/src/settlement.ts`。単発でも月次でも、最終的にここへ来る。**全部が整数（円）の計算**で、浮動小数点は一切使わない。

1. **合計を出す** — `total = Σ 各人の立て替え額`
2. **1人あたりの基本負担を出す** — `base = floor(total / 人数)` — 切り捨てるので、ここで端数が余る。
3. **余った端数を配る** — `remainder = total − base × 人数`。この端数を、**名前のコードユニット昇順（同名なら id 順）で先頭から1円ずつ**配る。`localeCompare` を使わないのは、環境の ICU データ次第で並び順が変わり、誰に 1 円が乗るかがぶれてしまうため。
4. **過不足を出す** — `balance = 立て替え額 − 負担額`。正なら受け取る側（債権者）、負なら払う側（債務者）。
5. **大きい順に突き合わせる** — 債権者は多い順、債務者は不足の大きい順に並べ、先頭どうしを `min(受取残, 支払残)` で消していく。片方が 0 になったら次の人へ進む。毎回どちらかが必ず 0 になるので、**送金回数は最大でも「人数 − 1」回**。

### 具体例 — 3人、A だけが 1,000 円払った場合

```text
入力   A=1000, B=0, C=0
1.  total     = 1000
2.  base      = floor(1000 / 3) = 333
3.  remainder = 1000 - 333×3 = 1   → 名前順の先頭 A に +1
        負担額  A=334, B=333, C=333   （合計 1000 ぴったり）
4.  balance   A=1000-334=+666,  B=-333,  C=-333
5.  債権者 [A:666]、債務者 [B:333, C:333]
        B → A  333
        C → A  333
    送金は 2 回（= 3人 − 1）。合計 666 は A の過剰分と厳密に一致する。
```

浮動小数点だと 333.33… の丸めで合計がずれ、「全員払ったのに 1 円合わない」が起きる。それを避けるため、金額はすべて整数で持ち、DB のカラムも `INTEGER` にしている。

<a id="when"></a>

## 6. どのファイルがいつ動くか（一覧）

| ファイル | 動く場所 | 動くタイミング |
|---|---|---|
| `apps/web/index.html` | ブラウザ | 最初の1回。ビルド後は `dist/index.html` が配信される |
| `apps/web/src/main.tsx` | ブラウザ | 最初の1回だけ。以降の画面遷移では再実行されない |
| `apps/web/src/App.tsx` | ブラウザ | URL が変わるたび。どの画面を出すかを決める |
| `routes/*.tsx` | ブラウザ | その URL に入ったとき、および状態が変わるたび再描画 |
| `features/*/queries.ts` | ブラウザ | 画面が「必要だ」と宣言したとき。キャッシュに無効の印が付いたときも再実行 |
| `lib/api.ts` | ブラウザ | サーバーへ実際に出ていく直前と、返事を受けた直後 |
| `apps/api/wrangler.jsonc` | Cloudflare | 全リクエストの最初。`/api/*` を Worker に回すか SPA を返すかの分岐 |
| `apps/api/src/index.ts` | Worker | `/api/*` のリクエストごと。登録順がそのまま実行順 |
| `middleware/auth.ts` | Worker | `/api/health` 以外のすべてのリクエストで、ハンドラより先に |
| `routes/*.ts`（API） | Worker | メソッドとパスが一致したとき |
| `services/settle.ts` | Worker | 月次の締め（`POST /api/monthly/:ym/settle`）のとき |
| `packages/shared/settlement.ts` | Worker | イベント作成時と月次の締め時。純関数なので単体でテストできる |
| `db/*.ts` | Worker → D1 | ルータやサービスから呼ばれたとき。SQL を書くのはここだけ |
| `migrations/*.sql` | D1 | アプリ実行中は動かない。`npm run migrate:*` のときだけ |

<a id="devprod"></a>

## 7. 開発中と本番で順番が変わるところ

同じコードでも、手元で動かすときは配信の経路が違う。ここを混同すると「本番だけ壊れる」種類の事故になる。

| | 画面（HTML / JS） | API（`/api/*`） | 認証 |
|---|---|---|---|
| **本番** | Worker の Asset Worker が `apps/web/dist` を返す | 同じ Worker の Hono | Cloudflare Access の JWT を JWKS で検証 |
| **`npm run dev -w @warikan/web`**<br>（Vite、5173番） | Vite が `src` から直接返す。保存すると即反映 | Vite の proxy が `localhost:8787` の Worker へ転送 | `.dev.vars` の `DEV_BYPASS_EMAIL` で JWT 検証だけ飛ばす |
| **`npm run dev -w @warikan/api`**<br>（wrangler、8787番） | ビルド済みの `dist` を返す。**ビルドし忘れると古い画面が出る** | 同じ Worker の Hono（本番と同じ経路） | 同上 |

画面の見た目を最終確認するときは、必ず `npm run build -w @warikan/web` を先に走らせてから `wrangler dev` を見ること。Vite の dev サーバーだけでは、`assets` の振り分け（`run_worker_first`）が正しいかどうかを確かめられない。

> [!WARNING]
> **テストでは確かめられない順番がある**
> `vitest` は Asset Worker を再現しないため、`/` も `/monthly/2026-08` も Hono の 404 になる。つまり第1章の「URL を見て振り分ける」を壊してもテストは全部通ってしまう。ここだけは `wrangler dev` を起動して手で確かめるしかない。

<a id="glossary"></a>

## 8. 用語のちいさな辞書

| 言葉 | この文書での意味 |
|---|---|
| **SPA** | HTML は1枚だけ読み込み、以降の画面切り替えを JavaScript で行う作り。ページ全体の再読み込みが起きない |
| **Asset Worker** | Cloudflare 側の仕組み。`dist` に置いた静的ファイルを返す係。自分のコードではない |
| **ミドルウェア** | ハンドラの前に必ず通る処理。ここでは `accessAuth`。`next()` を呼ぶと先へ進む |
| **ハンドラ** | URL とメソッドの組に対応する処理本体。`monthlyRoutes.get("/:ym", …)` の第2引数 |
| **フック** | `use` で始まる関数。React の描画の中から状態や通信を扱うための入口 |
| **invalidate** | キャッシュに「この値は古い」と印を付けること。消すのでも上書きするのでもなく、次に必要になったとき取り直させる |
| **エンベロープ** | API の返事を包む共通の形 `{ ok, data }` / `{ ok, error }`。呼ぶ側の分岐を1か所に集められる |
| **スナップショット** | 締めた時点の精算結果を JSON にして保存したもの。`monthly_periods.snapshot_json` |
| **batch** | 複数の SQL をまとめて原子的に実行する D1 の仕組み。途中まで書けてしまう事態を防ぐ |
| **純関数** | 同じ入力なら必ず同じ出力を返し、外の世界に触れない関数。`calculateSettlement` がそれ |

---

割り勘 (warikan) — プログラムの動作順番 / 生成日 2026-08-21
関連: [全体構成図](architecture-overview.md)、[技術構成ドキュメント](tech-stack.md)、`CLAUDE.md`、`docs/superpowers/specs/`（設計書）
