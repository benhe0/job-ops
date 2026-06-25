import { describe, expect, it } from "vitest";
import { getJobsFromFeed, parsePersonioFeed } from "./personio-feed";
import { parsePersonioUrl } from "./personio-url";

const SOURCE = parsePersonioUrl("https://syte-gmbh.jobs.personio.com/");

const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<workzag-jobs>
<position>
    <id>2659296</id>
    <subcompany>syte GmbH</subcompany>
    <office>Remote</office>
    <additionalOffices>
        <office>Münster</office>
        <office>Hybrid</office>
    </additionalOffices>
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
      locationText: "Remote, Münster, Hybrid",
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

  it("reads position-level title and id even when jobDescriptions precedes them", () => {
    const xml = `<workzag-jobs>
<position>
    <jobDescriptions>
        <jobDescription>
            <name>Section Heading</name>
            <value><![CDATA[<p>Body</p>]]></value>
        </jobDescription>
    </jobDescriptions>
    <id>9001</id>
    <name>Real Title</name>
</position>
</workzag-jobs>`;
    const [job] = parsePersonioFeed(xml, SOURCE);
    expect(job.title).toBe("Real Title");
    expect(job.externalId).toBe("9001");
    expect(job.jobDescriptionHtml).toContain("<h3>Section Heading</h3>");
  });

  it("decodes numeric and hex HTML entities in scalar fields", () => {
    const xml = `<workzag-jobs>
<position>
    <id>7</id>
    <office>M&#252;nster</office>
    <name>Caf&#233; Manager &#x2014; Team Lead</name>
</position>
</workzag-jobs>`;
    const [job] = parsePersonioFeed(xml, SOURCE);
    expect(job.title).toBe("Café Manager — Team Lead");
    expect(job.locationText).toBe("Münster");
  });

  it("throws when a non-empty feed yields zero parseable positions", () => {
    const xml = `<workzag-jobs><position><name>No Id</name></position></workzag-jobs>`;
    expect(() => parsePersonioFeed(xml, SOURCE)).toThrow();
  });

  it("flattens nested <office> elements inside additionalOffices without leaking tags", () => {
    const xml = `<workzag-jobs>
<position>
    <id>10</id>
    <office>Münster</office>
    <additionalOffices>
        <office>Münster</office>
        <office>Remote Berlin</office>
        <office>Hybrid</office>
    </additionalOffices>
    <name>Job</name>
    <jobDescriptions></jobDescriptions>
</position>
</workzag-jobs>`;
    const [job] = parsePersonioFeed(xml, SOURCE);
    expect(job.locationText).toBe("Münster, Remote Berlin, Hybrid");
    expect(job.locationText).not.toContain("<office>");
  });

  it("tolerates a flat additionalOffices text value", () => {
    const xml = `<workzag-jobs>
<position>
    <id>11</id>
    <office>Remote</office>
    <additionalOffices>Berlin</additionalOffices>
    <name>Job</name>
    <jobDescriptions></jobDescriptions>
</position>
</workzag-jobs>`;
    const [job] = parsePersonioFeed(xml, SOURCE);
    expect(job.locationText).toBe("Remote, Berlin");
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
