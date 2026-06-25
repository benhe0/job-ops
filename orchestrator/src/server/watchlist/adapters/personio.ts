import {
  getJobsFromFeed,
  type NormalizedPersonioJob,
  parsePersonioJobUrl,
  parsePersonioUrl,
  personioUrlToCompanyLabel,
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
    const canonicalCareersUrl = parsePersonioUrl(
      input.careersUrl,
    ).canonicalCareersUrl;
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
    const job = await findJobByRef(
      input.source.careersUrl,
      input.jobRef,
      input.signal,
    );
    return {
      jobRef: input.jobRef,
      jobUrl: job.jobUrl,
      descriptionHtml: job.jobDescriptionHtml,
    };
  },
  async prepareImportDraft(input) {
    const job = await findJobByRef(
      input.source.careersUrl,
      input.jobRef,
      input.signal,
    );
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
    throw new Error(
      `Personio job ${jobId} was not found in the feed for ${careersUrl}.`,
    );
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

function comparePostedAtDesc(
  left: string | null,
  right: string | null,
): number {
  const leftTime = left ? Date.parse(left) : Number.NaN;
  const rightTime = right ? Date.parse(right) : Number.NaN;
  const leftValid = Number.isFinite(leftTime);
  const rightValid = Number.isFinite(rightTime);

  if (leftValid && rightValid) return rightTime - leftTime;
  if (leftValid) return -1;
  if (rightValid) return 1;
  return 0;
}
