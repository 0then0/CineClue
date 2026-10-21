# Catalog files

`catalog.json` is the default, versioned catalog of 10,000 films and their collection definitions. It is included in Git and Docker builds. Starting a fresh installation imports this file without contacting movie providers or requiring a TMDB token.

`media.json` contains image URLs, country ISO codes and source/license credits from the same snapshot. It contains no image files or credentials. The API serves complete metadata without contacting TMDB.

`catalog-report.json` records the snapshot date, discovery and validation counts, excluded records and eligible targets by collection and difficulty. Refresh these files together with `pnpm data:expand`.

## Sources and licenses

The catalog combines Wikidata facts under [CC0](https://www.wikidata.org/wiki/Wikidata:Licensing) with TMDB film records and credited principal-cast information under the [TMDB API terms](https://www.themoviedb.org/api-terms-of-use). Each movie retains source URLs, licenses and retrieval dates. The combined catalog is not licensed as CC0 or Apache-2.0; inclusion in this repository does not grant additional rights to third-party records.

`seed/movies.json` contains the separate Wikidata-only source seed. Its cast lists are a historical connectivity sample rather than billing order; the default catalog replaces those lists with separately attributed TMDB principal credits. `seed/wikidata-ids.json` lists source candidates.

`seed/packs.json` contains original collection configuration. `schemas/movie.schema.json` describes the domain format. These two files are Apache-2.0.

Raw provider caches, ad hoc local exports and temporary files are excluded from Git. Movie images are fetched separately at runtime. See [the data guide](../docs/DATA.md) for imports, identity mapping and image attribution.
