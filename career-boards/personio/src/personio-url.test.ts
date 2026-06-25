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
    expect(
      parsePersonioUrl("https://syte-gmbh.jobs.personio.com/"),
    ).toMatchObject({
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
    expect(personioUrlToSourceKey("https://syte-gmbh.jobs.personio.com/")).toBe(
      "personio:syte-gmbh",
    );
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

  it("rejects a numeric trailing segment that is not under /job/", () => {
    expect(() =>
      parsePersonioJobUrl("https://syte-gmbh.jobs.personio.com/careers/42"),
    ).toThrow();
  });
});
