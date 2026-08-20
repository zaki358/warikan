import { beforeEach, describe, expect, it } from "vitest";

import {
  ALLOWED_EMAIL,
  PARTNER_EMAIL,
  anonFetch,
  authedFetch,
  jsonBody,
  jsonInit,
  resetDb,
} from "./helpers.js";

type UserSummary = { userId: string; displayName: string };
type Envelope<T> = { ok: boolean; data?: T; error?: { code: string } };

/** 認証を1回通すと、その email の users 行が無ければ作られる（middleware/auth.ts）。 */
const signIn = (email: string) => authedFetch("/api/me", {}, email);

// 見えない文字。ソースに生で置くと読めず、grep も効かないのでコードポイントから作る。
/** RLO: 以降の文字列を右から左へ表示させる（表示の入れ替えに使える）。 */
const RLO = String.fromCharCode(0x202e);
/** ゼロ幅スペース。貼り付けたテキストに紛れ込みやすい。 */
const ZWSP = String.fromCharCode(0x200b);

/** 一覧から表示名で1人引く。id は乱数なのでテスト側で決め打ちできない。 */
const findByName = async (displayName: string): Promise<UserSummary> => {
  const body = await jsonBody<Envelope<UserSummary[]>>(await authedFetch("/api/users"));
  const found = body.data?.find((user) => user.displayName === displayName);
  if (!found) throw new Error(`${displayName} が見つかりません`);
  return found;
};

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

describe("PATCH /api/users/:id", () => {
  beforeEach(async () => {
    await resetDb();
    await signIn(ALLOWED_EMAIL);
    await signIn(PARTNER_EMAIL);
  });

  it("相手の表示名を変更でき、一覧に反映される", async () => {
    const partner = await findByName("partner");

    const res = await authedFetch(
      `/api/users/${partner.userId}`,
      jsonInit("PATCH", { displayName: "つれあい" }),
    );
    const body = await jsonBody<Envelope<UserSummary>>(res);

    expect(res.status).toBe(200);
    expect(body.data).toEqual({ userId: partner.userId, displayName: "つれあい" });

    // 変えたのは相手だけ。自分の表示名は巻き添えにしない。
    const after = await jsonBody<Envelope<UserSummary[]>>(await authedFetch("/api/users"));
    expect(after.data?.map((user) => user.displayName).sort()).toEqual(["me", "つれあい"]);
  });

  it("自分自身の id でも表示名を変更できる", async () => {
    // 設定画面は自分の行も PATCH /api/me ではなくこの口を使う。
    // 相手と経路は同じだが、実際に使われる側が通ることを固定しておく。
    const me = await findByName("me");

    const res = await authedFetch(
      `/api/users/${me.userId}`,
      jsonInit("PATCH", { displayName: "わたし" }),
    );
    const body = await jsonBody<Envelope<UserSummary>>(res);

    expect(res.status).toBe(200);
    expect(body.data).toEqual({ userId: me.userId, displayName: "わたし" });

    const after = await jsonBody<Envelope<UserSummary[]>>(await authedFetch("/api/users"));
    expect(after.data?.map((user) => user.displayName).sort()).toEqual(["partner", "わたし"]);
  });

  it("前後の空白を落として保存する", async () => {
    const partner = await findByName("partner");

    await authedFetch(`/api/users/${partner.userId}`, jsonInit("PATCH", { displayName: "  妻  " }));

    const found = await findByName("妻");
    expect(found.userId).toBe(partner.userId);
  });

  it("ゼロ幅文字・双方向制御文字を落として保存する", async () => {
    // trim() は空白しか落とさない。貼り付けたテキストに紛れた見えない文字が
    // そのまま入ると、名前が壊れて見えたり読み上げが狂ったりする。
    const partner = await findByName("partner");

    await authedFetch(
      `/api/users/${partner.userId}`,
      jsonInit("PATCH", { displayName: `${RLO}妻${ZWSP}` }),
    );

    const found = await findByName("妻");
    expect(found.userId).toBe(partner.userId);
  });

  it("見えない文字だけの表示名は 400", async () => {
    const partner = await findByName("partner");

    const res = await authedFetch(
      `/api/users/${partner.userId}`,
      jsonInit("PATCH", { displayName: ZWSP + ZWSP }),
    );
    const body = await jsonBody<Envelope<UserSummary>>(res);

    expect(res.status).toBe(400);
    expect(body.error?.code).toBe("VALIDATION_ERROR");
  });

  it("空白だけの表示名は 400", async () => {
    const partner = await findByName("partner");

    const res = await authedFetch(
      `/api/users/${partner.userId}`,
      jsonInit("PATCH", { displayName: "   " }),
    );
    const body = await jsonBody<Envelope<UserSummary>>(res);

    expect(res.status).toBe(400);
    expect(body.error?.code).toBe("VALIDATION_ERROR");
  });

  it("21文字以上の表示名は 400", async () => {
    const partner = await findByName("partner");

    const res = await authedFetch(
      `/api/users/${partner.userId}`,
      jsonInit("PATCH", { displayName: "あ".repeat(21) }),
    );

    expect(res.status).toBe(400);
  });

  it("存在しない id は 404", async () => {
    // UPDATE は対象行が無くてもエラーにならない。ガードが無いと 200 を返して
    // 何も起きず、画面には「保存できた」ように見えてしまう。
    const res = await authedFetch(
      "/api/users/00000000-0000-4000-8000-000000000000",
      jsonInit("PATCH", { displayName: "誰か" }),
    );
    const body = await jsonBody<Envelope<UserSummary>>(res);

    expect(res.status).toBe(404);
    expect(body.error?.code).toBe("NOT_FOUND");
  });

  it("email を返さない", async () => {
    const partner = await findByName("partner");

    const res = await authedFetch(
      `/api/users/${partner.userId}`,
      jsonInit("PATCH", { displayName: "つれあい" }),
    );
    const raw = await res.text();

    expect(raw).not.toContain("@");
    expect(raw).not.toContain("email");
  });

  it("認証を通らないと 403", async () => {
    const partner = await findByName("partner");

    const res = await anonFetch(
      `/api/users/${partner.userId}`,
      jsonInit("PATCH", { displayName: "つれあい" }),
    );
    const body = await jsonBody<Envelope<UserSummary>>(res);

    expect(res.status).toBe(403);
    expect(body.error?.code).toBe("FORBIDDEN");

    // 403 で止まっていること（DB に届いていないこと）を実際に確かめる。
    const after = await findByName("partner");
    expect(after.userId).toBe(partner.userId);
  });
});
