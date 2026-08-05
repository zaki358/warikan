import { describe, expect, it } from "vitest";

import { PACKAGE_NAME } from "./index.js";

describe("shared package", () => {
  it("公開エントリからエクスポートを読める", () => {
    expect(PACKAGE_NAME).toBe("@warikan/shared");
  });
});
