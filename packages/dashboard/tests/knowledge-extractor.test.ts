import { describe, it, expect } from "vitest";

describe("parseClassifiedFacts", () => {
  it("parses all 7 classification categories", async () => {
    const { parseClassifiedFacts } = await import(
      "../src/conversations/knowledge-extractor.js"
    );

    const raw = `[PERMANENT:user-info] Has two daughters, Noa (5) and Maya (3)
[PERMANENT:contact] Kai -- tour guide in Chiang Mai, hotel concierge referral
[PERMANENT:preference:personal] Loves pad krapao, prefers spicy
[PERMANENT:preference:work] Uses TypeScript, prefers functional patterns over OOP
[PERMANENT:preference:communication] Prefers casual tone in Hebrew
[TEMPORAL] Series A deal signing Tuesday March 18
[TEMPORAL] Flight to Krabi on March 20, returning to Tel Aviv March 25
[PROPERTY:location:high] Currently in Chiang Mai, Thailand
[PROPERTY:availability:medium] On vacation until late March`;

    const result = parseClassifiedFacts(raw);

    expect(result.permanent).toHaveLength(5);
    expect(result.temporal).toHaveLength(2);
    expect(result.properties).toHaveLength(2);

    const userInfo = result.permanent.find((f) => f.subcategory === "user-info");
    expect(userInfo?.text).toContain("two daughters");

    const contact = result.permanent.find((f) => f.subcategory === "contact");
    expect(contact?.text).toContain("Kai");

    const prefPersonal = result.permanent.find(
      (f) => f.subcategory === "preference:personal"
    );
    expect(prefPersonal?.text).toContain("pad krapao");

    const location = result.properties.find((p) => p.key === "location");
    expect(location?.value).toContain("Chiang Mai");
    expect(location?.confidence).toBe("high");
  });

  it("handles NO_FACTS response", async () => {
    const { parseClassifiedFacts } = await import(
      "../src/conversations/knowledge-extractor.js"
    );

    const result = parseClassifiedFacts("NO_FACTS");
    expect(result.permanent).toHaveLength(0);
    expect(result.temporal).toHaveLength(0);
    expect(result.properties).toHaveLength(0);
  });

  it("handles empty/malformed input", async () => {
    const { parseClassifiedFacts } = await import(
      "../src/conversations/knowledge-extractor.js"
    );

    expect(parseClassifiedFacts("").permanent).toHaveLength(0);
    expect(parseClassifiedFacts("random text\nno categories").permanent).toHaveLength(0);
  });

  it("ignores lines without classification prefix", async () => {
    const { parseClassifiedFacts } = await import(
      "../src/conversations/knowledge-extractor.js"
    );

    const raw = `Some preamble text
[TEMPORAL] Flight to Krabi
More random text`;

    const result = parseClassifiedFacts(raw);
    expect(result.temporal).toHaveLength(1);
    expect(result.permanent).toHaveLength(0);
  });

  it("parses timezone property with medium confidence", async () => {
    const { parseClassifiedFacts } = await import(
      "../src/conversations/knowledge-extractor.js"
    );

    const raw = `[PROPERTY:timezone:medium] Asia/Bangkok (inferred from Chiang Mai location)`;

    const result = parseClassifiedFacts(raw);
    expect(result.properties).toHaveLength(1);
    const tz = result.properties[0];
    expect(tz.key).toBe("timezone");
    expect(tz.confidence).toBe("medium");
    expect(tz.value).toContain("Asia/Bangkok");
  });

  it("parses timezone alongside location in same response", async () => {
    const { parseClassifiedFacts } = await import(
      "../src/conversations/knowledge-extractor.js"
    );

    const raw = `[PROPERTY:location:high] Currently in Chiang Mai, Thailand
[PROPERTY:timezone:medium] Asia/Bangkok (inferred from Chiang Mai location)`;

    const result = parseClassifiedFacts(raw);
    expect(result.properties).toHaveLength(2);

    const location = result.properties.find((p) => p.key === "location");
    expect(location?.confidence).toBe("high");

    const tz = result.properties.find((p) => p.key === "timezone");
    expect(tz?.confidence).toBe("medium");
    expect(tz?.value).toContain("Asia/Bangkok");
  });
});

describe("routeFacts", () => {
  it("routes permanent facts to staging", async () => {
    const { routeFacts, parseClassifiedFacts } = await import(
      "../src/conversations/knowledge-extractor.js"
    );

    const parsed = parseClassifiedFacts("[PERMANENT:user-info] Has two daughters");
    const routes = routeFacts(parsed);

    expect(routes.staging).toHaveLength(1);
    expect(routes.staging[0].text).toContain("two daughters");
  });

  it("routes temporal facts to daily log", async () => {
    const { routeFacts, parseClassifiedFacts } = await import(
      "../src/conversations/knowledge-extractor.js"
    );

    const parsed = parseClassifiedFacts("[TEMPORAL] Flight to Krabi March 20");
    const routes = routeFacts(parsed);

    expect(routes.dailyLog).toHaveLength(1);
  });

  it("routes properties to status.yaml", async () => {
    const { routeFacts, parseClassifiedFacts } = await import(
      "../src/conversations/knowledge-extractor.js"
    );

    const parsed = parseClassifiedFacts("[PROPERTY:location:high] Currently in Chiang Mai");
    const routes = routeFacts(parsed);

    expect(routes.properties).toHaveLength(1);
    expect(routes.properties[0].key).toBe("location");
    expect(routes.properties[0].confidence).toBe("high");
  });
});
