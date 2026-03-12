import { Profile } from "../src/profile-store";
import { OpenapiToCommands, CliCommand, OpenapiSpecLike } from "../src/openapi-to-commands";

const baseProfile: Profile = {
  name: "myapi",
  apiBaseUrl: "http://127.0.0.1:3000",
  apiBasicAuth: "",
  apiBearerToken: "",
  openapiSpecSource: "",
  openapiSpecCache: "/home/user/.oclirc/specs/myapi.json",
  includeEndpoints: [],
  excludeEndpoints: [],
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
          },
          post: {
            operationId: "createMessage",
          },
        },
        "/channels/{username}": {
          get: {
            operationId: "getChannelByUsername",
          },
        },
      },
    };

    const profile: Profile = {
      ...baseProfile,
      includeEndpoints: [],
      excludeEndpoints: [],
    };

    const commands: CliCommand[] = openapiToCommands.buildCommands(spec, profile);

    const names = commands.map((c: CliCommand) => c.name).sort();
    expect(names).toEqual(["channels_username", "messages_get", "messages_post"]);
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
    };

    const commands: CliCommand[] = openapiToCommands.buildCommands(spec, profile);

    const names = commands.map((c: CliCommand) => c.name).sort();
    expect(names).toEqual(["messages"]);
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
              },
              {
                name: "limit",
                in: "query",
                required: false,
                schema: { type: "integer" },
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
    };

    const commands: CliCommand[] = openapiToCommands.buildCommands(spec, profile);
    expect(commands).toHaveLength(1);

    const cmd: CliCommand = commands[0];
    const optionNames = cmd.options.map((o) => o.name).sort();
    expect(optionNames).toEqual(["limit", "username"]);

    const usernameOption = cmd.options.find((o) => o.name === "username");
    expect(usernameOption?.required).toBe(true);
    expect(usernameOption?.location).toBe("path");
  });
});
