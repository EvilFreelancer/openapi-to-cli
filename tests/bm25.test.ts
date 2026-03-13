import { BM25Engine } from "../src/bm25";

interface Doc {
  name: string;
  body: string;
}

function makeEngine(docs: Doc[]) {
  return new BM25Engine(docs, (d) => d.name + " " + d.body);
}

describe("BM25Engine", () => {
  const corpus: Doc[] = [
    { name: "messages_get", body: "List all messages in a channel" },
    { name: "messages_post", body: "Send a new message to a channel" },
    { name: "channels_list", body: "List all available channels" },
    { name: "users_get", body: "Get user profile information" },
    { name: "users_update", body: "Update user profile settings" },
    { name: "files_upload", body: "Upload a file attachment" },
    { name: "admin_stats", body: "Get system statistics and metrics" },
  ];

  it("returns empty for empty query", () => {
    const engine = makeEngine(corpus);
    expect(engine.search("", 5)).toEqual([]);
    expect(engine.search("   ", 5)).toEqual([]);
  });

  it("returns empty for topK <= 0", () => {
    const engine = makeEngine(corpus);
    expect(engine.search("messages", 0)).toEqual([]);
    expect(engine.search("messages", -1)).toEqual([]);
  });

  it("returns empty for empty corpus", () => {
    const engine = makeEngine([]);
    expect(engine.search("messages", 5)).toEqual([]);
  });

  it("finds relevant documents by keyword", () => {
    const engine = makeEngine(corpus);
    const results = engine.search("messages", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].document.name).toMatch(/^messages_/);
  });

  it("ranks exact matches higher", () => {
    const engine = makeEngine(corpus);
    const results = engine.search("upload file", 5);
    expect(results[0].document.name).toBe("files_upload");
  });

  it("respects topK limit", () => {
    const engine = makeEngine(corpus);
    const results = engine.search("user", 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("results are sorted by score descending", () => {
    const engine = makeEngine(corpus);
    const results = engine.search("channel messages list", 5);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it("finds by multi-word query", () => {
    const engine = makeEngine(corpus);
    const results = engine.search("system statistics", 3);
    expect(results[0].document.name).toBe("admin_stats");
  });

  it("handles no-match query", () => {
    const engine = makeEngine(corpus);
    const results = engine.search("zzzzxyzzy", 5);
    expect(results).toEqual([]);
  });
});
