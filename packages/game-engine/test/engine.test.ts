import { describe, expect, it } from "vitest";
import { compareNumber, compareSet } from "../src/index.ts";

const a = { id: "a", name: "A", names: {} };
const b = { id: "b", name: "B", names: {} };
describe("numeric comparison", () => {
  it("reports exact and both directions with inclusive thresholds", () => {
    expect(compareNumber(1994, 1994, 3)).toEqual({ value: 1994, status: "exact", direction: null });
    expect(compareNumber(1994, 1997, 3)).toMatchObject({ status: "close", direction: "higher" });
    expect(compareNumber(142, 132, 10)).toMatchObject({ status: "close", direction: "lower" });
    expect(compareNumber(142, 131, 10)).toMatchObject({ status: "miss", direction: "lower" });
    expect(compareNumber(1994, 1998, 3)).toMatchObject({ status: "miss", direction: "higher" });
  });
});
it("compares sets by IDs, reports actual shared entities, never leaks target-only values", () => {
  expect(compareSet([a], [{ ...a, name: "localized" }]).status).toBe("exact");
  expect(compareSet([a, b], [a])).toEqual({ status: "partial", values: [a, b], matches: [a] });
  expect(compareSet([a], [a, b])).toEqual({ status: "partial", values: [a], matches: [a] });
  expect(compareSet([a], [b])).toEqual({ status: "miss", values: [a], matches: [] });
  expect(compareSet([a, a], [a]).status).toBe("exact");
});
