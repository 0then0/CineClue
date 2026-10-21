# Data and media

CineClue ships a versioned catalog of 10,000 films. The game can initialize and run without a movie-provider API key. A TMDB token is needed only to refresh provider data or look up missing TMDB image metadata.

## Catalog files

- `data/catalog.json`: normalized films and collection definitions used by the database seed.
- `data/media.json`: versioned poster/portrait URLs, country codes and source/license credits; image files are not bundled.
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

Adult/video entries, unreleased or future films, runtimes outside 40–400 minutes and incomplete required attributes are excluded. Imported films require a director, genres, countries, studios and at least three actors. Principal cast uses the first five distinct TMDB credits in billing order. The source seed retains its original non-cast facts and separate CC0 provenance.

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

Collections combine genre IDs, director IDs, year ranges and explicit movie IDs. Rules combine with AND; values within an ID list combine with OR. A film can belong to several collections. Animation includes explicit membership because Wikidata represents animated film as a type rather than consistently as a genre.

Search covers the whole catalog. Target eligibility additionally requires complete attributes and actor/director connections. Difficulty combines completeness, distinct neighboring films and popularity. TMDB popularity uses a vote-count proxy; source-seed films retain their original popularity metric after cast enrichment. The API reports playable counts separately for each difficulty.

## Images and caching

`GET /api/media/:movieId` accepts only known catalog IDs. The server uses explicit identifiers to find images and returns metadata with source and license credits. Tokens are never sent to the browser.

Wikimedia Commons images require a supported license: CC BY, CC BY-SA, CC0 or public domain. Cards retain photographer, file-page and license links and disclose thumbnail cropping. Wikimedia images are not automatically CC0; see [Commons reuse requirements](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia).

Complete imported image metadata is served directly from `data/media.json`, so API outages and restarts do not remove available posters or portraits. Missing media can fall back to provider lookups. Provider calls have eight-second timeouts, two active lookups and a bounded queue. The server caches successful results for 24 hours and empty results for 15 minutes. Its cache resets on restart. The browser persists validated image metadata for the same periods, up to 100 films, and shares in-flight requests between cards. Reloads reuse unexpired metadata without a new media API call when browser storage is available.

Image files use the provider CDN and browser HTTP cache. A hard reload can refetch image files even when metadata remains cached. Failed requests are not persisted, and provider outages leave names and placeholders readable.
