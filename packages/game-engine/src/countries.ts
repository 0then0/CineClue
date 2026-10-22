import type { Entity } from "./model.ts";

export const historicalCountryCodes = new Set(["SU", "DD", "CS", "YU"]);

// Intl.DisplayNames aliases retired region codes to their modern successors.
// Preserve the historical identity and use explicit names instead.
export function normalizeCountry(entity: Entity): Entity {
  const code = entity.id.match(/^iso:([A-Z]{2})$/)?.[1];
  if (!code || !historicalCountryCodes.has(code)) return entity;
  const names: Record<string, { en: string; ru: string }> = {
    SU: { en: "Soviet Union", ru: "СССР" },
    DD: { en: "East Germany", ru: "ГДР" },
    YU: { en: "Yugoslavia", ru: "Югославия" },
  };
  // CS was reused: the source name distinguishes the two historical states.
  const source = (entity.names.en ?? entity.name).toLowerCase();
  const localized =
    code === "CS"
      ? source === "czechoslovakia"
        ? { en: "Czechoslovakia", ru: "Чехословакия" }
        : source === "serbia and montenegro"
          ? { en: "Serbia and Montenegro", ru: "Сербия и Черногория" }
          : { en: entity.name, ru: entity.name }
      : names[code];
  return { ...entity, name: localized.en, names: { ...entity.names, ...localized } };
}
export function countryName(entity: Entity, locale: string) {
  const country = normalizeCountry(entity);
  return country.names[locale] ?? country.name;
}

// Confirmed equivalent identities in the mixed catalog. Keep the source IDs in
// responses and snapshots; use this key only when comparing country sets.
const countryAliases: Readonly<Record<string, string>> = {
  "iso:SU": "Q15180",
  "iso:NL": "Q55",
};
export function countryKey(entity: Entity) {
  return Object.hasOwn(countryAliases, entity.id) ? countryAliases[entity.id] : entity.id;
}
