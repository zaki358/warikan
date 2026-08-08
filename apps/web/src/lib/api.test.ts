import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiGet, apiSend } from "./api.js";

const mockFetch = (status: number, body: unknown, contentType = "application/json") => {
  // fetch と同じ引数で宣言する。そうしないと spy.mock.calls の要素が空タプルになり、
  // 呼び出し引数を取り出せない。
  const spy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
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

  it("通信そのものが失敗しても ApiError になり、生の英語メッセージを見せない", async () => {
    // オフライン・DNS 失敗・接続中断では fetch 自体が TypeError で reject する。
    // 素通しすると UI に "Failed to fetch" が出るうえ、instanceof ApiError の分岐から漏れる。
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    const error = (await apiGet("/api/me").catch((e: unknown) => e)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe("NETWORK_ERROR");
    expect(error.status).toBe(0);
    expect(error.message).not.toContain("Failed to fetch");
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
