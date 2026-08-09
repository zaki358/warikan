import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WizardState } from "../features/events/wizardReducer.js";
import { EventInput } from "./EventInput.js";

/**
 * ここで固定したいのは3点。
 *
 * 1. 送信を止めた理由を**画面に出す**こと。ボタンを無効にするだけだと、
 *    利用者はなぜ進めないのか分からないまま詰まる。
 * 2. 連打で POST が2回飛ばないこと。イベントが二重に作られる。
 * 3. 成功したら結果画面へ進み、ウィザードを片付けること。
 */

const simpleState = (): WizardState => ({
  title: "沖縄旅行",
  mode: "simple",
  members: [
    { name: "あや", paid: 12000 },
    { name: "ぼぶ", paid: "" },
  ],
  items: [],
});

const itemsStateMissingAmount = (): WizardState => ({
  title: "沖縄旅行",
  mode: "items",
  members: [
    { name: "あや", paid: "" },
    { name: "ぼぶ", paid: "" },
  ],
  items: [{ name: "宿代", amount: "", paidByIndex: 0 }],
});

const createdEvent = { id: "event-1", title: "沖縄旅行" };

const renderInput = (state: WizardState, onCreated = vi.fn()) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/events/new/input"]}>
        <Routes>
          <Route
            path="/events/new/input"
            element={<EventInput state={state} dispatch={vi.fn()} onCreated={onCreated} />}
          />
          <Route path="/events/:id" element={<h1>精算結果</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return { onCreated };
};

/** fetch のシグネチャ付きで宣言する。引数ゼロだと mock.calls[0] が空タプルになる。 */
const stubFetch = (respond: () => Promise<Response>) => {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => respond());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const okResponse = () =>
  Promise.resolve({ status: 201, json: async () => ({ ok: true, data: createdEvent }) } as unknown as Response);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("EventInput", () => {
  it("金額を入れ忘れた品目があると、送信できない理由を画面に出す", () => {
    stubFetch(okResponse);
    renderInput(itemsStateMissingAmount());

    expect(screen.getByText("品目の金額を入力してください")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "計算する" })).toBeDisabled();
  });

  it("入力が揃っていれば理由は出ず、送信できる", () => {
    stubFetch(okResponse);
    renderInput(simpleState());

    expect(screen.queryByText("品目の金額を入力してください")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "計算する" })).toBeEnabled();
  });

  it("連打しても POST は1回だけ", async () => {
    const user = userEvent.setup();
    // 応答を保留し、送信中の状態を維持する。
    let release: (() => void) | undefined;
    const fetchMock = stubFetch(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve({ status: 201, json: async () => ({ ok: true, data: createdEvent }) } as unknown as Response);
        }),
    );

    renderInput(simpleState());

    const button = screen.getByRole("button", { name: "計算する" });
    await user.click(button);
    await user.click(screen.getByRole("button", { name: "計算中…" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "計算中…" })).toBeDisabled();

    release?.();
    await screen.findByRole("heading", { name: "精算結果" });
  });

  it("作成できたら結果画面へ進み、ウィザードを片付ける", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(okResponse);
    const { onCreated } = renderInput(simpleState());

    await user.click(screen.getByRole("button", { name: "計算する" }));

    expect(await screen.findByRole("heading", { name: "精算結果" })).toBeInTheDocument();
    expect(onCreated).toHaveBeenCalledTimes(1);

    const [path, init] = fetchMock.mock.calls[0] ?? [];
    expect(path).toBe("/api/events");
    expect(JSON.parse(String(init?.body))).toEqual({
      title: "沖縄旅行",
      mode: "simple",
      members: [
        { name: "あや", paid: 12000 },
        { name: "ぼぶ", paid: 0 },
      ],
      items: [],
    });
  });
});
