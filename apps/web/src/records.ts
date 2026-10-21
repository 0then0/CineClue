import { readStorage, writeStorage } from "./client.ts";
import type { DailyRecord } from "./results.ts";

const key = "cineclue:records";
export function readRecords(): DailyRecord[] {
  const data = readStorage<unknown>(key, []);
  return Array.isArray(data)
    ? data.filter(
        (r): r is DailyRecord =>
          typeof r?.date === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(r.date) &&
          typeof r?.won === "boolean" &&
          Number.isInteger(r?.attempts) &&
          r.attempts >= 1 &&
          r.attempts <= 8,
      )
    : [];
}
export async function saveRecord(record: DailyRecord) {
  const save = () => {
    const current = readRecords();
    const records = current.some((r) => r.date === record.date)
      ? current
      : [...current, record].sort((a, b) => a.date.localeCompare(b.date));
    return { records, saved: writeStorage(key, records) };
  };
  // Serialize cooperating tabs where Web Locks is available; always merge the latest storage.
  try {
    return navigator.locks ? await navigator.locks.request(key, save) : save();
  } catch {
    return save();
  }
}
