import { describe, expect, it } from "vitest";

import { calculateSettlement, computeShares } from "./settlement.js";
import type { Participant } from "./types.js";

const p = (id: string, name: string, paid: number): Participant => ({ id, name, paid });

describe("computeShares", () => {
  it("割り切れるとき全員の負担額が等しい", () => {
    const result = computeShares([p("a", "A", 6000), p("b", "B", 3000), p("c", "C", 0)]);

    expect(result.total).toBe(9000);
    expect(result.perPerson).toBe(3000);
    expect(result.shares).toEqual([
      { id: "a", share: 3000 },
      { id: "b", share: 3000 },
      { id: "c", share: 3000 },
    ]);
  });

  it("端数は名前の昇順で先頭から1円ずつ配る", () => {
    const result = computeShares([p("a", "A", 1000), p("b", "B", 0), p("c", "C", 0)]);

    expect(result.total).toBe(1000);
    expect(result.perPerson).toBe(333);
    expect(result.shares).toEqual([
      { id: "a", share: 334 },
      { id: "b", share: 333 },
      { id: "c", share: 333 },
    ]);
  });

  it("端数配分は入力順ではなく名前順で決まる", () => {
    const result = computeShares([p("c", "C", 1000), p("a", "A", 0), p("b", "B", 0)]);

    // 入力順は C, A, B だが、+1 されるのは名前が最小の A
    expect(result.shares).toEqual([
      { id: "c", share: 333 },
      { id: "a", share: 334 },
      { id: "b", share: 333 },
    ]);
  });

  it("負担額の合計は常に total と一致する", () => {
    const result = computeShares([p("a", "A", 100), p("b", "B", 1), p("c", "C", 0)]);

    const sum = result.shares.reduce((acc, s) => acc + s.share, 0);
    expect(sum).toBe(result.total);
  });

  it("参加者が0人ならゼロを返す", () => {
    expect(computeShares([])).toEqual({ total: 0, perPerson: 0, shares: [] });
  });

  it("参加者が1人なら全額をその人が負担する", () => {
    expect(computeShares([p("a", "A", 500)])).toEqual({
      total: 500,
      perPerson: 500,
      shares: [{ id: "a", share: 500 }],
    });
  });

  it("同名の参加者がいても id で区別される", () => {
    const result = computeShares([p("a", "田中", 1000), p("b", "田中", 0)]);

    expect(result.shares).toEqual([
      { id: "a", share: 500 },
      { id: "b", share: 500 },
    ]);
  });
});

describe("calculateSettlement", () => {
  it("全員の支払いが同じなら送金は発生しない", () => {
    const result = calculateSettlement([p("a", "A", 3000), p("b", "B", 3000), p("c", "C", 3000)]);

    expect(result.transfers).toEqual([]);
  });

  it("2人なら差額の半分が1件の送金になる", () => {
    const result = calculateSettlement([p("a", "A", 10000), p("b", "B", 0)]);

    expect(result.total).toBe(10000);
    expect(result.perPerson).toBe(5000);
    expect(result.transfers).toEqual([{ fromId: "b", toId: "a", amount: 5000 }]);
  });

  it("端数があっても送金の合計が過不足と厳密に一致する", () => {
    const result = calculateSettlement([p("a", "A", 1000), p("b", "B", 0), p("c", "C", 0)]);

    // shares: a=334, b=333, c=333 → balances: a=+666, b=-333, c=-333
    expect(result.transfers).toEqual([
      { fromId: "b", toId: "a", amount: 333 },
      { fromId: "c", toId: "a", amount: 333 },
    ]);
  });

  it("債権者が複数いても送金回数は人数-1以下に収まる", () => {
    const result = calculateSettlement([
      p("a", "A", 8000),
      p("b", "B", 0),
      p("c", "C", 4000),
      p("d", "D", 0),
    ]);

    // total 12000, per 3000 → a=+5000, c=+1000, b=-3000, d=-3000
    expect(result.transfers).toEqual([
      { fromId: "b", toId: "a", amount: 3000 },
      { fromId: "d", toId: "a", amount: 2000 },
      { fromId: "d", toId: "c", amount: 1000 },
    ]);
    expect(result.transfers.length).toBeLessThanOrEqual(3);
  });

  it("送金額はすべて正の整数", () => {
    const result = calculateSettlement([p("a", "A", 100), p("b", "B", 1), p("c", "C", 0)]);

    for (const transfer of result.transfers) {
      expect(Number.isInteger(transfer.amount)).toBe(true);
      expect(transfer.amount).toBeGreaterThan(0);
    }
  });

  it("参加者が0人なら空の結果を返す", () => {
    expect(calculateSettlement([])).toEqual({
      total: 0,
      perPerson: 0,
      shares: [],
      transfers: [],
    });
  });

  it("参加者が1人なら送金は発生しない", () => {
    const result = calculateSettlement([p("a", "A", 500)]);

    expect(result.transfers).toEqual([]);
  });

  it("全員が0円なら送金は発生しない", () => {
    const result = calculateSettlement([p("a", "A", 0), p("b", "B", 0)]);

    expect(result.total).toBe(0);
    expect(result.transfers).toEqual([]);
  });
});
