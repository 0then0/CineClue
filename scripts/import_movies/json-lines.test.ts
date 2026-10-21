import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { readJsonLines } from "./json-lines.ts";

it("preserves Unicode separators and multibyte strings across stream chunks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cineclue-jsonl-"));
  try {
    const records = [
      { id: 1, text: `${"я".repeat(65536)}\u2028film\u2029translation\nnext` },
      { id: 2, text: "第二部电影" },
    ];
    const file = join(directory, "records.jsonl");
    await writeFile(file, records.map((r) => JSON.stringify(r)).join("\n"));
    const result = [];
    for await (const value of readJsonLines(file)) result.push(value);
    expect(result).toEqual(records);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
