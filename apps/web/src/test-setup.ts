import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import "@testing-library/jest-dom/vitest";

// Testing Library の自動クリーンアップは、グローバルな `afterEach` が存在するときだけ
// 登録される（`@testing-library/react` が `typeof afterEach === "function"` で判定している）。
// vitest.config.ts は `globals: false` なのでこれが登録されず、描画した DOM が body に
// 積み上がって getByRole が「複数見つかった」で落ちる。
// 各テストファイルで書くと必ず忘れるので、ここで一度だけ登録する。
afterEach(cleanup);
