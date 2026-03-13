import { CommandSearch } from "../src/command-search";
import { CliCommand } from "../src/openapi-to-commands";

const commands: CliCommand[] = [
  {
    name: "messages_get",
    method: "get",
    path: "/api/v1/messages",
    options: [
      { name: "limit", location: "query", required: false, schemaType: "integer", description: "Number of messages" },
      { name: "cursor", location: "query", required: false, schemaType: "string" },
    ],
    description: "List all messages",
  },
  {
    name: "messages_post",
    method: "post",
    path: "/api/v1/messages",
    options: [],
    description: "Send a new message",
  },
  {
    name: "channels_get",
    method: "get",
    path: "/api/v1/channels",
    options: [],
    description: "List available channels",
  },
  {
    name: "users_me_get",
    method: "get",
    path: "/api/v1/users/me",
    options: [],
    description: "Get current user profile",
  },
  {
    name: "files_upload_post",
    method: "post",
    path: "/api/v1/files/upload",
    options: [],
    description: "Upload a file",
  },
  {
    name: "admin_metrics_get",
    method: "get",
    path: "/api/v1/admin/metrics",
    options: [],
    description: "Get system metrics and statistics",
  },
  {
    name: "conversations_conversation_id_get",
    method: "get",
    path: "/api/v1/conversations/{conversation_id}",
    options: [{ name: "conversation_id", location: "path", required: true, schemaType: "string" }],
    description: "Get a specific conversation",
  },
];

describe("CommandSearch", () => {
  let searcher: CommandSearch;

  beforeEach(() => {
    searcher = new CommandSearch();
    searcher.load(commands);
  });

  describe("BM25 search", () => {
    it("finds commands by keyword", () => {
      const results = searcher.search("messages");
      expect(results.length).toBeGreaterThan(0);
      const names = results.map((r) => r.name);
      expect(names).toContain("messages_get");
      expect(names).toContain("messages_post");
    });

    it("finds by description text", () => {
      const results = searcher.search("upload file");
      expect(results[0].name).toBe("files_upload_post");
    });

    it("finds by natural language query", () => {
      const results = searcher.search("system metrics statistics");
      expect(results[0].name).toBe("admin_metrics_get");
    });

    it("returns empty for no match", () => {
      const results = searcher.search("xyzzy_nonexistent");
      expect(results).toEqual([]);
    });

    it("respects limit", () => {
      const results = searcher.search("get", 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it("includes score in results", () => {
      const results = searcher.search("messages");
      for (const r of results) {
        expect(r.score).toBeGreaterThan(0);
      }
    });

    it("returns method in uppercase", () => {
      const results = searcher.search("messages");
      for (const r of results) {
        expect(r.method).toBe(r.method.toUpperCase());
      }
    });
  });

  describe("regex search", () => {
    it("matches by command name", () => {
      const results = searcher.searchRegex("messages");
      const names = results.map((r) => r.name);
      expect(names).toContain("messages_get");
      expect(names).toContain("messages_post");
    });

    it("matches by path", () => {
      const results = searcher.searchRegex("admin");
      expect(results[0].name).toBe("admin_metrics_get");
    });

    it("matches by description", () => {
      const results = searcher.searchRegex("upload");
      expect(results[0].name).toBe("files_upload_post");
    });

    it("case insensitive", () => {
      const results = searcher.searchRegex("MESSAGES");
      expect(results.length).toBeGreaterThan(0);
    });

    it("respects limit", () => {
      const results = searcher.searchRegex("get", 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it("returns empty for no match", () => {
      const results = searcher.searchRegex("xyzzy_impossible");
      expect(results).toEqual([]);
    });
  });

  describe("edge cases", () => {
    it("returns empty when not loaded", () => {
      const empty = new CommandSearch();
      expect(empty.search("anything")).toEqual([]);
      expect(empty.searchRegex("anything")).toEqual([]);
    });
  });
});
