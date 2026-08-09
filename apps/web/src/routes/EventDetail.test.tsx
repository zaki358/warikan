import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EventDetail as EventDetailType } from "../lib/types.js";
import { EventDetail } from "./EventDetail.js";

/**
 * ここで固定したいのは3点。
 *
 * 1. 送金は最大19件（参加者20人）並ぶ。消し込みボタンの名前が全行同じだと、
 *    利用者も読み上げも自動テストも行を区別できず、並べ替えや取り違えの
 *    不具合を誰も検知できない（月次と同じ轍。Task 8 の所見2を参照）。
 * 2. 消し込みは配列の位置ではなく `settlement.id` で指す。単発の API は
 *    `PATCH /api/events/:id/settlements/:settlementId`。
 * 3. 参加者名は重複しうる（reducer 側にも同名のテストがある）。名前が同じでも
 *    行を指し分けられること。
 */

/**
 * 同名の参加者を2組入れてある。s1 と s2 は「田中 から 佐藤 への ¥3,000」で
 * 名前も金額も完全に一致するため、行番号を持たないラベルでは区別できない。
 */
const detail = (): EventDetailType => ({
  id: "e1",
  title: "沖縄旅行",
  mode: "items",
  total: 24000,
  perPerson: 4000,
  createdAt: "2026-08-03T00:00:00.000Z",
  members: [
    { id: "m1", name: "田中", paid: 1000 },
    { id: "m2", name: "佐藤", paid: 10000 },
    { id: "m3", name: "田中", paid: 1000 },
    { id: "m4", name: "佐藤", paid: 10000 },
    { id: "m5", name: "鈴木", paid: 2500 },
    { id: "m6", name: "高橋", paid: 4000 },
  ],
  items: [{ id: "i1", name: "宿代", amount: 20000, paidByMemberId: "m2" }],
  settlements: [
    { id: "s1", fromMemberId: "m1", toMemberId: "m2", amount: 3000, isPaid: false },
    { id: "s2", fromMemberId: "m3", toMemberId: "m4", amount: 3000, isPaid: false },
    { id: "s3", fromMemberId: "m5", toMemberId: "m2", amount: 1500, isPaid: true },
  ],
});

/** fetch のシグネチャ付きで宣言する。引数ゼロだと mock.calls[0] が空タプルになる。 */
const stubFetch = (respond: (input: RequestInfo | URL, init?: RequestInit) => unknown) => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const data = respond(input, init);
    return { status: 200, json: async () => ({ ok: true, data }) } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const renderDetail = (data: EventDetailType = detail()) => {
  const fetchMock = stubFetch(() => data);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/events/e1"]}>
        <Routes>
          <Route path="/events/:id" element={<EventDetail />} />
          <Route path="/" element={<h1>割り勘</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return fetchMock;
};

const patchCalls = (fetchMock: ReturnType<typeof stubFetch>) =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("EventDetail", () => {
  it("送金が3件並んでも、消し込みボタンを名前で一意に指せる", async () => {
    renderDetail();

    // 1件目と2件目は「誰から誰へ何円」がまったく同じ。行番号が無いと区別できない。
    expect(
      await screen.findByRole("button", { name: "1. 田中 から 佐藤 への ¥3,000を支払い済みにする" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "2. 田中 から 佐藤 への ¥3,000を支払い済みにする" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "3. 鈴木 から 佐藤 への ¥1,500を未払いに戻す" }),
    ).toBeInTheDocument();
  });

  it("消し込みは配列の位置ではなく settlement.id で送る", async () => {
    const user = userEvent.setup();
    const fetchMock = renderDetail();

    await user.click(
      await screen.findByRole("button", { name: "2. 田中 から 佐藤 への ¥3,000を支払い済みにする" }),
    );

    const [path, init] = patchCalls(fetchMock)[0] ?? [];
    expect(path).toBe("/api/events/e1/settlements/s2");
    expect(JSON.parse(String(init?.body))).toEqual({ isPaid: true });
  });

  it("支払い済みの送金は未払いに戻せる", async () => {
    const user = userEvent.setup();
    const fetchMock = renderDetail();

    await user.click(
      await screen.findByRole("button", { name: "3. 鈴木 から 佐藤 への ¥1,500を未払いに戻す" }),
    );

    const [path, init] = patchCalls(fetchMock)[0] ?? [];
    expect(path).toBe("/api/events/e1/settlements/s3");
    expect(JSON.parse(String(init?.body))).toEqual({ isPaid: false });
  });

  it("同名の参加者がいても支払い状況の行を区別できる", async () => {
    renderDetail();

    const heading = await screen.findByRole("heading", { name: "支払い状況" });
    const card = within(heading.closest(".card") as HTMLElement);

    // 入力画面（SimpleInput）の「1. 田中」と同じ並び・同じ番号で読める。
    expect(card.getByText("1. 田中")).toBeInTheDocument();
    expect(card.getByText("3. 田中")).toBeInTheDocument();
    expect(card.getByText("2. 佐藤")).toBeInTheDocument();
  });

  it("品目の支払者も番号つきで出す（同名でも誰の支払いか分かる）", async () => {
    renderDetail();

    const heading = await screen.findByRole("heading", { name: "品目" });
    const card = within(heading.closest(".card") as HTMLElement);

    expect(card.getByText("宿代")).toBeInTheDocument();
    expect(card.getByText("2. 佐藤")).toBeInTheDocument();
  });

  it("精算が不要なら送金の行を出さない", async () => {
    renderDetail({ ...detail(), settlements: [] });

    expect(await screen.findByText("精算は不要です")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /支払い済みにする/ })).not.toBeInTheDocument();
  });

  it("確認をキャンセルしたら削除しない", async () => {
    const user = userEvent.setup();
    const fetchMock = renderDetail();
    vi.spyOn(window, "confirm").mockReturnValue(false);

    await user.click(await screen.findByRole("button", { name: "削除する" }));

    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  });

  it("確認したら削除してホームへ戻る", async () => {
    const user = userEvent.setup();
    const fetchMock = renderDetail();
    vi.spyOn(window, "confirm").mockReturnValue(true);

    await user.click(await screen.findByRole("button", { name: "削除する" }));

    expect(await screen.findByRole("heading", { name: "割り勘" })).toBeInTheDocument();
    const [path, init] = fetchMock.mock.calls.find(([, given]) => given?.method === "DELETE") ?? [];
    expect(path).toBe("/api/events/e1");
    expect(init?.method).toBe("DELETE");
  });
});
