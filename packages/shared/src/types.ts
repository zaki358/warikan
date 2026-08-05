/** 割り勘の参加者。paid は整数（円）。 */
export type Participant = {
  id: string;
  name: string;
  paid: number;
};

/** 各参加者が負担すべき額。端数配分を含む。 */
export type Share = {
  id: string;
  share: number;
};

/** 1件の送金。 */
export type Transfer = {
  fromId: string;
  toId: string;
  amount: number;
};

export type SharesResult = {
  total: number;
  perPerson: number;
  shares: Share[];
};

export type SettlementResult = SharesResult & {
  transfers: Transfer[];
};
