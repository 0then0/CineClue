import { createReadStream } from "node:fs";

// JSON Lines uses LF separators. Node readline also splits U+2028/U+2029,
// which are legal unescaped characters inside JSON strings and film translations.
export async function* readJsonLines(path: string): AsyncGenerator<unknown> {
  let buffer = "";
  for await (const chunk of createReadStream(path, { encoding: "utf8" })) {
    if (typeof chunk !== "string") throw new Error("Expected UTF-8 input");
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      yield JSON.parse(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  }
  if (buffer.length) yield JSON.parse(buffer);
}
