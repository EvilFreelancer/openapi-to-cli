import fs from "fs";
import path from "path";

import { OpenapiToCommands, OpenapiSpecLike } from "../src/openapi-to-commands";
import { Profile } from "../src/profile-store";

const baseProfile: Profile = {
  name: "rpc",
  apiBaseUrl: "",
  apiBasicAuth: "",
  apiBearerToken: "",
  openapiSpecSource: "",
  openapiSpecCache: "/tmp/rpc.json",
  includeEndpoints: [],
  excludeEndpoints: [],
  commandPrefix: "",
  customHeaders: {},
};

const fixturePath = path.join(__dirname, "fixtures", "openrpc.json");
const openrpcSpec = JSON.parse(fs.readFileSync(fixturePath, "utf-8")) as OpenapiSpecLike;

describe("OpenapiToCommands with OpenRPC", () => {
  it("builds JSON-RPC commands from documented methods", () => {
    const commands = new OpenapiToCommands().buildCommands(openrpcSpec, baseProfile);

    expect(commands).toHaveLength(2);
    expect(commands.map((command) => command.name)).toEqual(["getWidget", "listWidgets"]);

    const getWidget = commands[0];
    expect(getWidget.method).toBe("post");
    expect(getWidget.path).toBe("");
    expect(getWidget.serverUrl).toBe("https://api.example.test/rpc");
    expect(getWidget.jsonRpcMethod).toBe("getWidget");
    expect(getWidget.requestContentType).toBe("application/json");
    expect(getWidget.options).toEqual([
      expect.objectContaining({
        name: "widgetId",
        location: "body",
        required: true,
        schemaType: "integer",
        description: "Widget identifier",
      }),
    ]);
  });

  it("applies RPC filters and preserves parameter and positional metadata", () => {
    const spec: OpenapiSpecLike = {
      openrpc: "1.0.0",
      info: { title: "Example RPC API", version: "1.0.0" },
      methods: [
        {
          name: "getWidget",
          params: [],
        },
        {
          name: "moveWidget",
          paramStructure: "by-position",
          params: [
            {
              name: "widgetId",
              summary: "Widget identifier",
              required: true,
              schema: { type: "string" },
            },
          ],
        },
      ],
    };
    const profile: Profile = {
      ...baseProfile,
      includeEndpoints: ["rpc:getWidget", "rpc:moveWidget"],
      excludeEndpoints: ["rpc:getWidget"],
    };

    const commands = new OpenapiToCommands().buildCommands(spec, profile);

    expect(commands).toHaveLength(1);
    expect(commands[0]).toEqual(expect.objectContaining({
      name: "moveWidget",
      jsonRpcParamStructure: "by-position",
      options: [expect.objectContaining({
        name: "widgetId",
        description: "Widget identifier",
      })],
    }));
  });

  it("rejects duplicate OpenRPC method names", () => {
    const spec: OpenapiSpecLike = {
      openrpc: "1.0.0",
      info: { title: "Example RPC API", version: "1.0.0" },
      methods: [
        { name: "getWidget", params: [] },
        { name: "getWidget", params: [] },
      ],
    };

    expect(() => new OpenapiToCommands().buildCommands(spec, baseProfile))
      .toThrow('Duplicate OpenRPC method name "getWidget"');
  });
});
