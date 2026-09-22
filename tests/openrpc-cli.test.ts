import { ConfigLocator } from "../src/config";
import { ProfileStore } from "../src/profile-store";
import { OpenapiLoader } from "../src/openapi-loader";
import { HttpClient, run } from "../src/cli";

interface MemoryFsEntry {
  type: "file" | "dir";
  content?: string;
}

class MemoryFs {
  private readonly entries: Record<string, MemoryFsEntry> = {};

  constructor(initialFiles: Record<string, string>) {
    for (const [filePath, content] of Object.entries(initialFiles)) {
      this.addFile(filePath, content);
    }
  }

  existsSync(path: string): boolean {
    return Boolean(this.entries[path]);
  }

  readFileSync(path: string, encoding: BufferEncoding): string {
    if (encoding !== "utf-8") {
      throw new Error("MemoryFs supports only utf-8 encoding");
    }
    const entry = this.entries[path];
    if (!entry || entry.type !== "file" || entry.content === undefined) {
      throw new Error(`File not found: ${path}`);
    }
    return entry.content;
  }

  writeFileSync(path: string, data: string): void {
    this.addFile(path, data);
  }

  mkdirSync(path: string): void {
    this.entries[path] = { type: "dir" };
  }

  private addFile(path: string, content: string): void {
    this.entries[path] = { type: "file", content };
  }
}

async function captureRequest(spec: object, args: string[]): Promise<unknown[]> {
  const cwd = "/project";
  const homeDir = "/home/user";
  const specCache = `${cwd}/.ocli/specs/rpc.json`;
  const fs = new MemoryFs({
    [`${cwd}/.ocli/current`]: "rpc",
    [`${cwd}/.ocli/profiles.ini`]: [
      "[rpc]",
      "api_base_url = https://profile.example.test/rpc",
      `openapi_spec_cache = ${specCache}`,
      "",
    ].join("\n"),
    [specCache]: JSON.stringify(spec),
  });
  const locator = new ConfigLocator({ fs, homeDir });
  const profileStore = new ProfileStore({ fs, locator });
  const openapiLoader = new OpenapiLoader({ fs });
  const capturedConfigs: unknown[] = [];
  const httpClient: HttpClient = {
    request: async (config) => {
      capturedConfigs.push(config);
      return { data: { jsonrpc: "2.0", result: {}, id: 1 } } as never;
    },
  };

  await run(args, { cwd, profileStore, openapiLoader, httpClient, stdout: () => {} });
  return capturedConfigs;
}

describe("cli with OpenRPC", () => {
  it("sends documented parameters in a JSON-RPC request envelope", async () => {
    const cwd = "/project";
    const homeDir = "/home/user";
    const specCache = `${cwd}/.ocli/specs/rpc.json`;
    const spec = {
      openrpc: "1.0.0-rc1",
      info: { title: "Example", version: "1.0.0" },
      servers: [{ url: "https://server.example.test/rpc" }],
      methods: [
        {
          name: "getWidget",
          params: [
            {
              name: "widgetId",
              required: true,
              schema: { type: "string" },
            },
          ],
        },
      ],
    };
    const fs = new MemoryFs({
      [`${cwd}/.ocli/current`]: "rpc",
      [`${cwd}/.ocli/profiles.ini`]: [
        "[rpc]",
        "api_base_url = https://profile.example.test/rpc",
        `openapi_spec_cache = ${specCache}`,
        "",
      ].join("\n"),
      [specCache]: JSON.stringify(spec),
    });
    const locator = new ConfigLocator({ fs, homeDir });
    const profileStore = new ProfileStore({ fs, locator });
    const openapiLoader = new OpenapiLoader({ fs });
    const capturedConfigs: unknown[] = [];
    const httpClient: HttpClient = {
      request: async (config) => {
        capturedConfigs.push(config);
        return { data: { jsonrpc: "2.0", result: { id: "widget-7" }, id: 1 } } as never;
      },
    };

    await run(
      ["getWidget", "--widgetId", "widget-7"],
      { cwd, profileStore, openapiLoader, httpClient, stdout: () => {} }
    );

    expect(capturedConfigs).toEqual([
      expect.objectContaining({
        method: "POST",
        url: "https://profile.example.test/rpc",
        headers: { "Content-Type": "application/json" },
        data: {
          jsonrpc: "2.0",
          method: "getWidget",
          params: { widgetId: "widget-7" },
          id: 1,
        },
      }),
    ]);
  });

  it("serializes documented scalar and structured parameter types", async () => {
    const spec = {
      openrpc: "1.0.0",
      info: { title: "Example", version: "1.0.0" },
      methods: [
        {
          name: "updateWidget",
          params: [
            { name: "count", required: true, schema: { type: "integer", format: "int64" } },
            { name: "ratio", required: true, schema: { type: "number" } },
            { name: "enabled", required: true, schema: { type: "boolean" } },
            { name: "tags", required: true, schema: { type: "array", items: { type: "string" } } },
          ],
        },
      ],
    };

    const capturedConfigs = await captureRequest(spec, [
      "updateWidget",
      "--count", "2",
      "--ratio", "1.5",
      "--enabled", "false",
      "--tags", '["one","two"]',
    ]);

    expect(capturedConfigs).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({
          params: {
            count: 2,
            ratio: 1.5,
            enabled: false,
            tags: ["one", "two"],
          },
        }),
      }),
    ]);
  });

  it("serializes positional parameters as a JSON-RPC array", async () => {
    const spec = {
      openrpc: "1.0.0",
      info: { title: "Example", version: "1.0.0" },
      methods: [
        {
          name: "moveWidget",
          paramStructure: "by-position",
          params: [
            { name: "widgetId", required: true, schema: { type: "string" } },
            { name: "revision", required: true, schema: { type: "integer" } },
          ],
        },
      ],
    };

    const capturedConfigs = await captureRequest(spec, [
      "moveWidget",
      "--widgetId", "widget-7",
      "--revision", "3",
    ]);

    expect(capturedConfigs).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({
          params: ["widget-7", 3],
        }),
      }),
    ]);
  });

  it("rejects invalid values for documented integer parameters", async () => {
    const spec = {
      openrpc: "1.0.0",
      info: { title: "Example", version: "1.0.0" },
      methods: [
        {
          name: "moveWidget",
          params: [
            { name: "revision", required: true, schema: { type: "integer" } },
          ],
        },
      ],
    };

    await expect(captureRequest(spec, ["moveWidget", "--revision", "1.5"]))
      .rejects.toThrow("--revision expects an integer");
  });
});
