import * as fs from "fs";
import * as path from "path";
import yaml from "js-yaml";
import { OpenapiToCommands, CliCommand } from "../src/openapi-to-commands";
import { CommandSearch } from "../src/command-search";
import { Profile } from "../src/profile-store";

// Load YAML spec — tests YAML format support
const specPath = path.join(__dirname, "fixtures", "box-openapi.yaml");
const fixtureExists = fs.existsSync(specPath);
const spec = fixtureExists
  ? (yaml.load(fs.readFileSync(specPath, "utf-8")) as Record<string, unknown>)
  : ({} as Record<string, unknown>);

const profile: Profile = {
  name: "box",
  apiBaseUrl: "https://api.box.com/2.0",
  apiBasicAuth: "",
  apiBearerToken: "",
  openapiSpecSource: "",
  openapiSpecCache: "",
  includeEndpoints: [],
  excludeEndpoints: [],
};

const describeIfFixture = fixtureExists ? describe : describe.skip;

describeIfFixture("Box API — YAML spec (258 endpoints)", () => {
  let commands: CliCommand[];
  let searcher: CommandSearch;

  beforeAll(() => {
    commands = new OpenapiToCommands().buildCommands(spec, profile);
    searcher = new CommandSearch();
    searcher.load(commands);
  });

  describe("YAML spec parsing", () => {
    it("parses 250+ endpoints from YAML", () => {
      expect(commands.length).toBeGreaterThan(250);
    });

    it("generates unique command names", () => {
      const names = new Set(commands.map((c) => c.name));
      expect(names.size).toBe(commands.length);
    });

    it("every command has valid fields", () => {
      for (const cmd of commands) {
        expect(cmd.name).toBeTruthy();
        expect(cmd.method).toMatch(/^(get|post|put|delete|patch|head|options)$/);
        expect(cmd.path).toMatch(/^\//);
      }
    });

    it("preserves descriptions from YAML", () => {
      const withDesc = commands.filter((c) => c.description);
      expect(withDesc.length).toBeGreaterThan(100);
    });
  });

  describe("BM25 search on YAML-loaded spec", () => {
    it("finds file operations", () => {
      const results = searcher.search("upload file", 5);
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.path.includes("file"))).toBe(true);
    });

    it("finds folder operations", () => {
      const results = searcher.search("create folder items", 5);
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.path.includes("folder"))).toBe(true);
    });

    it("finds collaboration endpoints", () => {
      const results = searcher.search("collaboration invite share", 5);
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.path.includes("collaborat"))).toBe(true);
    });

    it("finds comment endpoints", () => {
      const results = searcher.search("comment on file", 5);
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.path.includes("comment"))).toBe(true);
    });

    it("finds user/group management", () => {
      const results = searcher.search("user group membership", 5);
      expect(results.length).toBeGreaterThan(0);
    });

    it("finds webhook/event endpoints", () => {
      const results = searcher.search("webhook event notification", 5);
      expect(results.length).toBeGreaterThan(0);
    });

    it("finds metadata endpoints", () => {
      const results = searcher.search("metadata template", 5);
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.path.includes("metadata"))).toBe(true);
    });
  });

  describe("regex search on YAML-loaded spec", () => {
    it("finds all file-related endpoints", () => {
      const results = searcher.searchRegex("/files/", 100);
      expect(results.length).toBeGreaterThan(10);
    });

    it("finds all folder-related endpoints", () => {
      const results = searcher.searchRegex("/folders/", 100);
      expect(results.length).toBeGreaterThan(5);
    });
  });
});
