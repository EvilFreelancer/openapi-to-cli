import * as fs from "fs";
import * as path from "path";
import { OpenapiToCommands, CliCommand } from "../src/openapi-to-commands";
import { CommandSearch } from "../src/command-search";
import { Profile } from "../src/profile-store";

const specPath = path.join(__dirname, "fixtures", "github-openapi.json");
const fixtureExists = fs.existsSync(specPath);
const spec = fixtureExists ? JSON.parse(fs.readFileSync(specPath, "utf-8")) : {};

const profile: Profile = {
  name: "github",
  apiBaseUrl: "https://api.github.com",
  apiBasicAuth: "",
  apiBearerToken: "",
  openapiSpecSource: "",
  openapiSpecCache: "",
  includeEndpoints: [],
  excludeEndpoints: [],
};

const describeIfFixture = fixtureExists ? describe : describe.skip;

describeIfFixture("GitHub API (845 endpoints)", () => {
  let commands: CliCommand[];
  let searcher: CommandSearch;

  beforeAll(() => {
    commands = new OpenapiToCommands().buildCommands(spec, profile);
    searcher = new CommandSearch();
    searcher.load(commands);
  });

  describe("spec parsing", () => {
    it("parses 800+ endpoints", () => {
      expect(commands.length).toBeGreaterThan(800);
    });

    it("generates unique command names", () => {
      const names = new Set(commands.map((c) => c.name));
      expect(names.size).toBe(commands.length);
    });
  });

  describe("BM25 search at scale (845 endpoints)", () => {
    it("finds repository endpoints", () => {
      const results = searcher.search("list repositories for user", 5);
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.path.includes("/repos"))).toBe(true);
    });

    it("finds pull request endpoints", () => {
      const results = searcher.search("pull request review comments", 5);
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.path.includes("pulls") || r.path.includes("pull"))).toBe(true);
    });

    it("finds issues endpoints", () => {
      const results = searcher.search("create issue labels", 5);
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.path.includes("issues") || r.path.includes("labels"))).toBe(true);
    });

    it("finds git operations", () => {
      const results = searcher.search("git commit tree blob", 5);
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.path.includes("/git/"))).toBe(true);
    });

    it("finds actions/workflow endpoints", () => {
      const results = searcher.search("actions workflow runs jobs", 5);
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.path.includes("actions"))).toBe(true);
    });

    it("finds user/org endpoints", () => {
      const results = searcher.search("organization members teams", 5);
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.path.includes("org") || r.path.includes("teams") || r.path.includes("members"))).toBe(true);
    });

    it("finds gist endpoints", () => {
      const results = searcher.search("gist star fork", 5);
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.path.includes("gist"))).toBe(true);
    });

    it("returns results fast on 845 endpoints", () => {
      const start = Date.now();
      for (let i = 0; i < 10; i++) {
        searcher.search("deployment environment status", 5);
      }
      const elapsed = Date.now() - start;
      // 10 searches on 845 endpoints should take < 2s
      expect(elapsed).toBeLessThan(2000);
    });

    it("limits results correctly", () => {
      const results = searcher.search("get", 3);
      expect(results.length).toBe(3);
    });
  });

  describe("regex search at scale", () => {
    it("finds all repos endpoints by path", () => {
      const results = searcher.searchRegex("/repos/\\{owner\\}/\\{repo\\}/", 500);
      expect(results.length).toBeGreaterThan(100);
    });

    it("finds webhook endpoints", () => {
      const results = searcher.searchRegex("webhook|hook", 50);
      expect(results.length).toBeGreaterThan(5);
    });
  });
});
