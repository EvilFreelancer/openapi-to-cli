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
});
