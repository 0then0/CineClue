import { normalizeCountry } from "../../../packages/game-engine/src/countries.ts";
import type { Entity } from "../../../packages/game-engine/src/model.ts";
import { countryCode } from "./countries.ts";
import type { Locale } from "./i18n.ts";
import labels from "./locales/catalog.json" with { type: "json" };

const translated: Partial<Record<Locale, Record<string, string>>> = labels;
const regionNames = new Map<Locale, Intl.DisplayNames>();
export function entityName(entity: Entity, locale: Locale) {
  return (
    translated[locale]?.[entity.id] ??
    entity.names[locale] ??
    entity.names[locale.split("-")[0]] ??
    entity.names.en ??
    entity.name
  );
}
export function packName(pack: { id: string; name: Record<string, string> }, locale: Locale) {
  return translated[locale]?.[`pack:${pack.id}`] ?? pack.name[locale] ?? pack.name.en ?? pack.id;
}
export function countryName(entity: Entity, locale: Locale) {
  const country = normalizeCountry(entity);
  if (locale === "en" || locale === "ru") return country.names[locale] ?? country.name;
  const historical = translated[locale]?.[`country:${country.names.en ?? country.name}`];
  if (historical) return historical;
  const code = countryCode(country.id);
  if (code && !["SU", "DD", "CS", "YU"].includes(code)) {
    let names = regionNames.get(locale);
    if (!names) {
      names = new Intl.DisplayNames([locale], { type: "region" });
      regionNames.set(locale, names);
    }
    return names.of(code) ?? entityName(country, locale);
  }
  return entityName(country, locale);
}
