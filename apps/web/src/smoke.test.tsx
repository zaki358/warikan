import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { App } from "./App.js";

describe("App", () => {
  it("見出しが描画される", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "割り勘" })).toBeInTheDocument();
  });
});
