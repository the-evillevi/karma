// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parsePesos } from "./money.ts";

describe("parsePesos", () => {
  it("reads what a cashier types into integer centavos", () => {
    expect(parsePesos("150")).toBe(15000);
    expect(parsePesos("150.5")).toBe(15050);
    expect(parsePesos("150.50")).toBe(15050);
    expect(parsePesos(" $1,250.00 ")).toBe(125000);
    expect(parsePesos("0")).toBe(0);
    expect(parsePesos("0.07")).toBe(7);
    expect(parsePesos("37")).toBe(3700);
  });

  it("returns null for anything that is not a peso amount", () => {
    for (const text of [
      "",
      " ",
      "abc",
      "-5",
      "1.234",
      "1.",
      ".5",
      "1e3",
      "12 3",
    ]) {
      expect(parsePesos(text)).toBeNull();
    }
  });
});
