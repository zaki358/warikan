import { describe, expect, it } from "vitest";

import parityCases from "./__fixtures__/flask-parity.json";
import { calculateSettlement } from "./settlement.js";
import type { Participant } from "./types.js";

type ParityCase = {
  name: string;
  members: { name: string; paid: number }[];
  total: number;
  perPerson: number;
  transfers: { fromId: string; toId: string; amount: number }[];
};

const cases = parityCases as ParityCase[];

describe("Flask 実装とのパリティ", () => {
  it("フィクスチャが空でない", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases)("$name", (parityCase) => {
    // Flask はメンバーを名前で識別するため、id にも名前を使う
    const participants: Participant[] = parityCase.members.map((member) => ({
      id: member.name,
      name: member.name,
      paid: member.paid,
    }));

    const result = calculateSettlement(participants);

    expect(result.total).toBe(parityCase.total);
    expect(result.perPerson).toBe(parityCase.perPerson);
    expect(result.transfers).toEqual(parityCase.transfers);
  });
});
