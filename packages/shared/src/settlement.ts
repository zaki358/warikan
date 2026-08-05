import type { Participant, SettlementResult, SharesResult, Transfer } from "./types.js";

/**
 * ロケールに依存しないコードユニット比較。
 * localeCompare は環境の ICU データで結果が変わり、端数の配分先がぶれる。
 */
export function compareStr(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function computeShares(participants: readonly Participant[]): SharesResult {
  const n = participants.length;
  if (n === 0) return { total: 0, perPerson: 0, shares: [] };

  const total = participants.reduce((sum, participant) => sum + participant.paid, 0);
  const base = Math.floor(total / n);
  const remainder = total - base * n;

  const extraIds = new Set(
    [...participants]
      .sort((a, b) => compareStr(a.name, b.name) || compareStr(a.id, b.id))
      .slice(0, remainder)
      .map((participant) => participant.id),
  );

  return {
    total,
    perPerson: base,
    shares: participants.map((participant) => ({
      id: participant.id,
      share: base + (extraIds.has(participant.id) ? 1 : 0),
    })),
  };
}

/**
 * 立て替えの過不足を、送金回数が最小になるように貪欲法で解消する。
 * すべて整数演算なので、送金額の合計と各人の過不足は厳密に一致する。
 */
export function calculateSettlement(participants: readonly Participant[]): SettlementResult {
  const { total, perPerson, shares } = computeShares(participants);
  const shareById = new Map(shares.map((share) => [share.id, share.share]));

  const balances = participants.map((participant) => ({
    id: participant.id,
    balance: participant.paid - (shareById.get(participant.id) ?? 0),
  }));

  const creditors = balances
    .filter((entry) => entry.balance > 0)
    .sort((a, b) => b.balance - a.balance || compareStr(a.id, b.id));
  const debtors = balances
    .filter((entry) => entry.balance < 0)
    .sort((a, b) => a.balance - b.balance || compareStr(a.id, b.id));

  const transfers: Transfer[] = [];
  let creditorIndex = 0;
  let debtorIndex = 0;
  let credit = creditors[0]?.balance ?? 0;
  let debt = -(debtors[0]?.balance ?? 0);

  while (creditorIndex < creditors.length && debtorIndex < debtors.length) {
    const amount = Math.min(credit, debt);
    transfers.push({
      fromId: debtors[debtorIndex]!.id,
      toId: creditors[creditorIndex]!.id,
      amount,
    });

    credit -= amount;
    debt -= amount;

    if (credit === 0) {
      creditorIndex += 1;
      credit = creditors[creditorIndex]?.balance ?? 0;
    }
    if (debt === 0) {
      debtorIndex += 1;
      debt = -(debtors[debtorIndex]?.balance ?? 0);
    }
  }

  return { total, perPerson, shares, transfers };
}
