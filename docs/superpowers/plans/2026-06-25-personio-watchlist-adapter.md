# Personio Watchlist Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `personio` watchlist source type so users can watch jobs from any company hosted on Personio (e.g. `https://syte-gmbh.jobs.personio.com/`), via the custom-URL flow.

**Architecture:** Two layers mirroring the existing `bamboohr` source. (1) A new npm-workspace package `@career-boards/personio` that fetches and parses Personio's public `/xml` job feed (one request yields the list AND full job descriptions). (2) A watchlist adapter implementing `WatchlistCatalogSourceAdapter`, registered in the adapter registry. The XML is parsed with a small hand-rolled parser — no new dependency (cheerio is not hoisted to root and the feed is flat and regular).

**Tech Stack:** TypeScript (ESM), Vitest, Zod, Node 22.

## Global Constraints

- **Source type string:** `"personio"` (used as `sourceType`, catalog filename suffix, source-key prefix). `WatchedSourceType` is `"workday" | (string & {})`, so no shared-type edit is needed.
- **Package name:** `@career-boards/personio`, `private: true`, `"type": "module"`.
- **No new runtime dependencies.** Parse XML with a hand-rolled parser in `personio-feed.ts`.
- **No branding/logo support:** descriptor `supportsBranding: false`; adapter does NOT implement `fetchBranding`. Personio has no public logo endpoint.
- **Catalog seeded empty:** `career-boards-personio.json` is `[]`.
- **Job cap:** 40 jobs max per fetch (`PERSONIO_WATCHLIST_MAX_JOBS = 40`), sorted by `postedOn` descending — matches the BambooHR convention.
- **Default User-Agent** (copied verbatim from bamboohr): `"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"`.
- **Feed facts (confirmed against the live syte feed):** root element `<workzag-jobs>`; each job is a `<position>` with children `id`, `subcompany`, `office`, optional `additionalOffices`, `department`, `recruitingCategory`, `name`, `jobDescriptions` (list of `jobDescription` → `name` + `value` with CDATA HTML), `employmentType`, `seniority`, `schedule`, `occupation`, `occupationCategory`, `createdAt` (ISO8601). Canonical job page: `https://<slug>.jobs.personio.com/job/<id>`.
- **CI-parity validation** (run before PR, from repo root):
  ```
  ./orchestrator/node_modules/.bin/biome ci .
  npm run check:types:shared
  npm --workspace orchestrator run check:types
  npm --workspace orchestrator run build:client
  npm --workspace orchestrator run test:run
  ```

---

## File Structure

New package `career-boards/personio/`:
- `package.json` — workspace package manifest.
- `src/personio-url.ts` — URL parsing, canonicalization, identity helpers.
- `src/personio-url.test.ts` — tests for the above.
- `src/personio-feed.ts` — XML feed fetch + parse + normalization.
- `src/personio-feed.test.ts` — tests for the above (with a captured fixture).
- `src/index.ts` — re-exports.

Orchestrator:
- `orchestrator/src/server/watchlist/adapters/personio.ts` — the adapter.
- `orchestrator/src/server/watchlist/adapters/personio.test.ts` — adapter tests.
- `orchestrator/src/server/config/career-boards-personio.json` — `[]`.
- `orchestrator/src/server/watchlist/adapters/index.ts` — register adapter (modify).
- `orchestrator/tsconfig.json` — add path aliases (modify).

---

## Task 1: Scaffold the `@career-boards/personio` package and URL helpers

**Files:**
- Create: `career-boards/personio/package.json`
- Create: `career-boards/personio/src/personio-url.ts`
- Create: `career-boards/personio/src/index.ts`
- Test: `career-boards/personio/src/personio-url.test.ts`

**Interfaces:**
- Produces:
  - `interface PersonioSourceConfig { inputUrl: string; origin: string; host: string; companySlug: string; canonicalCareersUrl: string; feedUrl: string; }`
  - `interface PersonioJobSourceConfig extends PersonioSourceConfig { jobId: string; canonicalJobUrl: string; }`
  - `class PersonioUrlParseError extends Error { code; input; }` with codes `"EMPTY_URL" | "INVALID_URL" | "UNSUPPORTED_HOST" | "INVALID_JOB_ID"`
  - `function parsePersonioUrl(input: string): PersonioSourceConfig`
  - `function parsePersonioJobUrl(input: string): PersonioJobSourceConfig`
  - `function isPersonioUrl(input: string): boolean`
  - `function personioUrlToCompanyLabel(input: string): string`
  - `function personioUrlToSourceKey(input: string): string`
  - `function personioUrlToJobUrl(careersUrl: string, jobId: string): string`
  - `canonicalCareersUrl` = `https://<slug>.jobs.personio.com` (origin only, no path).
  - `feedUrl` = `<canonicalCareersUrl>/xml`.
  - `canonicalJobUrl` = `<canonicalCareersUrl>/job/<jobId>`.
  - `personioUrlToSourceKey` returns `personio:<slug-normalized>` where normalized = lowercased, non-alphanumerics → `-`.
  - `personioUrlToCompanyLabel` title-cases the slug on `-`/`_` (e.g. `syte-gmbh` → `Syte Gmbh`).

- [ ] **Step 1: Create the package manifest**

Create `career-boards/personio/package.json`:

```json
{
  "name": "@career-boards/personio",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./personio-url": "./src/personio-url.ts",
    "./personio-feed": "./src/personio-feed.ts"
  }
}
```

- [ ] **Step 2: Write the failing test**

Create `career-boards/personio/src/personio-url.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  isPersonioUrl,
  parsePersonioJobUrl,
  parsePersonioUrl,
  personioUrlToCompanyLabel,
  personioUrlToJobUrl,
  personioUrlToSourceKey,
} from "./personio-url";

describe("parsePersonioUrl", () => {
  it("canonicalizes a careers URL to the origin and derives the feed URL", () => {
    expect(parsePersonioUrl("https://syte-gmbh.jobs.personio.com/")).toMatchObject({
      companySlug: "syte-gmbh",
      canonicalCareersUrl: "https://syte-gmbh.jobs.personio.com",
      feedUrl: "https://syte-gmbh.jobs.personio.com/xml",
    });
  });

  it("canonicalizes a deep job URL back to the careers origin", () => {
    expect(
      parsePersonioUrl("https://syte-gmbh.jobs.personio.com/job/2659296")
        .canonicalCareersUrl,
    ).toBe("https://syte-gmbh.jobs.personio.com");
  });

  it("rejects non-personio hosts", () => {
    expect(() => parsePersonioUrl("https://example.com/careers")).toThrow();
    expect(isPersonioUrl("https://example.com/careers")).toBe(false);
  });

  it("rejects empty input", () => {
    expect(() => parsePersonioUrl("   ")).toThrow();
  });

  it("derives the company label and source key from the subdomain", () => {
    expect(
      personioUrlToCompanyLabel("https://syte-gmbh.jobs.personio.com/"),
    ).toBe("Syte Gmbh");
    expect(
      personioUrlToSourceKey("https://syte-gmbh.jobs.personio.com/"),
    ).toBe("personio:syte-gmbh");
  });

  it("builds canonical job URLs", () => {
    expect(
      personioUrlToJobUrl("https://syte-gmbh.jobs.personio.com", "2659296"),
    ).toBe("https://syte-gmbh.jobs.personio.com/job/2659296");
  });

  it("parses job URLs into a job id", () => {
    expect(
      parsePersonioJobUrl("https://syte-gmbh.jobs.personio.com/job/2659296"),
    ).toMatchObject({
      jobId: "2659296",
      canonicalJobUrl: "https://syte-gmbh.jobs.personio.com/job/2659296",
    });
  });

  it("rejects job URLs without a numeric id", () => {
    expect(() =>
      parsePersonioJobUrl("https://syte-gmbh.jobs.personio.com/"),
    ).toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm --workspace orchestrator run test:run -- career-boards/personio/src/personio-url.test.ts`
Expected: FAIL — `personio-url.ts` does not exist / functions not defined.

- [ ] **Step 4: Implement `personio-url.ts`**

Create `career-boards/personio/src/personio-url.ts`:

```typescript
export type PersonioUrlParseErrorCode =
  | "EMPTY_URL"
  | "INVALID_URL"
  | "UNSUPPORTED_HOST"
  | "INVALID_JOB_ID";

export interface PersonioSourceConfig {
  inputUrl: string;
  origin: string;
  host: string;
  companySlug: string;
  canonicalCareersUrl: string;
  feedUrl: string;
}

export interface PersonioJobSourceConfig extends PersonioSourceConfig {
  jobId: string;
  canonicalJobUrl: string;
}

const PERSONIO_HOST_SUFFIX = ".jobs.personio.com";

export class PersonioUrlParseError extends Error {
  readonly code: PersonioUrlParseErrorCode;
  readonly input: string;

  constructor(
    code: PersonioUrlParseErrorCode,
    message: string,
    input: string,
  ) {
    super(message);
    this.name = "PersonioUrlParseError";
    this.code = code;
    this.input = input;
  }
}

export function isPersonioUrl(input: string): boolean {
  try {
    parsePersonioUrl(input);
    return true;
  } catch {
    return false;
  }
}

export function parsePersonioUrl(input: string): PersonioSourceConfig {
  if (!input.trim()) {
    throw new PersonioUrlParseError("EMPTY_URL", "URL cannot be empty.", input);
  }

  const url = toUrl(input);
  const host = url.hostname.toLowerCase();
  if (!host.endsWith(PERSONIO_HOST_SUFFIX)) {
    throw new PersonioUrlParseError(
      "UNSUPPORTED_HOST",
      `Unsupported Personio host: ${host}`,
      input,
    );
  }

  const companySlug = host.slice(0, -PERSONIO_HOST_SUFFIX.length);
  if (!companySlug || companySlug.includes(".")) {
    throw new PersonioUrlParseError(
      "UNSUPPORTED_HOST",
      `Unsupported Personio host: ${host}`,
      input,
    );
  }

  const canonicalCareersUrl = `${url.protocol}//${host}`;

  return {
    inputUrl: input,
    origin: url.origin,
    host,
    companySlug,
    canonicalCareersUrl,
    feedUrl: `${canonicalCareersUrl}/xml`,
  };
}

export function parsePersonioJobUrl(input: string): PersonioJobSourceConfig {
  const source = parsePersonioUrl(input);
  const url = toUrl(input);
  const segments = url.pathname.split("/").filter(Boolean);
  const jobIndex = segments.indexOf("job");
  const maybeJobId =
    jobIndex >= 0 ? segments[jobIndex + 1] : segments[segments.length - 1];

  if (!maybeJobId || !/^\d+$/.test(maybeJobId)) {
    throw new PersonioUrlParseError(
      "INVALID_JOB_ID",
      "Personio job URLs must include a numeric job id under /job/{id}.",
      input,
    );
  }

  return buildJobSource(source, maybeJobId);
}

export function personioUrlToCompanyLabel(input: string): string {
  return formatCompanySlug(parsePersonioUrl(input).companySlug);
}

export function personioUrlToSourceKey(input: string): string {
  return `personio:${toSourceKeyPart(parsePersonioUrl(input).companySlug)}`;
}

export function personioUrlToJobUrl(careersUrl: string, jobId: string): string {
  return buildJobSource(parsePersonioUrl(careersUrl), jobId).canonicalJobUrl;
}

function buildJobSource(
  source: PersonioSourceConfig,
  jobId: string,
): PersonioJobSourceConfig {
  if (!/^\d+$/.test(jobId)) {
    throw new PersonioUrlParseError(
      "INVALID_JOB_ID",
      `Invalid Personio job id: ${jobId}`,
      source.inputUrl,
    );
  }

  return {
    ...source,
    jobId,
    canonicalJobUrl: `${source.canonicalCareersUrl}/job/${jobId}`,
  };
}

function toUrl(input: string): URL {
  try {
    return new URL(input.trim());
  } catch {
    throw new PersonioUrlParseError(
      "INVALID_URL",
      `Invalid URL: ${input}`,
      input,
    );
  }
}

function formatCompanySlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function toSourceKeyPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
}
```

- [ ] **Step 5: Create the package barrel**

Create `career-boards/personio/src/index.ts`:

```typescript
export * from "./personio-url";
export * from "./personio-feed";
```

Note: this imports `./personio-feed` which does not exist until Task 2. To keep this task's tests green standalone, create a temporary stub now and replace it in Task 2. Create `career-boards/personio/src/personio-feed.ts` with a single line:

```typescript
export {};
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --workspace orchestrator run test:run -- career-boards/personio/src/personio-url.test.ts`
Expected: PASS (all url tests green).

- [ ] **Step 7: Install so the workspace symlink is created**

Run: `npm install`
Expected: completes; `node_modules/@career-boards/personio` symlink now exists.

- [ ] **Step 8: Commit**

```bash
git add career-boards/personio/package.json career-boards/personio/src/personio-url.ts career-boards/personio/src/personio-url.test.ts career-boards/personio/src/index.ts career-boards/personio/src/personio-feed.ts package-lock.json
git commit -m "feat(personio): add career-boards package scaffold and URL helpers"
```

---

## Task 2: Personio feed fetch + parse (`personio-feed.ts`)

**Files:**
- Create/replace: `career-boards/personio/src/personio-feed.ts` (replaces the Task 1 stub)
- Test: `career-boards/personio/src/personio-feed.test.ts`

**Interfaces:**
- Consumes (from Task 1): `PersonioSourceConfig`, `parsePersonioUrl`, `personioUrlToJobUrl`.
- Produces:
  - `interface NormalizedPersonioJob { source: "personio"; externalId: string; title: string; jobUrl: string; locationText?: string; department?: string; employmentType?: string; schedule?: string; seniority?: string; postedOn?: string; jobDescriptionHtml: string; jobDescriptionText: string; }`
  - `interface FetchPersonioJobsOptions { careersUrl: string; fetchImpl?: typeof fetch; signal?: AbortSignal; headers?: HeadersInit; userAgent?: string; }`
  - `interface FetchPersonioJobsResult { total: number; fetched: number; jobs: NormalizedPersonioJob[]; }`
  - `function getJobsFromFeed(options: FetchPersonioJobsOptions): Promise<FetchPersonioJobsResult>`
  - `function parsePersonioFeed(xml: string, source: PersonioSourceConfig): NormalizedPersonioJob[]` (exported for tests)

- [ ] **Step 1: Write the failing test**

Create `career-boards/personio/src/personio-feed.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { parsePersonioUrl } from "./personio-url";
import { getJobsFromFeed, parsePersonioFeed } from "./personio-feed";

const SOURCE = parsePersonioUrl("https://syte-gmbh.jobs.personio.com/");

const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<workzag-jobs>
<position>
    <id>2659296</id>
    <subcompany>syte GmbH</subcompany>
    <office>Remote</office>
    <additionalOffices>Münster</additionalOffices>
    <department>International Expansion</department>
    <recruitingCategory>Vollzeit</recruitingCategory>
    <name>Country Manager Spain (m/w/d)</name>
    <jobDescriptions>
        <jobDescription>
            <name>Deine Mission</name>
            <value><![CDATA[<p>Hallo &amp; willkommen</p>]]></value>
        </jobDescription>
        <jobDescription>
            <name>Dein Profil</name>
            <value><![CDATA[<ul><li>Punkt eins</li></ul>]]></value>
        </jobDescription>
    </jobDescriptions>
    <employmentType>permanent</employmentType>
    <seniority>experienced</seniority>
    <schedule>full-time</schedule>
    <createdAt>2026-06-05T10:55:18+00:00</createdAt>
</position>
<position>
    <id>2659143</id>
    <subcompany>syte GmbH</subcompany>
    <office>Münster</office>
    <department>Engineering</department>
    <name>Backend Engineer (m/w/d)</name>
    <jobDescriptions>
        <jobDescription>
            <name>Aufgaben</name>
            <value><![CDATA[<p>Code schreiben</p>]]></value>
        </jobDescription>
    </jobDescriptions>
    <employmentType>permanent</employmentType>
    <schedule>full-time</schedule>
    <createdAt>2026-06-01T08:00:00+00:00</createdAt>
</position>
</workzag-jobs>`;

describe("parsePersonioFeed", () => {
  it("parses positions into normalized jobs", () => {
    const jobs = parsePersonioFeed(FIXTURE, SOURCE);
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      source: "personio",
      externalId: "2659296",
      title: "Country Manager Spain (m/w/d)",
      jobUrl: "https://syte-gmbh.jobs.personio.com/job/2659296",
      locationText: "Remote, Münster",
      department: "International Expansion",
      employmentType: "permanent",
      schedule: "full-time",
      seniority: "experienced",
      postedOn: "2026-06-05T10:55:18+00:00",
    });
  });

  it("assembles job description html from all sections and decodes text", () => {
    const [job] = parsePersonioFeed(FIXTURE, SOURCE);
    expect(job.jobDescriptionHtml).toContain("<h3>Deine Mission</h3>");
    expect(job.jobDescriptionHtml).toContain("<p>Hallo &amp; willkommen</p>");
    expect(job.jobDescriptionHtml).toContain("<h3>Dein Profil</h3>");
    expect(job.jobDescriptionText).toContain("Hallo & willkommen");
    expect(job.jobDescriptionText).toContain("Punkt eins");
  });

  it("skips positions missing an id or name but keeps the rest", () => {
    const xml = `<workzag-jobs>
<position><name>No Id</name></position>
<position><id>5</id><name>Good</name><jobDescriptions></jobDescriptions></position>
</workzag-jobs>`;
    const jobs = parsePersonioFeed(xml, SOURCE);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].externalId).toBe("5");
  });

  it("throws when a non-empty feed yields zero parseable positions", () => {
    const xml = `<workzag-jobs><position><name>No Id</name></position></workzag-jobs>`;
    expect(() => parsePersonioFeed(xml, SOURCE)).toThrow();
  });
});

describe("getJobsFromFeed", () => {
  it("fetches the feed URL and returns normalized jobs", async () => {
    const fetchImpl = (async (url: string) => {
      expect(url).toBe("https://syte-gmbh.jobs.personio.com/xml");
      return new Response(FIXTURE, {
        status: 200,
        headers: { "content-type": "application/xml" },
      });
    }) as unknown as typeof fetch;

    const result = await getJobsFromFeed({
      careersUrl: "https://syte-gmbh.jobs.personio.com/",
      fetchImpl,
    });

    expect(result.total).toBe(2);
    expect(result.fetched).toBe(2);
    expect(result.jobs[0].externalId).toBe("2659296");
  });

  it("throws on a non-200 response", async () => {
    const fetchImpl = (async () =>
      new Response("nope", { status: 503 })) as unknown as typeof fetch;
    await expect(
      getJobsFromFeed({
        careersUrl: "https://syte-gmbh.jobs.personio.com/",
        fetchImpl,
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace orchestrator run test:run -- career-boards/personio/src/personio-feed.test.ts`
Expected: FAIL — `getJobsFromFeed` / `parsePersonioFeed` not exported (stub only).

- [ ] **Step 3: Implement `personio-feed.ts`**

Replace `career-boards/personio/src/personio-feed.ts` with:

```typescript
import {
  type PersonioSourceConfig,
  parsePersonioUrl,
  personioUrlToJobUrl,
} from "./personio-url";

export interface NormalizedPersonioJob {
  source: "personio";
  externalId: string;
  title: string;
  jobUrl: string;
  locationText?: string;
  department?: string;
  employmentType?: string;
  schedule?: string;
  seniority?: string;
  postedOn?: string;
  jobDescriptionHtml: string;
  jobDescriptionText: string;
}

export interface FetchPersonioJobsOptions {
  careersUrl: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  headers?: HeadersInit;
  userAgent?: string;
}

export interface FetchPersonioJobsResult {
  total: number;
  fetched: number;
  jobs: NormalizedPersonioJob[];
}

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

export async function getJobsFromFeed(
  options: FetchPersonioJobsOptions,
): Promise<FetchPersonioJobsResult> {
  const fetchFn = options.fetchImpl ?? globalThis.fetch;
  if (!fetchFn) {
    throw new Error(
      "No fetch implementation available. Pass fetchImpl or use Node 18+.",
    );
  }

  const source = parsePersonioUrl(options.careersUrl);
  const response = await fetchFn(source.feedUrl, {
    method: "GET",
    signal: options.signal,
    headers: {
      accept: "application/xml,text/xml",
      referer: source.canonicalCareersUrl,
      "user-agent": options.userAgent ?? DEFAULT_USER_AGENT,
      ...options.headers,
    },
  });

  const xml = await response.text();
  if (!response.ok) {
    throw new Error(
      `Personio request failed with HTTP ${response.status} for ${source.feedUrl}.`,
    );
  }

  const jobs = parsePersonioFeed(xml, source);
  return { total: jobs.length, fetched: jobs.length, jobs };
}

export function parsePersonioFeed(
  xml: string,
  source: PersonioSourceConfig,
): NormalizedPersonioJob[] {
  const positions = extractBlocks(xml, "position");
  const jobs: NormalizedPersonioJob[] = [];

  for (const position of positions) {
    const job = normalizePosition(position, source);
    if (job) jobs.push(job);
  }

  if (jobs.length === 0 && positions.length > 0) {
    throw new Error(
      `Personio feed for ${source.feedUrl} contained ${positions.length} positions but none were parseable.`,
    );
  }

  return jobs;
}

function normalizePosition(
  position: string,
  source: PersonioSourceConfig,
): NormalizedPersonioJob | null {
  const externalId = getTagText(position, "id");
  const title = getTagText(position, "name");
  if (!externalId || !title) return null;

  const descriptionHtml = buildDescriptionHtml(position);

  return {
    source: "personio",
    externalId,
    title,
    jobUrl: personioUrlToJobUrl(source.canonicalCareersUrl, externalId),
    locationText: buildLocationText(position),
    department: getTagText(position, "department"),
    employmentType: getTagText(position, "employmentType"),
    schedule: getTagText(position, "schedule"),
    seniority: getTagText(position, "seniority"),
    postedOn: getTagText(position, "createdAt"),
    jobDescriptionHtml: descriptionHtml,
    jobDescriptionText: htmlToText(descriptionHtml),
  };
}

function buildLocationText(position: string): string | undefined {
  const parts = [
    getTagText(position, "office"),
    getTagText(position, "additionalOffices"),
  ].filter((value, index, values): value is string => {
    if (!value) return false;
    return values.indexOf(value) === index;
  });
  return parts.length > 0 ? parts.join(", ") : undefined;
}

function buildDescriptionHtml(position: string): string {
  const container = extractBlocks(position, "jobDescriptions")[0] ?? "";
  const sections = extractBlocks(container, "jobDescription");
  const html = sections
    .map((section) => {
      const name = getTagText(section, "name");
      const value = getCdataOrText(section, "value");
      const heading = name ? `<h3>${escapeHtml(name)}</h3>` : "";
      return `${heading}${value}`;
    })
    .filter((chunk) => chunk.trim().length > 0)
    .join("\n");
  return html;
}

function extractBlocks(source: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g");
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

function getTagText(source: string, tag: string): string | undefined {
  const match = new RegExp(
    `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`,
  ).exec(source);
  if (!match) return undefined;
  const value = stripCdata(match[1]).trim();
  return value.length > 0 ? decodeEntities(value) : undefined;
}

function getCdataOrText(source: string, tag: string): string {
  const match = new RegExp(
    `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`,
  ).exec(source);
  if (!match) return "";
  return stripCdata(match[1]).trim();
}

function stripCdata(value: string): string {
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(value);
  return cdata ? cdata[1] : value;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|h[1-6]|ul|ol)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
```

Note on the description-text assertion: `<p>Hallo &amp; willkommen</p>` → after `htmlToText`, `&amp;` decodes to `&`, giving `Hallo & willkommen`. The fixture test relies on this.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --workspace orchestrator run test:run -- career-boards/personio/src/personio-feed.test.ts`
Expected: PASS (all feed tests green).

- [ ] **Step 5: Commit**

```bash
git add career-boards/personio/src/personio-feed.ts career-boards/personio/src/personio-feed.test.ts
git commit -m "feat(personio): add XML feed fetch and parser"
```

---

## Task 3: The watchlist adapter (`personio.ts`)

**Files:**
- Create: `orchestrator/src/server/watchlist/adapters/personio.ts`
- Create: `orchestrator/src/server/config/career-boards-personio.json`
- Modify: `orchestrator/tsconfig.json` (add path aliases)
- Test: `orchestrator/src/server/watchlist/adapters/personio.test.ts`

**Interfaces:**
- Consumes (from Task 1/2): `parsePersonioUrl`, `personioUrlToCompanyLabel`, `personioUrlToSourceKey`, `personioUrlToJobUrl`, `parsePersonioJobUrl`, `getJobsFromFeed`, `NormalizedPersonioJob`.
- Consumes (orchestrator): `WatchlistCatalogSourceAdapter` from `./types`; `ManualJobDraft`, `WatchlistSelectedSource` from `@shared/types`.
- Produces: `export const personioWatchlistAdapter: WatchlistCatalogSourceAdapter`.
- Catalog schema: `{ label: string; personioUrl: string }`.
- `parseCatalogSources` maps to `WatchlistSource` with `id = "personio:" + canonicalCareersUrl`, `cxsJobsUrl: null`.

- [ ] **Step 1: Add tsconfig path aliases**

Modify `orchestrator/tsconfig.json` — in `compilerOptions.paths`, after the `@career-boards/bamboohr/*` line, add:

```json
      "@career-boards/personio": ["../career-boards/personio/src/index.ts"],
      "@career-boards/personio/*": ["../career-boards/personio/src/*"],
```

(Keep existing workday/bamboohr entries unchanged. Ensure trailing commas remain valid JSON-with-comments per the file's existing style.)

- [ ] **Step 2: Create the empty catalog file**

Create `orchestrator/src/server/config/career-boards-personio.json`:

```json
[]
```

- [ ] **Step 3: Write the failing adapter test**

Create `orchestrator/src/server/watchlist/adapters/personio.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { personioWatchlistAdapter } from "./personio";

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<workzag-jobs>
<position>
    <id>2659296</id>
    <office>Remote</office>
    <additionalOffices>Münster</additionalOffices>
    <department>International Expansion</department>
    <name>Country Manager Spain (m/w/d)</name>
    <jobDescriptions>
        <jobDescription>
            <name>Deine Mission</name>
            <value><![CDATA[<p>Mission</p>]]></value>
        </jobDescription>
    </jobDescriptions>
    <employmentType>permanent</employmentType>
    <schedule>full-time</schedule>
    <createdAt>2026-06-05T10:55:18+00:00</createdAt>
</position>
</workzag-jobs>`;

function selectedSource() {
  return {
    id: "selected-syte",
    catalogSourceId: null,
    label: "Syte Gmbh",
    sourceType: "personio" as const,
    careersUrl: "https://syte-gmbh.jobs.personio.com",
    cxsJobsUrl: null,
    isCustom: true,
    sortOrder: 0,
    createdAt: "2026-05-20T00:00:00.000Z",
    updatedAt: "2026-05-20T00:00:00.000Z",
  };
}

describe("personioWatchlistAdapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("parses catalog sources into canonical watchlist sources", () => {
    expect(
      personioWatchlistAdapter.parseCatalogSources([
        { label: "Syte", personioUrl: "https://syte-gmbh.jobs.personio.com/" },
      ]),
    ).toEqual([
      {
        id: "personio:https://syte-gmbh.jobs.personio.com",
        label: "Syte",
        sourceType: "personio",
        careersUrl: "https://syte-gmbh.jobs.personio.com",
        cxsJobsUrl: null,
      },
    ]);
  });

  it("normalizes custom selections to the careers origin and derived label", () => {
    expect(
      personioWatchlistAdapter.normalizeCustomSelection({
        label: "https://syte-gmbh.jobs.personio.com/",
        careersUrl: "https://syte-gmbh.jobs.personio.com/",
      }),
    ).toEqual({
      label: "Syte Gmbh",
      careersUrl: "https://syte-gmbh.jobs.personio.com",
    });
  });

  it("does not support branding", () => {
    expect(personioWatchlistAdapter.descriptor.supportsBranding).toBe(false);
    expect(personioWatchlistAdapter.fetchBranding).toBeUndefined();
  });

  it("fetches and normalizes jobs from the feed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(FEED, {
          status: 200,
          headers: { "content-type": "application/xml" },
        }),
      ),
    );

    await expect(
      personioWatchlistAdapter.fetchJobs({ source: selectedSource() }),
    ).resolves.toMatchObject({
      total: 1,
      fetched: 1,
      jobs: [
        expect.objectContaining({
          sourceJobId: "2659296",
          jobUrl: "https://syte-gmbh.jobs.personio.com/job/2659296",
          location: "Remote, Münster",
          postedAt: "2026-06-05T10:55:18+00:00",
        }),
      ],
    });
  });

  it("prepares an import draft from the feed for a job ref", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(FEED, {
          status: 200,
          headers: { "content-type": "application/xml" },
        }),
      ),
    );

    const result = await personioWatchlistAdapter.prepareImportDraft({
      source: selectedSource(),
      jobRef: "https://syte-gmbh.jobs.personio.com/job/2659296",
    });

    expect(result.draft).toMatchObject({
      source: "personio:syte-gmbh",
      sourceJobId: "2659296",
      title: "Country Manager Spain (m/w/d)",
      jobUrl: "https://syte-gmbh.jobs.personio.com/job/2659296",
      employer: "Syte Gmbh",
    });
    expect(result.draft.jobDescription).toContain("Mission");
    expect(result.sourceHost).toBe("syte-gmbh.jobs.personio.com");
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm --workspace orchestrator run test:run -- src/server/watchlist/adapters/personio.test.ts`
Expected: FAIL — `./personio` module not found.

- [ ] **Step 5: Implement the adapter**

Create `orchestrator/src/server/watchlist/adapters/personio.ts`:

```typescript
import {
  getJobsFromFeed,
  type NormalizedPersonioJob,
  parsePersonioJobUrl,
  parsePersonioUrl,
  personioUrlToCompanyLabel,
  personioUrlToJobUrl,
  personioUrlToSourceKey,
} from "@career-boards/personio";
import type { ManualJobDraft, WatchlistSelectedSource } from "@shared/types";
import { z } from "zod";
import type { WatchlistCatalogSourceAdapter } from "./types";

const PERSONIO_WATCHLIST_MAX_JOBS = 40;

const personioSourceSchema = z.object({
  label: z.string().trim().min(1).max(200),
  personioUrl: z.string().trim().url().max(2000),
});

export const personioWatchlistAdapter: WatchlistCatalogSourceAdapter = {
  sourceType: "personio",
  descriptor: {
    sourceType: "personio",
    label: "Personio",
    catalogLabel: "Personio company",
    customSourceOptionLabel: "Choose your own Personio URL",
    customSourceSearchText: "custom personio url",
    customSourceInputLabel: "Custom Personio URL",
    customSourcePlaceholder: "https://company.jobs.personio.com/",
    customSourceHelpText:
      "Use the public Personio careers URL, not an individual job posting URL.",
    emptyCatalogText: "No Personio companies found.",
    fetchingLabel: "Fetching from Personio...",
    invalidUrlMessage: "Invalid Personio URL",
    supportsCustomSource: true,
    supportsBranding: false,
  },
  catalogSchema: personioSourceSchema,
  parseCatalogSources(entries) {
    return z
      .array(personioSourceSchema)
      .parse(entries)
      .map((entry) => {
        const parsed = parsePersonioUrl(entry.personioUrl);
        return {
          id: `personio:${parsed.canonicalCareersUrl}`,
          label: entry.label,
          sourceType: "personio",
          careersUrl: parsed.canonicalCareersUrl,
          cxsJobsUrl: null,
        };
      });
  },
  hydrateSelectedSource(source) {
    const parsed = parsePersonioUrl(source.careersUrl);
    return {
      ...source,
      label: getHydratedPersonioLabel(source),
      careersUrl: parsed.canonicalCareersUrl,
      cxsJobsUrl: null,
    };
  },
  normalizeCustomSelection(input) {
    const canonicalCareersUrl =
      parsePersonioUrl(input.careersUrl).canonicalCareersUrl;
    const trimmedLabel = input.label?.trim();
    const label =
      trimmedLabel && trimmedLabel !== input.careersUrl.trim()
        ? trimmedLabel
        : personioUrlToCompanyLabel(canonicalCareersUrl);

    return {
      label,
      careersUrl: canonicalCareersUrl,
    };
  },
  async fetchJobs(input) {
    const response = await getJobsFromFeed({
      careersUrl: input.source.careersUrl,
      signal: input.signal,
    });
    const source = personioUrlToSourceKey(input.source.careersUrl);

    const jobs = response.jobs
      .slice()
      .sort((left, right) =>
        comparePostedAtDesc(left.postedOn ?? null, right.postedOn ?? null),
      )
      .slice(0, PERSONIO_WATCHLIST_MAX_JOBS)
      .map((job) => ({
        jobRef: job.jobUrl,
        source,
        sourceJobId: job.externalId,
        sourceType: input.source.sourceType,
        title: job.title,
        employer: input.source.label,
        jobUrl: job.jobUrl,
        applicationLink: job.jobUrl,
        location: job.locationText ?? null,
        postedAt: job.postedOn ?? null,
      }));

    return {
      total: response.total,
      fetched: jobs.length,
      jobs,
    };
  },
  async fetchJobDetails(input) {
    const job = await findJobByRef(input.source.careersUrl, input.jobRef, input.signal);
    return {
      jobRef: input.jobRef,
      jobUrl: job.jobUrl,
      descriptionHtml: job.jobDescriptionHtml,
    };
  },
  async prepareImportDraft(input) {
    const job = await findJobByRef(input.source.careersUrl, input.jobRef, input.signal);
    const source = personioUrlToSourceKey(input.source.careersUrl);
    const draft = buildManualDraft(input.source, source, job);

    return {
      draft,
      source: draft.source ?? null,
      sourceHost:
        getSourceHost(input.source.careersUrl) ?? getSourceHost(input.jobRef),
    };
  },
};

async function findJobByRef(
  careersUrl: string,
  jobRef: string,
  signal?: AbortSignal,
): Promise<NormalizedPersonioJob> {
  const jobId = parsePersonioJobUrl(jobRef).jobId;
  const response = await getJobsFromFeed({ careersUrl, signal });
  const job = response.jobs.find((candidate) => candidate.externalId === jobId);
  if (!job) {
    throw new Error(`Personio job ${jobId} was not found in the feed for ${careersUrl}.`);
  }
  return job;
}

function getHydratedPersonioLabel(source: {
  sourceType: string;
  label: string;
  careersUrl: string;
}): string {
  if (
    source.sourceType === "personio" &&
    (!source.label.trim() || source.label.trim() === source.careersUrl.trim())
  ) {
    return personioUrlToCompanyLabel(source.careersUrl);
  }
  return source.label;
}

function buildManualDraft(
  selectedSource: WatchlistSelectedSource,
  source: string,
  job: NormalizedPersonioJob,
): ManualJobDraft {
  return {
    source,
    sourceJobId: job.externalId,
    title: job.title,
    employer: selectedSource.label,
    jobUrl: job.jobUrl,
    applicationLink: job.jobUrl,
    location: job.locationText,
    jobDescription: job.jobDescriptionText,
    jobType: job.schedule ?? job.employmentType,
  };
}

function getSourceHost(value: string): string | null {
  try {
    return new URL(value).hostname || null;
  } catch {
    return null;
  }
}

function comparePostedAtDesc(left: string | null, right: string | null): number {
  const leftTime = left ? Date.parse(left) : Number.NaN;
  const rightTime = right ? Date.parse(right) : Number.NaN;
  const leftValid = Number.isFinite(leftTime);
  const rightValid = Number.isFinite(rightTime);

  if (leftValid && rightValid) return rightTime - leftTime;
  if (leftValid) return -1;
  if (rightValid) return 1;
  return 0;
}
```

Note: `personioUrlToJobUrl` is imported for parity with the package surface but is referenced indirectly through `getJobsFromFeed`'s normalized output. If biome flags it as unused, remove it from the import list.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm --workspace orchestrator run test:run -- src/server/watchlist/adapters/personio.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add orchestrator/src/server/watchlist/adapters/personio.ts orchestrator/src/server/watchlist/adapters/personio.test.ts orchestrator/src/server/config/career-boards-personio.json orchestrator/tsconfig.json
git commit -m "feat(personio): add watchlist adapter, empty catalog, and tsconfig aliases"
```

---

## Task 4: Register the adapter

**Files:**
- Modify: `orchestrator/src/server/watchlist/adapters/index.ts`

**Interfaces:**
- Consumes: `personioWatchlistAdapter` from `./personio`.

- [ ] **Step 1: Add the import and registration**

Modify `orchestrator/src/server/watchlist/adapters/index.ts`:

After the `import { workdayWatchlistAdapter } from "./workday";` line, add:

```typescript
import { personioWatchlistAdapter } from "./personio";
```

Change the adapters tuple from:

```typescript
const adapters = [workdayWatchlistAdapter, bamboohrWatchlistAdapter] as const;
```

to:

```typescript
const adapters = [
  workdayWatchlistAdapter,
  bamboohrWatchlistAdapter,
  personioWatchlistAdapter,
] as const;
```

- [ ] **Step 2: Verify the catalog loader picks up Personio**

Run: `npm --workspace orchestrator run test:run -- src/server/watchlist`
Expected: PASS. If any test snapshots `listWatchlistSourceAdapters` / available source types, update the snapshot to include `personio` (run with `-u` only if a snapshot mismatch is the sole failure, then re-run without `-u`).

- [ ] **Step 3: Commit**

```bash
git add orchestrator/src/server/watchlist/adapters/index.ts
git commit -m "feat(personio): register personio watchlist adapter"
```

---

## Task 5: Full CI-parity validation and manual smoke test

**Files:** none (verification only).

- [ ] **Step 1: Run the full CI-parity suite**

Run each, expecting success:

```bash
./orchestrator/node_modules/.bin/biome ci .
npm run check:types:shared
npm --workspace orchestrator run check:types
npm --workspace orchestrator run build:client
npm --workspace orchestrator run test:run
```

Expected: all pass. If `better-sqlite3` ABI error appears, run `npm --workspace orchestrator rebuild better-sqlite3` and re-run `test:run`.

- [ ] **Step 2: Manual smoke test**

Run: `npm --workspace orchestrator run dev`
Then in the Watchlist UI:
1. Add a source → choose "Personio" → "Choose your own Personio URL".
2. Enter `https://syte-gmbh.jobs.personio.com/`.
3. Confirm the company is added with label "Syte Gmbh" and jobs list.
4. Open a job's details — confirm the description renders.
5. Prepare an import draft — confirm title, employer, location, description populate.

Record the outcome (pass/fail with notes) in the PR description.

- [ ] **Step 3: Final commit (if any snapshot/lint fixups were needed)**

```bash
git add -A
git commit -m "chore(personio): validation fixups"
```

(Skip if nothing changed.)

---

## Self-Review Notes

- **Spec coverage:** package (Tasks 1–2), adapter + descriptor + catalog (Task 3), tsconfig aliases (Task 3 Step 1), registration (Task 4), tests for the four CONTRIBUTING-mandated cases — catalog parse (T3), URL validation (T1), job identity (T1 `personioUrlToSourceKey`/`personioUrlToJobUrl` + T3 fetchJobs), import draft (T3) — all present. Branding deliberately absent (`supportsBranding: false`). Validation in Task 5.
- **No new dependency:** XML parsed by hand-rolled parser in `personio-feed.ts`.
- **Type consistency:** `NormalizedPersonioJob` defined in Task 2 is consumed unchanged in Task 3; `getJobsFromFeed` signature matches between definition and use; `personioUrlToSourceKey` returns `personio:<slug>` consistently.
- **Known nuance:** `fetchJobDetails`/`prepareImportDraft` re-fetch the whole feed and select by id (Personio has no per-job JSON endpoint). Acceptable — one request, same pattern the spec approved.
