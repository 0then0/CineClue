# Data and media

CineClue ships a versioned catalog of 10,000 films. The game can initialize and run without a movie-provider API key. A TMDB token is needed only to refresh provider data or look up missing TMDB image metadata.

## Catalog files

- `data/catalog.json`: normalized films and collection definitions used by the database seed.
- `data/daily-pool.json`: TMDB vote counts for films with at least 5,000 audience votes, keyed by canonical catalog identity; no API request is needed to select a Daily.
- `data/media.json`: versioned poster/portrait/studio-logo URLs, country codes and source/license credits; image files are not bundled.
- `data/catalog-report.json`: snapshot date, exclusions and playable target counts for each difficulty.
- `data/seed/movies.json`: the separate Wikidata-only source seed.
- `data/seed/packs.json`: collection rules and English/Russian labels.
- `data/schemas/movie.schema.json`: the movie exchange format.

The validator checks required attributes, movie and collection IDs, explicit collection membership and nonempty target pools. Run `pnpm data:validate` after changing data. The report is the source for snapshot-specific counts; eligible pools can change when facts are corrected.

## Provenance and licensing

Wikidata structured facts are [CC0](https://www.wikidata.org/wiki/Wikidata:Licensing). TMDB metadata and images are subject to its [API terms](https://www.themoviedb.org/api-terms-of-use) and [attribution requirements](https://developer.themoviedb.org/docs/faq). The default catalog contains both sources, including TMDB principal-cast enrichment of the source seed. Each record retains provider, URL, license and retrieval date.

The mixed catalog is not CC0 or Apache-2.0. The application code license does not relicense third-party records, images or branding. Inclusion of the snapshot does not grant additional rights to provider data. Commercial TMDB use requires an appropriate agreement. The interface displays TMDB's approved logo and attribution notice when using its data or images.

## Selection and normalization

Discovery starts with films ranked by TMDB vote count, supplemented by Russian-language cinema, animation, pre-1970 classics and recent popular releases. The final selection retains source-seed film identities and reserves space for those groups before filling remaining slots by vote count.

Adult/video entries, unreleased or future films, runtimes outside 40–400 minutes and incomplete required attributes are excluded. Imported films require a director, genres, countries, studios and at least three actors. Principal cast uses the first five distinct TMDB credits in billing order. The archived source seed retains its original facts and separate CC0 provenance. In the gameplay snapshot, TMDB supplies principal cast and the common base genre taxonomy; other source facts remain unchanged.

For Wikidata imports, the normalizer selects the earliest supported release year and the median supported runtime. New imports require ordered screen/voice credits; explicitly dubbed-language P725 credits are excluded when they differ from the P364 original language. The archived source seed predates that principal-cast requirement; use the default mixed catalog for gameplay.

English, Russian and original-language titles support search. Labels fall back to available source names. Films and people are never matched by name alone. Explicit Wikidata/TMDB identifiers establish identity; ambiguous mappings are excluded. The genre equivalence map is reviewed separately because provider taxonomies differ.

Facts are community maintained and can be incomplete. Exact matches mean equality of normalized catalog sets, not exhaustive real-world credits or financing. Cite sources when correcting data and preserve canonical IDs.

## Refresh the catalog

Set `TMDB_API_TOKEN` in the untracked `.env` file and use a cache directory outside versioned data:

```sh
pnpm data:expand .cache/catalog
pnpm data:validate
```

The command maps identities, discovers candidates, downloads details, enriches source-seed cast and validates the complete snapshot before replacing `data/catalog.json`. It also writes `data/media.json` and `data/catalog-report.json`. No movie image files are downloaded. Requests have bounded concurrency, timeouts and retry backoff. Raw responses are cached without request headers or tokens.

Reuse the cache directory to resume an interrupted import. Use a new directory for a fresh provider snapshot. Generation can take tens of minutes. Review the report and commit the catalog, media metadata and report together.

Generating a snapshot does not change the running database. Follow [catalog updates](DEPLOYMENT.md#update-the-catalog) to apply it safely.

For individual provider imports:

```sh
pnpm data:import --provider wikidata --input response.json --output data/wikidata.local.json
node --env-file=.env scripts/import_movies/index.ts --provider tmdb --ids 550,27205 --output data/tmdb.local.json
```

`--merge existing.json` merges an existing movie array; `--identities identities.json` accepts an explicit external-to-canonical ID map. Inspect provenance before publishing output. Ad hoc `.local.json` exports remain ignored by Git.

## Collections and difficulty

Collections combine genre IDs, country IDs, director IDs, year ranges and explicit movie IDs. Rules combine with AND; values within an ID list combine with OR. A film can belong to several collections. Animation includes explicit membership because Wikidata represents animated film as a type rather than consistently as a genre.

Search covers the whole catalog. Target eligibility additionally requires complete attributes and actor/director connections. Difficulty combines completeness, distinct neighboring films and popularity. TMDB popularity uses a vote-count proxy; source-seed films retain their original popularity metric after cast enrichment. The API reports playable counts separately for each difficulty.

## Images and caching

`GET /api/media/:movieId` accepts only known catalog IDs. The server uses explicit identifiers to find images and returns metadata with source and license credits. Tokens are never sent to the browser.

Wikimedia Commons images require a supported license: CC BY, CC BY-SA, CC0 or public domain. Cards retain photographer, file-page and license links and disclose thumbnail cropping. Wikimedia images are not automatically CC0; see [Commons reuse requirements](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia).

Complete imported image metadata is served directly from `data/media.json`, so API outages and restarts do not remove available posters or portraits. Missing media can fall back to provider lookups. Studio logos also use Wikidata P154 and licensed Wikimedia Commons files when TMDB has no matching logo. Canonical studio IDs share available logos across films; names are never used to guess identity. Run `pnpm data:media` after a catalog refresh to persist those fallback logos and their attribution in the snapshot. Provider calls have eight-second timeouts, two active lookups and a bounded queue. The server caches successful results for 24 hours and empty results for 15 minutes. Its cache resets on restart. The browser persists validated image metadata for the same periods, up to 100 films, and shares in-flight requests between cards. When requesting metadata, the browser revalidates the HTTP response to avoid storing an older API response after an application update. Reloads reuse unexpired metadata without a new media API call when browser storage is available.

Country flags are rendered as Unicode emoji from the local canonical-ID/ISO mapping in `apps/web/src/countries.ts`, independently of image metadata requests and their caches. New ISO-prefixed identities also work immediately; unknown identities can use a code supplied by media metadata. Historical countries without a distinct supported emoji retain a globe rather than a modern successor flag. Retired ISO codes use explicit historical names rather than `Intl.DisplayNames`, which aliases them to modern countries. For the reused `CS` code, the source English name distinguishes Czechoslovakia from Serbia and Montenegro. Saved comparisons and answer snapshots receive label corrections when read; their identities, matches and numeric attributes remain unchanged. New country comparisons recognize the confirmed equivalent IDs `iso:SU`/`Q15180` and `iso:NL`/`Q55`, including when a saved target uses the other identifier. Comparison responses retain guessed entity IDs; existing recorded comparisons are not recalculated. Russia and the Soviet Union remain distinct countries.

Image files use the provider CDN and browser HTTP cache. A hard reload can refetch image files even when metadata remains cached. Failed requests are not persisted, and provider outages leave names and placeholders readable.

## Genre taxonomy

All gameplay films use the same 19 base TMDB movie genres, with short English/Russian labels. A small curated subgenre dictionary maps explicit Wikidata genre IDs and exact TMDB keywords; free-text summaries are never used to infer classifications. Missing subgenre data is not treated as evidence of a mismatch. Base genres and subgenres are compared separately, and only base genres determine the shared genre result cell. Within each group, matches appear first and rarer genres precede common ones.

The current snapshot has subgenres for 573 films from existing source classifications; coverage is intentionally incomplete. Future TMDB downloads include keywords. To reapply taxonomy rules from cached details, run `pnpm data:genres .cache/catalog`. To also fetch missing keyword responses with the existing rate limit and disk cache, run `pnpm data:genres .cache/catalog --keywords` with `TMDB_API_TOKEN` configured. A failed download leaves the catalog unchanged and can resume from cached responses. The importer keeps the previous genre profile to preserve comparisons against targets saved before the taxonomy change. Original collection genre IDs continue to match their curated subgenre equivalents.

## Daily film selection

Daily uses a separate audience-qualified pool rather than the Unlimited normal difficulty. The current catalog has 1,060 eligible Daily films, including popular classics, animation and blockbusters. Popularity here means broad audience recognition, measured by at least 5,000 TMDB votes, rather than review quality or a transient trending score. Complete comparison attributes, at least three principal actors and twelve neighboring films through shared cast/directors keep targets practical to deduce.

Rebuild the versioned audience snapshot after refreshing the catalog and cached TMDB candidates:

```sh
pnpm data:daily .cache/catalog
pnpm data:validate
```

The command reads `candidates.json` from the importer cache and joins only explicit TMDB provenance identifiers. It makes no network requests and does not change catalog facts or ongoing games. Missing or ambiguous identities are excluded. Commit the refreshed `data/daily-pool.json` with the catalog so a fresh clone uses the same audience evidence. The server keeps already assigned Daily films and avoids repeats for 180 days; director variety uses a seven-day window when alternatives are available.

## Country collections

Country collections match explicit canonical and ISO production-country identities, including co-productions. Russia and the Soviet Union share one collection (`country-russia-ussr`), matching `Q159`, `Q15180`, `iso:RU` and `iso:SU`; individual film country attributes remain distinct. The Countries group also includes the United States, United Kingdom, France, Germany, Italy, Spain, Japan, South Korea, China, India, Canada and Australia. Each collection reports eligible target counts separately for each difficulty.
