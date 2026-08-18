import { acceptsFreeFormBody, findUnknownFlags, formatUnknownFlagsError } from "../src/command-args";
import { CliCommand } from "../src/openapi-to-commands";

function makeCommand(overrides: Partial<CliCommand>): CliCommand {
  return {
    name: "widgets_id",
    method: "get",
    path: "/widgets/{id}",
    options: [],
    ...overrides,
  };
}

const getWithExpand = makeCommand({
  options: [
    { name: "id", location: "path", required: true, schemaType: "string" },
    { name: "$expand", location: "query", required: false, schemaType: "string" },
  ],
});

describe("command-args", () => {
  describe("acceptsFreeFormBody", () => {
    it("is true for a POST command that declares no body options", () => {
      const command = makeCommand({
        method: "post",
        options: [{ name: "org_slug", location: "path", required: true, schemaType: "string" }],
      });

      expect(acceptsFreeFormBody(command)).toBe(true);
    });

    it("is false for a GET command", () => {
      expect(acceptsFreeFormBody(getWithExpand)).toBe(false);
    });

    it("is false for a POST command with a declared request body schema", () => {
      const command = makeCommand({
        method: "post",
        options: [{ name: "event_type", location: "body", required: true, schemaType: "string" }],
      });

      expect(acceptsFreeFormBody(command)).toBe(false);
    });

    it("is false for a POST command with declared formData parameters", () => {
      const command = makeCommand({
        method: "post",
        options: [{ name: "title", location: "formData", required: true, schemaType: "string" }],
      });

      expect(acceptsFreeFormBody(command)).toBe(false);
    });
  });

  describe("findUnknownFlags", () => {
    it("reports a flag that the command does not declare", () => {
      const unknown = findUnknownFlags(getWithExpand, ["id", "bogus"]);

      expect(unknown).toEqual([{ name: "bogus" }]);
    });

    it("suggests the declared option when only the $ prefix is missing", () => {
      const unknown = findUnknownFlags(getWithExpand, ["id", "expand"]);

      expect(unknown).toEqual([{ name: "expand", suggestion: "$expand" }]);
    });

    it("suggests the declared option for a small typo", () => {
      const command = makeCommand({
        options: [{ name: "workflow_name", location: "query", required: false, schemaType: "string" }],
      });

      const unknown = findUnknownFlags(command, ["workflow_nme"]);

      expect(unknown).toEqual([{ name: "workflow_nme", suggestion: "workflow_name" }]);
    });

    it("accepts declared options in every parameter location", () => {
      const command = makeCommand({
        options: [
          { name: "id", location: "path", required: true, schemaType: "string" },
          { name: "limit", location: "query", required: false, schemaType: "integer" },
          { name: "X-Request-Id", location: "header", required: false, schemaType: "string" },
          { name: "session_id", location: "cookie", required: false, schemaType: "string" },
        ],
      });

      expect(findUnknownFlags(command, ["id", "limit", "X-Request-Id", "session_id"])).toEqual([]);
    });

    it("allows undeclared flags when the command carries a free-form request body", () => {
      const command = makeCommand({
        method: "post",
        options: [{ name: "org_slug", location: "path", required: true, schemaType: "string" }],
      });

      expect(findUnknownFlags(command, ["org_slug", "revision", "tags"])).toEqual([]);
    });

    it("reports undeclared flags when the command declares body properties", () => {
      const command = makeCommand({
        method: "post",
        options: [
          { name: "event_type", location: "body", required: true, schemaType: "string" },
          { name: "draft", location: "body", required: false, schemaType: "boolean" },
        ],
      });

      expect(findUnknownFlags(command, ["event_type", "drafts"])).toEqual([
        { name: "drafts", suggestion: "draft" },
      ]);
    });

    it("reports every unknown flag, in the order they were passed", () => {
      const unknown = findUnknownFlags(getWithExpand, ["typo", "id", "bogus"]);

      expect(unknown.map((flag) => flag.name)).toEqual(["typo", "bogus"]);
    });
  });

  describe("formatUnknownFlagsError", () => {
    it("mentions the flag and points at the command help", () => {
      const message = formatUnknownFlagsError("widgets_id", [{ name: "bogus" }]);

      expect(message).toContain("--bogus");
      expect(message).toContain("ocli widgets_id --help");
    });

    it("includes the suggestion when one is available", () => {
      const message = formatUnknownFlagsError("widgets_id", [{ name: "expand", suggestion: "$expand" }]);

      expect(message).toContain("--expand");
      expect(message).toContain("--$expand");
    });

    it("lists all unknown flags at once", () => {
      const message = formatUnknownFlagsError("widgets_id", [{ name: "bogus" }, { name: "typo" }]);

      expect(message).toContain("--bogus");
      expect(message).toContain("--typo");
    });
  });
});
