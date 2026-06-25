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
