import type { CreateEventPayload, EventMode } from "../../lib/types.js";

const MAX_MEMBERS = 20;
const MIN_MEMBERS = 1;

export type MemberDraft = { name: string; paid: number | "" };
export type ItemDraft = { name: string; amount: number | ""; paidByIndex: number };

export type WizardState = {
  title: string;
  mode: EventMode;
  members: MemberDraft[];
  items: ItemDraft[];
};

export type WizardAction =
  | { type: "setTitle"; title: string }
  | { type: "setMode"; mode: EventMode }
  | { type: "addMember" }
  | { type: "removeMember"; index: number }
  | { type: "setMemberName"; index: number; name: string }
  | { type: "setMemberPaid"; index: number; paid: number | "" }
  | { type: "addItem" }
  | { type: "removeItem"; index: number }
  | { type: "setItemName"; index: number; name: string }
  | { type: "setItemAmount"; index: number; amount: number | "" }
  | { type: "setItemPaidBy"; index: number; paidByIndex: number };

const emptyMember = (): MemberDraft => ({ name: "", paid: "" });

export const initialWizardState = (): WizardState => ({
  title: "",
  mode: "simple",
  members: [emptyMember(), emptyMember()],
  items: [],
});

/** 配列の1要素だけを差し替えた新しい配列を返す。元の配列は変更しない。 */
const replaceAt = <T>(list: T[], index: number, next: T): T[] =>
  list.map((item, position) => (position === index ? next : item));

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "setTitle":
      return { ...state, title: action.title };

    case "setMode":
      return { ...state, mode: action.mode };

    case "addMember":
      return state.members.length >= MAX_MEMBERS
        ? state
        : { ...state, members: [...state.members, emptyMember()] };

    case "removeMember": {
      if (state.members.length <= MIN_MEMBERS) return state;

      const members = state.members.filter((_, position) => position !== action.index);
      // 支払者の参照がずれる。消えた人を指していたら先頭に寄せ、
      // 後ろを指していたら1つ手前にずらす。範囲外を送ると API が 400 になる。
      const items = state.items.map((item) => {
        if (item.paidByIndex === action.index) return { ...item, paidByIndex: 0 };
        if (item.paidByIndex > action.index) return { ...item, paidByIndex: item.paidByIndex - 1 };
        return item;
      });

      return { ...state, members, items };
    }

    case "setMemberName": {
      const target = state.members[action.index];
      if (!target) return state;
      return { ...state, members: replaceAt(state.members, action.index, { ...target, name: action.name }) };
    }

    case "setMemberPaid": {
      const target = state.members[action.index];
      if (!target) return state;
      return { ...state, members: replaceAt(state.members, action.index, { ...target, paid: action.paid }) };
    }

    case "addItem":
      return { ...state, items: [...state.items, { name: "", amount: "", paidByIndex: 0 }] };

    case "removeItem":
      return { ...state, items: state.items.filter((_, position) => position !== action.index) };

    case "setItemName": {
      const target = state.items[action.index];
      if (!target) return state;
      return { ...state, items: replaceAt(state.items, action.index, { ...target, name: action.name }) };
    }

    case "setItemAmount": {
      const target = state.items[action.index];
      if (!target) return state;
      return { ...state, items: replaceAt(state.items, action.index, { ...target, amount: action.amount }) };
    }

    case "setItemPaidBy": {
      const target = state.items[action.index];
      if (!target) return state;
      return {
        ...state,
        items: replaceAt(state.items, action.index, { ...target, paidByIndex: action.paidByIndex }),
      };
    }

    default:
      return state;
  }
}

/** 送信前に人が読めるエラーを返す。空配列なら送信してよい。 */
export function wizardErrors(state: WizardState): string[] {
  const errors: string[] = [];

  if (state.members.some((member) => member.name.trim().length === 0)) {
    errors.push("参加者の名前を入力してください");
  }

  if (state.mode === "items") {
    if (state.items.length === 0) {
      errors.push("品目を1件以上追加してください");
    }
    if (state.items.some((item) => item.name.trim().length === 0)) {
      errors.push("品目名を入力してください");
    }
    // 未入力（""）は 0 として送られるため、弾かないと入れ忘れが ¥0 の品目として
    // 黙って登録される。合計が変わらないぶん気づきにくい。0 の明示的な入力は通す。
    if (state.items.some((item) => item.amount === "")) {
      errors.push("品目の金額を入力してください");
    }
  }

  return errors;
}

export function toCreatePayload(state: WizardState): CreateEventPayload {
  const isItems = state.mode === "items";

  return {
    title: state.title.trim(),
    mode: state.mode,
    members: state.members.map((member) => ({
      name: member.name.trim(),
      // 品目モードでは支払額を品目から再計算するため、送信値は 0 にする。
      paid: isItems ? 0 : member.paid === "" ? 0 : member.paid,
    })),
    items: isItems
      ? state.items.map((item) => ({
          name: item.name.trim(),
          amount: item.amount === "" ? 0 : item.amount,
          paidByIndex: item.paidByIndex,
        }))
      : [],
  };
}
