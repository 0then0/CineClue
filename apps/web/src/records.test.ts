import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readRecords, saveRecord } from "./records.ts";

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());
it("merges concurrent saves under a shared Web Lock and deduplicates dates", async () => {
  let tail = Promise.resolve();
  const request = vi.fn((_name: string, work: () => unknown) => {
    const next = tail.then(work);
    tail = next.then(() => {});
    return next;
  });
  vi.stubGlobal("navigator", { locks: { request } });
  await Promise.all([
    saveRecord({ date: "2026-10-20", won: true, attempts: 2 }),
    saveRecord({ date: "2026-10-21", won: true, attempts: 3 }),
  ]);
  await saveRecord({ date: "2026-10-20", won: true, attempts: 2 });
  expect(readRecords()).toHaveLength(2);
  expect(request).toHaveBeenCalledTimes(3);
});
it("reports unavailable storage without throwing", async () => {
  const fail = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  try {
    expect((await saveRecord({ date: "2026-10-20", won: false, attempts: 8 })).saved).toBe(false);
  } finally {
    fail.mockRestore();
  }
});

it("falls back to a fresh merge when Web Locks is denied", async () => {
  localStorage.setItem(
    "cineclue:records",
    JSON.stringify([{ date: "2026-10-19", won: true, attempts: 1 }]),
  );
  vi.stubGlobal("navigator", {
    locks: { request: vi.fn().mockRejectedValue(new Error("SecurityError")) },
  });
  const result = await saveRecord({ date: "2026-10-20", won: true, attempts: 2 });
  expect(result.saved).toBe(true);
  expect(result.records).toHaveLength(2);
});
