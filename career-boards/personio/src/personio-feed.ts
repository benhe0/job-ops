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
  const scalars = stripSubtree(position, "jobDescriptions");
  const externalId = getTagText(scalars, "id");
  const title = getTagText(scalars, "name");
  if (!externalId || !title) return null;

  const descriptionHtml = buildDescriptionHtml(position);

  return {
    source: "personio",
    externalId,
    title,
    jobUrl: personioUrlToJobUrl(source.canonicalCareersUrl, externalId),
    locationText: buildLocationText(scalars),
    department: getTagText(scalars, "department"),
    employmentType: getTagText(scalars, "employmentType"),
    schedule: getTagText(scalars, "schedule"),
    seniority: getTagText(scalars, "seniority"),
    postedOn: getTagText(scalars, "createdAt"),
    jobDescriptionHtml: descriptionHtml,
    jobDescriptionText: htmlToText(descriptionHtml),
  };
}

function stripSubtree(source: string, tag: string): string {
  return source.replace(
    new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?</${tag}>`, "g"),
    "",
  );
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
  const cdata = /^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/.exec(value);
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
