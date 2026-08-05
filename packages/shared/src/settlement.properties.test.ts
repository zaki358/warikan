import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { calculateSettlement } from "./settlement.js";
import type { Participant } from "./types.js";

const participantsArb = fc.uniqueArray(
  fc.record({
    id: fc.string({ minLength: 1, maxLength: 8 }),
    name: fc.string({ minLength: 1, maxLength: 8 }),
    paid: fc.integer({ min: 0, max: 1_000_000 }),
  }),
  { minLength: 1, maxLength: 20, selector: (participant) => participant.id },
);

const received = (transfers: readonly { toId: string; amount: number }[], id: string): number =>
  transfers.filter((t) => t.toId === id).reduce((sum, t) => sum + t.amount, 0);

const sent = (transfers: readonly { fromId: string; amount: number }[], id: string): number =>
  transfers.filter((t) => t.fromId === id).reduce((sum, t) => sum + t.amount, 0);

describe("calculateSettlement の性質", () => {
  it("負担額の合計は支払額の合計と一致する", () => {
    fc.assert(
      fc.property(participantsArb, (participants: Participant[]) => {
        const result = calculateSettlement(participants);
        const shareSum = result.shares.reduce((sum, share) => sum + share.share, 0);
        const paidSum = participants.reduce((sum, participant) => sum + participant.paid, 0);

        expect(shareSum).toBe(paidSum);
        expect(result.total).toBe(paidSum);
      }),
    );
  });

  it("各人の受取と支払の差は、その人の過不足と一致する", () => {
    fc.assert(
      fc.property(participantsArb, (participants: Participant[]) => {
        const result = calculateSettlement(participants);
        const shareById = new Map(result.shares.map((share) => [share.id, share.share]));

        for (const participant of participants) {
          const balance = participant.paid - shareById.get(participant.id)!;
          const net = received(result.transfers, participant.id) - sent(result.transfers, participant.id);

          expect(net).toBe(balance);
        }
      }),
    );
  });

  it("送金回数は参加者数-1以下", () => {
    fc.assert(
      fc.property(participantsArb, (participants: Participant[]) => {
        const result = calculateSettlement(participants);

        expect(result.transfers.length).toBeLessThanOrEqual(Math.max(0, participants.length - 1));
      }),
    );
  });

  it("送金額はすべて正の整数", () => {
    fc.assert(
      fc.property(participantsArb, (participants: Participant[]) => {
        const result = calculateSettlement(participants);

        for (const transfer of result.transfers) {
          expect(Number.isInteger(transfer.amount)).toBe(true);
          expect(transfer.amount).toBeGreaterThan(0);
        }
      }),
    );
  });

  it("自分から自分への送金は発生しない", () => {
    fc.assert(
      fc.property(participantsArb, (participants: Participant[]) => {
        const result = calculateSettlement(participants);

        for (const transfer of result.transfers) {
          expect(transfer.fromId).not.toBe(transfer.toId);
        }
      }),
    );
  });

  it("負担額は perPerson か perPerson+1 のいずれか", () => {
    fc.assert(
      fc.property(participantsArb, (participants: Participant[]) => {
        const result = calculateSettlement(participants);

        for (const share of result.shares) {
          expect([result.perPerson, result.perPerson + 1]).toContain(share.share);
        }
      }),
    );
  });

  it("同じ入力からは常に同じ結果が出る", () => {
    fc.assert(
      fc.property(participantsArb, (participants: Participant[]) => {
        expect(calculateSettlement(participants)).toEqual(calculateSettlement(participants));
      }),
    );
  });
});
