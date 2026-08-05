import type { Participant, SharesResult } from "./types.js";

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
