# Personio Watchlist Adapter — Design

Date: 2026-06-25
Status: Approved (pending user review of this spec)

## Goal

Add a new watchlist source type, `personio`, so users can watch jobs from any
company hosted on Personio (e.g. `https://syte-gmbh.jobs.personio.com/`), the
same way they already can for Workday and BambooHR. The feature must support a
custom-URL flow (user pastes a company's Personio careers URL) and surface jobs,
job details, and import drafts through the existing watchlist adapter contract.

## Background: How Watchlist Sources Work

Two layers, mirrored from the existing `workday` and `bamboohr` sources:

1. **Career-board package** (`career-boards/<type>/`): a private npm-workspace
   package (`@career-boards/<type>`) that owns the network/scraping logic and
   exposes normalized data. Auto-discovered via the `career-boards/*` workspace
   glob in the root `package.json`.
2. **Watchlist adapter** (`orchestrator/src/server/watchlist/adapters/<type>.ts`):
   orchestration glue implementing `WatchlistCatalogSourceAdapter`. Registered in
   `adapters/index.ts`. Owns catalog parsing, custom-URL validation + label
   derivation, UI copy (`descriptor`), normalized job rows, canonical job
   identity, job details, import-draft prep, and optional branding/logo.

A generic catalog loader (`orchestrator/src/server/config/career-boards.ts`)
discovers any `career-boards-<type>.json` file and dispatches it to the matching
adapter's `parseCatalogSources`. The orchestrator imports `@career-boards/*`
packages via tsconfig `paths` aliases (it does **not** list them in
`orchestrator/package.json`).

This matches CONTRIBUTING.md → "Adding a new source type".

## Key Finding: Personio's Public Data Surface

Each Personio company subdomain exposes public endpoints. The important one:

- `https://<company>.jobs.personio.com/xml` — full job feed as XML. One request
  returns **both** the list **and** the full job descriptions
  (`<jobDescriptions>` with CDATA HTML sections), plus `createdAt`, office,
  department, employmentType, schedule, seniority.

(There is also `…/search.json`, but its `description` field is empty, so it
cannot produce import drafts on its own. We do not use it.)

Per-position XML fields observed on the syte example:
`id`, `subcompany`, `office`, `additionalOffices`, `department`,
`recruitingCategory`, `name`, `jobDescriptions` (list of `{name, value(CDATA)}`),
`employmentType`, `seniority`, `schedule`, `occupation`, `occupationCategory`,
`createdAt`, sometimes `yearsOfExperience`.

Canonical per-job page (for `jobUrl` / `applicationLink`):
`https://<company>.jobs.personio.com/job/<id>`.

**Consequence vs BambooHR:** Personio is *simpler*. BambooHR needs an N+1
(list, then a detail fetch per job). Personio's `/xml` gives list + descriptions
in a single fetch — we fetch once and slice job descriptions out of the parsed
feed for both `fetchJobs` and detail/draft.

## Architecture

### New package: `career-boards/personio/`

`package.json` — name `@career-boards/personio`, `private: true`,
`type: module`, mirroring bamboohr's `exports` map. Files:

- `src/personio-url.ts` — URL parsing + canonical/identity helpers:
  - `parsePersonioUrl(input)` → `{ inputUrl, origin, host, companySlug,
    canonicalCareersUrl, feedUrl }`. Host must end with `.jobs.personio.com`
    (or be `<slug>.jobs.personio.com`); `companySlug` is the leading label.
    Throws a typed `PersonioUrlParseError` with codes
    (`EMPTY_URL | INVALID_URL | UNSUPPORTED_HOST`).
  - `canonicalCareersUrl` = `https://<slug>.jobs.personio.com` (no trailing
    path); `feedUrl` = `…/xml`.
  - `parsePersonioJobUrl(input)` → adds `jobId` + `canonicalJobUrl`
    (`…/job/<id>`). Job id is numeric.
  - `personioUrlToCompanyLabel(input)` — title-cases the slug (strip a trailing
    `-gmbh`-style suffix? **No** — keep it simple, title-case on `-`/`_`, same
    as bamboohr; the user can override the label).
  - `personioUrlToSourceKey(input)` → `"personio:<slug-normalized>"` for
    dedupe/identity.
  - `personioUrlToJobUrl(careersUrl, jobId)` → `…/job/<id>`.
  - `isPersonioUrl(input)` → boolean.
- `src/get-jobs-from-feed.ts` — `getJobsFromFeed({ careersUrl, signal,
  fetchImpl?, headers?, userAgent? })`:
  - Fetches `feedUrl`, parses XML with **cheerio in `xmlMode`** (already a repo
    dependency; no new package). Iterates `<position>` elements.
  - Returns `{ total, fetched, jobs: NormalizedPersonioJob[] }` where each job
    carries: `externalId` (id), `title` (name), `jobUrl`, `locationText`
    (office + additionalOffices, deduped), `department`, `employmentType`,
    `schedule`, `seniority`, `postedOn` (createdAt), and the assembled
    `jobDescriptionHtml` / `jobDescriptionText` (concatenation of
    `<jobDescriptions>` sections, each rendered as `<h3>name</h3>` + CDATA
    value; text via the same `htmlToText` cleanup bamboohr uses).
  - We assemble descriptions here so a single feed fetch serves both list and
    detail/draft. The adapter caches/reuses by id.
- `src/index.ts` — re-exports the above.

No `get-company-info` / logo endpoint exists for Personio. **Branding is
omitted** for v1: descriptor `supportsBranding: false` and the adapter does not
implement `fetchBranding`. (Possible future: parse `<meta property="og:image">`
or `/logo` from the careers HTML — out of scope.)

### New adapter: `orchestrator/src/server/watchlist/adapters/personio.ts`

Implements `WatchlistCatalogSourceAdapter`, modeled on `bamboohr.ts`:

- `sourceType: "personio"`.
- `descriptor`: Personio copy — `label: "Personio"`,
  `catalogLabel: "Personio company"`,
  `customSourceOptionLabel: "Choose your own Personio URL"`,
  `customSourcePlaceholder: "https://company.jobs.personio.com/"`,
  `customSourceHelpText: "Use the public Personio careers URL, not an
  individual job posting URL."`, `invalidUrlMessage: "Invalid Personio URL"`,
  `supportsCustomSource: true`, `supportsBranding: false`, etc.
- `catalogSchema` / `parseCatalogSources`: Zod `{ label, personioUrl }`
  (minimal, matching bamboohr's schema-as-source-of-truth). Maps to
  `WatchlistSource` with `id = "personio:<canonicalCareersUrl>"`,
  `cxsJobsUrl: null`.
- `hydrateSelectedSource` / `normalizeCustomSelection`: canonicalize the URL,
  derive label from slug when the user didn't supply a distinct one.
- `fetchJobs`: call `getJobsFromFeed`, map to normalized watchlist rows
  (`jobRef = canonical job url`, `source = personioUrlToSourceKey`,
  `sourceJobId = externalId`, employer = source label, location, postedAt).
  Sort by `postedOn` desc and cap at 40 (same `BAMBOOHR_WATCHLIST_MAX_JOBS`
  convention).
- `fetchJobDetails`: re-fetch the feed for the source, find the position by id
  parsed from `jobRef`, return `{ jobRef, jobUrl, descriptionHtml }`.
- `prepareImportDraft`: same lookup, build `ManualJobDraft`
  (`jobDescription = jobDescriptionText`, `jobType = schedule/employmentType`,
  location, employer, urls).
- No `fetchBranding`.

`fetchJobDetails`/`prepareImportDraft` take a `jobRef` that is a single job URL
but no separate per-job endpoint exists, so they parse the company careers URL
from `input.source` and re-fetch the feed, then select by id. (The feed is one
request; acceptable. If the source URL is unavailable in a given call we derive
it from the job URL's host.)

### Registration / wiring (the easy-to-miss edits)

1. `orchestrator/src/server/watchlist/adapters/index.ts` — import
   `personioWatchlistAdapter`, add to the `adapters` tuple.
2. `orchestrator/tsconfig.json` — add `paths` aliases:
   `"@career-boards/personio"` → `../career-boards/personio/src/index.ts` and
   `"@career-boards/personio/*"` → `../career-boards/personio/src/*`.
   **Without this, imports won't resolve** (orchestrator relies on these aliases,
   not package.json deps).
3. `orchestrator/src/server/config/career-boards-personio.json` — seed as `[]`
   (empty; users add companies via the custom-URL flow). The generic loader
   auto-discovers it.
4. `career-boards/personio/package.json` — new workspace package (auto-picked by
   the `career-boards/*` glob). Run `npm install` once so the workspace symlink
   for `@career-boards/personio` is created in `node_modules`.

`shared`'s `WatchedSourceType` is `"workday" | (string & {})`, so `"personio"`
needs no type change.

## Error Handling

- URL parsing throws typed `PersonioUrlParseError`; adapter surfaces
  `descriptor.invalidUrlMessage` for the custom-source flow (same as bamboohr).
- Feed fetch: non-200 → throw with HTTP status + URL; non-XML/empty feed →
  throw a clear "not a valid Personio feed" error. Use `upstreamError` from
  `@infra/errors` where the adapter wraps upstream failures (matching bamboohr).
- Missing required fields (`id`, `name`) on a position → skip that position
  rather than failing the whole list (log-free; resilient), but if **zero**
  positions parse from a non-empty feed, throw so the failure is visible.

## Testing (required by CONTRIBUTING.md)

Co-located `*.test.ts` (Vitest, matching existing packages):

- `career-boards/personio/src/personio-url.test.ts` — canonicalization, host
  validation (accept `x.jobs.personio.com`, reject other hosts), source-key,
  job-url building, label derivation, error codes.
- `career-boards/personio/src/get-jobs-from-feed.test.ts` — parse a captured XML
  fixture (a trimmed copy of the syte feed): correct count, title/location/date
  mapping, description assembly + html-to-text, dedup of offices, skip-bad-row
  behavior, throw-on-all-bad.
- `orchestrator/src/server/watchlist/adapters/personio.test.ts` (or extend the
  existing adapter test file if there is a shared one) — catalog parsing, custom
  URL validation, canonical job identity, and import-draft preparation
  (the four CONTRIBUTING-mandated cases), using a mocked `fetchImpl`.

No watchlist API/page test changes expected: the adapter is purely additive and
shared behavior is unchanged. If `listWatchlistSourceAdapters` is snapshot-tested
anywhere, update that snapshot.

## Validation Before PR (CI-parity)

```
./orchestrator/node_modules/.bin/biome ci .
npm run check:types:shared
npm --workspace orchestrator run check:types
npm --workspace orchestrator run build:client
npm --workspace orchestrator run test:run
```

Plus a manual smoke test: run the app, add `https://syte-gmbh.jobs.personio.com/`
via the custom Personio URL flow, confirm jobs list, open a job's details, and
prepare an import draft.

## Out of Scope (YAGNI)

- Branding/logo lookup for Personio (no public logo endpoint; `supportsBranding:
  false`).
- Seeding the curated catalog with companies (ship empty `[]`).
- Using `/search.json` (descriptions empty; `/xml` supersedes it).
- Docs-site updates beyond what the user-visible flow requires (the watchlist
  picker copy is adapter-owned and self-describing).

## File Change Summary

New:
- `career-boards/personio/package.json`
- `career-boards/personio/src/personio-url.ts` (+ `.test.ts`)
- `career-boards/personio/src/get-jobs-from-feed.ts` (+ `.test.ts`)
- `career-boards/personio/src/index.ts`
- `orchestrator/src/server/watchlist/adapters/personio.ts` (+ `.test.ts`)
- `orchestrator/src/server/config/career-boards-personio.json` (`[]`)

Edited:
- `orchestrator/src/server/watchlist/adapters/index.ts` (register adapter)
- `orchestrator/tsconfig.json` (path aliases)
