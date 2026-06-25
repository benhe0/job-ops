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

  constructor(code: PersonioUrlParseErrorCode, message: string, input: string) {
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
  const maybeJobId = jobIndex >= 0 ? segments[jobIndex + 1] : undefined;

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
