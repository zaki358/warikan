import { describe, expect, it } from "vitest";

import {
  initialWizardState,
  toCreatePayload,
  wizardErrors,
  wizardReducer,
} from "./wizardReducer.js";
import type { WizardAction, WizardState } from "./wizardReducer.js";

const reduce = (state: WizardState, ...actions: Parameters<typeof wizardReducer>[1][]) =>
  actions.reduce(wizardReducer, state);

describe("initialWizardState", () => {
  it("2人ぶんの空メンバーから始まる", () => {
    const state = initialWizardState();

    expect(state.mode).toBe("simple");
    expect(state.members).toHaveLength(2);
    expect(state.members.every((member) => member.name === "")).toBe(true);
  });
});

describe("メンバーの増減", () => {
  it("追加できる", () => {
    const state = reduce(initialWizardState(), { type: "addMember" });

    expect(state.members).toHaveLength(3);
  });

  it("20人を超えて追加できない", () => {
    let state = initialWizardState();
    for (let i = 0; i < 30; i += 1) state = wizardReducer(state, { type: "addMember" });

    expect(state.members).toHaveLength(20);
  });

  it("削除できる", () => {
    const state = reduce(initialWizardState(), { type: "addMember" }, { type: "removeMember", index: 0 });

    expect(state.members).toHaveLength(2);
  });

  it("1人未満にはできない", () => {
    const state = reduce(
      initialWizardState(),
      { type: "removeMember", index: 0 },
      { type: "removeMember", index: 0 },
      { type: "removeMember", index: 0 },
    );

    expect(state.members).toHaveLength(1);
  });

  it("メンバーを消すと、その人が支払っていた品目の支払者が先頭に寄る", () => {
    let state = reduce(
      initialWizardState(),
      { type: "setMemberName", index: 0, name: "田中" },
      { type: "setMemberName", index: 1, name: "佐藤" },
      { type: "setMode", mode: "items" },
      { type: "addItem" },
      { type: "setItemPaidBy", index: 0, paidByIndex: 1 },
    );

    expect(state.items[0]?.paidByIndex).toBe(1);

    state = wizardReducer(state, { type: "removeMember", index: 1 });

    // 参照先が消えたら 0 に落とす。範囲外の index を送ると API が 400 を返すため。
    expect(state.items[0]?.paidByIndex).toBe(0);
  });

  // 支払者は配列の index で参照している。前のメンバーが消えると index が1つ前にずれるため、
  // 補正しないと品目の支払者が黙って別人にすり替わる（誰がいくら払ったかが狂う）。
  it("支払者より前のメンバーを消しても、品目の支払者は同じ人を指したままになる", () => {
    let state = reduce(
      initialWizardState(),
      { type: "setMemberName", index: 0, name: "田中" },
      { type: "setMemberName", index: 1, name: "佐藤" },
      { type: "addMember" },
      { type: "setMemberName", index: 2, name: "鈴木" },
      { type: "setMode", mode: "items" },
      { type: "addItem" },
      { type: "setItemPaidBy", index: 0, paidByIndex: 2 },
    );

    expect(state.members[state.items[0]!.paidByIndex]?.name).toBe("鈴木");

    state = wizardReducer(state, { type: "removeMember", index: 0 });

    expect(state.items[0]?.paidByIndex).toBe(1);
    expect(state.members[state.items[0]!.paidByIndex]?.name).toBe("鈴木");
  });

  it("支払者より後ろのメンバーを消しても、品目の支払者は動かない", () => {
    let state = reduce(
      initialWizardState(),
      { type: "setMemberName", index: 0, name: "田中" },
      { type: "setMemberName", index: 1, name: "佐藤" },
      { type: "addMember" },
      { type: "setMemberName", index: 2, name: "鈴木" },
      { type: "setMode", mode: "items" },
      { type: "addItem" },
      { type: "setItemPaidBy", index: 0, paidByIndex: 0 },
    );

    state = wizardReducer(state, { type: "removeMember", index: 2 });

    expect(state.items[0]?.paidByIndex).toBe(0);
    expect(state.members[state.items[0]!.paidByIndex]?.name).toBe("田中");
  });
});

describe("不変性", () => {
  const sample = (): WizardState =>
    reduce(
      initialWizardState(),
      { type: "setTitle", title: "旅行" },
      { type: "setMemberName", index: 0, name: "田中" },
      { type: "setMemberPaid", index: 0, paid: 3000 },
      { type: "setMemberName", index: 1, name: "佐藤" },
      { type: "addMember" },
      { type: "setMemberName", index: 2, name: "鈴木" },
      { type: "setMode", mode: "items" },
      { type: "addItem" },
      { type: "setItemName", index: 0, name: "宿代" },
      { type: "setItemAmount", index: 0, amount: 20000 },
      { type: "setItemPaidBy", index: 0, paidByIndex: 2 },
      { type: "addItem" },
    );

  // すべての action を1つずつ通す。新しい action を足したらここにも足すこと。
  const everyAction: WizardAction[] = [
    { type: "setTitle", title: "飲み会" },
    { type: "setMode", mode: "simple" },
    { type: "addMember" },
    { type: "removeMember", index: 0 },
    { type: "removeMember", index: 2 },
    { type: "setMemberName", index: 1, name: "山田" },
    { type: "setMemberPaid", index: 1, paid: 500 },
    { type: "addItem" },
    { type: "removeItem", index: 0 },
    { type: "setItemName", index: 0, name: "交通費" },
    { type: "setItemAmount", index: 0, amount: 800 },
    { type: "setItemPaidBy", index: 1, paidByIndex: 1 },
  ];

  /** 凍結すると push / splice / 要素への代入が TypeError で落ちる（ESM は strict mode）。 */
  const deepFreeze = <T>(value: T): T => {
    if (value !== null && typeof value === "object") {
      for (const inner of Object.values(value)) deepFreeze(inner);
      Object.freeze(value);
    }
    return value;
  };

  it.each(everyAction)("$type は引数の state を書き換えない", (action) => {
    const before = sample();
    const snapshot = structuredClone(before);

    wizardReducer(deepFreeze(before), action);

    expect(before).toEqual(snapshot);
  });

  it("同じ state と action からは常に同じ結果になる", () => {
    for (const action of everyAction) {
      const state = sample();

      expect(wizardReducer(state, action)).toEqual(wizardReducer(sample(), action));
    }
  });
});

describe("品目の編集", () => {
  it("追加と削除ができる", () => {
    let state = reduce(initialWizardState(), { type: "setMode", mode: "items" }, { type: "addItem" });
    expect(state.items).toHaveLength(1);

    state = wizardReducer(state, { type: "removeItem", index: 0 });
    expect(state.items).toHaveLength(0);
  });

  it("金額は整数のみ保持する", () => {
    const state = reduce(
      initialWizardState(),
      { type: "setMode", mode: "items" },
      { type: "addItem" },
      { type: "setItemAmount", index: 0, amount: 20000 },
    );

    expect(state.items[0]?.amount).toBe(20000);
  });
});

describe("wizardErrors", () => {
  it("名前が空なら弾く", () => {
    const state = initialWizardState();

    expect(wizardErrors(state)).toContain("参加者の名前を入力してください");
  });

  it("simple で全員の名前が入っていれば通る", () => {
    const state = reduce(
      initialWizardState(),
      { type: "setMemberName", index: 0, name: "田中" },
      { type: "setMemberName", index: 1, name: "佐藤" },
    );

    expect(wizardErrors(state)).toEqual([]);
  });

  it("items で品目が0件なら弾く", () => {
    const state = reduce(
      initialWizardState(),
      { type: "setMemberName", index: 0, name: "田中" },
      { type: "setMemberName", index: 1, name: "佐藤" },
      { type: "setMode", mode: "items" },
    );

    expect(wizardErrors(state)).toContain("品目を1件以上追加してください");
  });

  it("items で品目名が空なら弾く", () => {
    const state = reduce(
      initialWizardState(),
      { type: "setMemberName", index: 0, name: "田中" },
      { type: "setMemberName", index: 1, name: "佐藤" },
      { type: "setMode", mode: "items" },
      { type: "addItem" },
      { type: "setItemAmount", index: 0, amount: 100 },
    );

    expect(wizardErrors(state)).toContain("品目名を入力してください");
  });

  // 品目名の空欄は弾くのに金額の空欄を素通しすると、入れ忘れが ¥0 の品目として
  // 黙って登録される。合計が変わらないぶん気づきにくい。
  it("金額が未入力の品目があれば通さない", () => {
    const state = reduce(
      initialWizardState(),
      { type: "setMemberName", index: 0, name: "田中" },
      { type: "setMemberName", index: 1, name: "佐藤" },
      { type: "setMode", mode: "items" },
      { type: "addItem" },
      { type: "setItemName", index: 0, name: "宿代" },
    );

    expect(wizardErrors(state)).toContain("品目の金額を入力してください");
  });

  it("金額が 0 の品目は通す（0 円の記録は妨げない）", () => {
    const state = reduce(
      initialWizardState(),
      { type: "setMemberName", index: 0, name: "田中" },
      { type: "setMemberName", index: 1, name: "佐藤" },
      { type: "setMode", mode: "items" },
      { type: "addItem" },
      { type: "setItemName", index: 0, name: "宿代" },
      { type: "setItemAmount", index: 0, amount: 0 },
    );

    expect(wizardErrors(state)).toEqual([]);
  });

  it("同名の参加者がいても通る", () => {
    const state = reduce(
      initialWizardState(),
      { type: "setMemberName", index: 0, name: "田中" },
      { type: "setMemberName", index: 1, name: "田中" },
    );

    // 旧 Flask は名前でメンバーを識別していたため破綻したが、
    // 現行 API は id で識別するので許容する。
    expect(wizardErrors(state)).toEqual([]);
  });
});

describe("toCreatePayload", () => {
  it("simple は入力した paid をそのまま送る", () => {
    const state = reduce(
      initialWizardState(),
      { type: "setTitle", title: "飲み会" },
      { type: "setMemberName", index: 0, name: "田中" },
      { type: "setMemberPaid", index: 0, paid: 10000 },
      { type: "setMemberName", index: 1, name: "佐藤" },
      { type: "setMemberPaid", index: 1, paid: 2000 },
    );

    expect(toCreatePayload(state)).toEqual({
      title: "飲み会",
      mode: "simple",
      members: [
        { name: "田中", paid: 10000 },
        { name: "佐藤", paid: 2000 },
      ],
      items: [],
    });
  });

  it("items は paid を 0 にして品目を送る（サーバー側で合算される）", () => {
    const state = reduce(
      initialWizardState(),
      { type: "setMemberName", index: 0, name: "田中" },
      { type: "setMemberPaid", index: 0, paid: 999 },
      { type: "setMemberName", index: 1, name: "佐藤" },
      { type: "setMode", mode: "items" },
      { type: "addItem" },
      { type: "setItemName", index: 0, name: "宿代" },
      { type: "setItemAmount", index: 0, amount: 20000 },
    );

    expect(toCreatePayload(state)).toEqual({
      title: "",
      mode: "items",
      members: [
        { name: "田中", paid: 0 },
        { name: "佐藤", paid: 0 },
      ],
      items: [{ name: "宿代", amount: 20000, paidByIndex: 0 }],
    });
  });

  it("名前と品目名の前後の空白を落とす", () => {
    const state = reduce(
      initialWizardState(),
      { type: "setMemberName", index: 0, name: "  田中  " },
      { type: "setMemberName", index: 1, name: "佐藤" },
    );

    expect(toCreatePayload(state).members[0]?.name).toBe("田中");
  });

  it("未入力の金額は 0 として送る", () => {
    const state = reduce(
      initialWizardState(),
      { type: "setMemberName", index: 0, name: "田中" },
      { type: "setMemberName", index: 1, name: "佐藤" },
    );

    expect(toCreatePayload(state).members[1]?.paid).toBe(0);
  });
});
