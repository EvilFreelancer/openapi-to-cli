import { Profile } from "../src/profile-store";
import { OpenapiToCommands, CliCommand, OpenapiSpecLike } from "../src/openapi-to-commands";

const baseProfile: Profile = {
  name: "myapi",
  apiBaseUrl: "http://127.0.0.1:3000",
  apiBasicAuth: "",
  apiBearerToken: "",
  openapiSpecSource: "",
  openapiSpecCache: "/home/user/.ocli/specs/myapi.json",
  includeEndpoints: [],
  excludeEndpoints: [],
  commandPrefix: "",
  customHeaders: {},
};

describe("OpenapiToCommands", () => {
  const openapiToCommands = new OpenapiToCommands();

  it("builds command names from paths and methods", () => {
    const spec: OpenapiSpecLike = {
      openapi: "3.0.0",
      paths: {
        "/messages": {
          get: {
            operationId: "listMessages",
            summary: "List messages",
          },
          post: {
            operationId: "createMessage",
            description: "Create a message",
          },
        },
        "/channels/{username}": {
          get: {
            operationId: "getChannelByUsername",
            summary: "Get channel by username",
          },
        },
      },
    };

    const profile: Profile = {
      ...baseProfile,
      includeEndpoints: [],
      excludeEndpoints: [],
      commandPrefix: "",
      customHeaders: {},
    };

    const commands: CliCommand[] = openapiToCommands.buildCommands(spec, profile);

    const names = commands.map((c: CliCommand) => c.name).sort();
    expect(names).toEqual(["channels_username", "messages_get", "messages_post"]);

    const byName: Record<string, CliCommand> = {};
    for (const cmd of commands) {
      byName[cmd.name] = cmd;
    }

    expect(byName.messages_get.description).toBe("List messages");
    expect(byName.messages_post.description).toBe("Create a message");
    expect(byName.channels_username.description).toBe("Get channel by username");
  });

  it("honors include and exclude endpoint filters", () => {
    const spec: OpenapiSpecLike = {
      openapi: "3.0.0",
      paths: {
        "/messages": {
          get: {},
          post: {},
        },
        "/channels": {
          get: {},
        },
      },
    };

    const profile: Profile = {
      ...baseProfile,
      includeEndpoints: ["get:/messages"],
      excludeEndpoints: ["get:/channels"],
      commandPrefix: "",
      customHeaders: {},
    };

    const commands: CliCommand[] = openapiToCommands.buildCommands(spec, profile);

    const names = commands.map((c: CliCommand) => c.name).sort();
    expect(names).toEqual(["messages_get"]);
  });

  it("extracts simple path and query parameters into command options", () => {
    const spec: OpenapiSpecLike = {
      openapi: "3.0.0",
      paths: {
        "/channels/{username}": {
          get: {
            parameters: [
              {
                name: "username",
                in: "path",
                required: true,
                schema: { type: "string" },
                description: "Channel username",
              },
              {
                name: "limit",
                in: "query",
                required: false,
                schema: { type: "integer" },
                description: "Maximum number of items",
              },
            ],
          },
        },
      },
    };

    const profile: Profile = {
      ...baseProfile,
      includeEndpoints: [],
      excludeEndpoints: [],
      commandPrefix: "",
      customHeaders: {},
    };

    const commands: CliCommand[] = openapiToCommands.buildCommands(spec, profile);
    expect(commands).toHaveLength(1);

    const cmd: CliCommand = commands[0];
    const optionNames = cmd.options.map((o) => o.name).sort();
    expect(optionNames).toEqual(["limit", "username"]);

    const usernameOption = cmd.options.find((o) => o.name === "username");
    expect(usernameOption?.required).toBe(true);
    expect(usernameOption?.location).toBe("path");
    expect(usernameOption?.description).toBe("Channel username");
  });

  it("applies command prefix to all command names", () => {
    const spec: OpenapiSpecLike = {
      openapi: "3.0.0",
      paths: {
        "/messages": { get: { summary: "List messages" } },
        "/users": { get: { summary: "List users" } },
      },
    };

    const profile: Profile = {
      ...baseProfile,
      commandPrefix: "api_",
    };

    const commands = openapiToCommands.buildCommands(spec, profile);
    const names = commands.map((c) => c.name).sort();
    expect(names).toEqual(["api_messages", "api_users"]);
  });

  it("forces path parameters to be required even if spec says otherwise", () => {
    const spec: OpenapiSpecLike = {
      openapi: "3.0.0",
      paths: {
        "/users/{user_id}": {
          get: {
            parameters: [
              {
                name: "user_id",
                in: "path",
                required: false,
                schema: { type: "string" },
              },
            ],
          },
        },
      },
    };

    const commands = openapiToCommands.buildCommands(spec, baseProfile);
    const opt = commands[0].options.find((o) => o.name === "user_id");
    expect(opt?.required).toBe(true);
  });

  it("merges path-level and operation-level parameters", () => {
    const spec: OpenapiSpecLike = {
      openapi: "3.0.0",
      paths: {
        "/teams/{team_id}/members": {
          parameters: [
            {
              name: "team_id",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "Team ID",
            },
          ],
          get: {
            parameters: [
              {
                name: "limit",
                in: "query",
                schema: { type: "integer" },
              },
            ],
          },
        },
      },
    };

    const commands = openapiToCommands.buildCommands(spec, baseProfile);
    expect(commands).toHaveLength(1);
    expect(commands[0].options.map((o) => o.name).sort()).toEqual(["limit", "team_id"]);
  });

  it("resolves local parameter and requestBody refs", () => {
    const spec: OpenapiSpecLike = {
      openapi: "3.0.0",
      components: {
        parameters: {
          OrgSlug: {
            name: "org_slug",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        },
        requestBodies: {
          TriggerWorkflow: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["revision"],
                  properties: {
                    revision: { type: "string", description: "Git revision" },
                    draft: { type: "boolean" },
                  },
                },
              },
            },
          },
        },
      },
      paths: {
        "/orgs/{org_slug}/trigger": {
          post: {
            parameters: [
              { $ref: "#/components/parameters/OrgSlug" },
            ],
            requestBody: {
              $ref: "#/components/requestBodies/TriggerWorkflow",
            },
          },
        },
      },
    };

    const commands = openapiToCommands.buildCommands(spec, baseProfile);
    expect(commands).toHaveLength(1);
    expect(commands[0].requestContentType).toBe("application/json");
    expect(commands[0].options.map((o) => `${o.location}:${o.name}`).sort()).toEqual([
      "body:draft",
      "body:revision",
      "path:org_slug",
    ]);

    const revision = commands[0].options.find((o) => o.name === "revision");
    expect(revision?.required).toBe(true);
  });

  it("extracts Swagger 2 body and formData parameters", () => {
    const spec: OpenapiSpecLike = {
      swagger: "2.0",
      paths: {
        "/upload/{file_id}": {
          post: {
            consumes: ["multipart/form-data"],
            parameters: [
              {
                name: "file_id",
                in: "path",
                required: true,
                type: "string",
              },
              {
                name: "meta",
                in: "body",
                required: true,
                schema: {
                  type: "object",
                  required: ["title"],
                  properties: {
                    title: { type: "string" },
                    tags: { type: "array" },
                  },
                },
              },
              {
                name: "file",
                in: "formData",
                required: true,
                type: "string",
                description: "File contents",
              },
            ],
          },
        },
      },
    };

    const commands = openapiToCommands.buildCommands(spec, baseProfile);
    expect(commands).toHaveLength(1);
    expect(commands[0].requestContentType).toBe("multipart/form-data");
    expect(commands[0].options.map((o) => `${o.location}:${o.name}`).sort()).toEqual([
      "body:tags",
      "body:title",
      "formData:file",
      "path:file_id",
    ]);
  });
});
