import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Settings } from "./Settings.js";

/**
 * 設定画面の要点は2つ。
 *
 * 1. 2人分の入力欄が、それぞれ現在の表示名を初期値として並ぶこと。
 * 2. 保存が「その行の人」の id に飛ぶこと。id を取り違えると、相手の
 *    名前を編集したつもりが自分の行を書き換えてしまう。
 */

const users = [
  { userId: "u1", displayName: "わたし" },
  { userId: "u2", displayName: "つれあい" },
];

const envelope = (data: unknown) =>
  ({ status: 200, json: async () => ({ ok: true, data }) }) as unknown as Response;

const errorEnvelope = (status: number, code: string, message: string) =>
  ({ status, json: async () => ({ ok: false, error: { code, message } }) }) as unknown as Response;

const renderSettings = (fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) => {
  const fetchMock = vi.fn(fetchImpl);
  vi.stubGlobal("fetch", fetchMock);

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/settings"]}>
        <Settings />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return fetchMock;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("設定画面", () => {
  it("2人分の入力欄が現在の表示名で並ぶ", async () => {
    renderSettings(async () => envelope(users));

    const mine = await screen.findByLabelText("わたし の表示名");
    const partner = await screen.findByLabelText("つれあい の表示名");

    expect(mine).toHaveValue("わたし");
    expect(partner).toHaveValue("つれあい");
  });

  it("片方を書き換えて保存すると、その人の id に PATCH が飛ぶ", async () => {
    const user = userEvent.setup();
    const fetchMock = renderSettings(async (input, init) => {
      const url = String(input);
      if (init?.method === "PATCH") return envelope({ userId: "u2", displayName: "妻" });
      return envelope(users);
    });

    const partnerInput = await screen.findByLabelText("つれあい の表示名");
    await user.clear(partnerInput);
    await user.type(partnerInput, "妻");
    await user.click(screen.getByRole("button", { name: "つれあい の表示名を保存" }));

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
      expect(patchCall).toBeDefined();
      const [url, init] = patchCall!;
      expect(String(url)).toBe("/api/users/u2");
      expect(JSON.parse(String(init?.body))).toEqual({ displayName: "妻" });
    });

    // 自分の行は触っていない。
    const mineCalls = fetchMock.mock.calls.filter(
      ([url, init]) => String(url) === "/api/users/u1" && init?.method === "PATCH",
    );
    expect(mineCalls).toHaveLength(0);
  });

  it("未変更・空白のみでは保存ボタンが押せない", async () => {
    const user = userEvent.setup();
    renderSettings(async () => envelope(users));

    const mineButton = await screen.findByRole("button", { name: "わたし の表示名を保存" });
    expect(mineButton).toBeDisabled();

    const mineInput = screen.getByLabelText("わたし の表示名");
    await user.clear(mineInput);
    await user.type(mineInput, "   ");
    expect(mineButton).toBeDisabled();
  });

  it("API がエラーを返すとバナーが出る", async () => {
    const user = userEvent.setup();
    renderSettings(async (input, init) => {
      if (init?.method === "PATCH") {
        return errorEnvelope(400, "VALIDATION_ERROR", "表示名は1〜20文字で入力してください");
      }
      return envelope(users);
    });

    const mineInput = await screen.findByLabelText("わたし の表示名");
    await user.clear(mineInput);
    await user.type(mineInput, "新しい名前");
    await user.click(screen.getByRole("button", { name: "わたし の表示名を保存" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("表示名は1〜20文字で入力してください");
  });
});
