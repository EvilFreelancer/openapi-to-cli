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
});
