import { ConfigLocator } from "../src/config";
import { ProfileStore } from "../src/profile-store";
import { OpenapiLoader } from "../src/openapi-loader";
import { run, HttpClient } from "../src/cli";
import { VERSION } from "../src/version";

interface MemoryFsEntry {
  type: "file" | "dir";
  content?: string;
}

class MemoryFs {
  private readonly entries: Record<string, MemoryFsEntry> = {};

  constructor(initialFiles?: Record<string, string>) {
    if (initialFiles) {
      for (const [filePath, content] of Object.entries(initialFiles)) {
        this.addFile(filePath, content);
      }
    }
  }

  addFile(filePath: string, content: string): void {
    this.ensureDirForPath(filePath);
    this.entries[filePath] = { type: "file", content };
  }

  addDir(dirPath: string): void {
    if (!this.entries[dirPath]) {
      this.entries[dirPath] = { type: "dir" };
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
    this.ensureDirForPath(path);
    this.entries[path] = { type: "file", content: data };
  }

  mkdirSync(path: string, options?: { recursive?: boolean }): void {
    if (options?.recursive) {
      this.addDir(path);
      return;
    }
    this.addDir(path);
  }

  private ensureDirForPath(filePath: string): void {
    const segments = filePath.split("/").filter(Boolean);
    if (segments.length <= 1) {
      return;
    }
    let current = "";
    for (let i = 0; i < segments.length - 1; i += 1) {
      current += `/${segments[i]}`;
      this.addDir(current);
    }
  }
}

function createCliDeps(cwd: string, homeDir: string, files: Record<string, string>) {
  const fs = new MemoryFs(files);
  const locator = new ConfigLocator({ fs, homeDir });
  const profileStore = new ProfileStore({ fs, locator });
  const openapiLoader = new OpenapiLoader({ fs });
  return { cwd, profileStore, openapiLoader };
}

describe("cli", () => {
  const homeDir = "/home/user";
  const cwd = "/project";

  it("--version prints baked version", async () => {
    const { profileStore, openapiLoader } = createCliDeps(cwd, homeDir, {});

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    await run(["--version"], {
      cwd,
      profileStore,
      openapiLoader,
    });

    const out = logSpy.mock.calls.map((call) => String(call[0])).join("");
    logSpy.mockRestore();

    expect(out).toContain(VERSION);
  });

  it("onboard creates profile default and caches spec (alias for profiles add default)", async () => {
    const localDir = `${cwd}/.ocli`;
    const profilesPath = `${localDir}/profiles.ini`;
    const spec = { openapi: "3.0.0", paths: {} };

    const fs = new MemoryFs({
      "/project/openapi.json": JSON.stringify(spec),
    });
    const locator = new ConfigLocator({ fs, homeDir });
    const profileStore = new ProfileStore({ fs, locator });
    const openapiLoader = new OpenapiLoader({ fs });

    await run(
      [
        "onboard",
        "--api-base-url",
        "http://127.0.0.1:3000",
        "--openapi-spec",
        "/project/openapi.json",
      ],
      { cwd, profileStore, openapiLoader }
    );

    expect(fs.existsSync(profilesPath)).toBe(true);
    const profile = profileStore.getCurrentProfile(cwd);
    expect(profile?.name).toBe("default");
    expect(profile?.apiBaseUrl).toBe("http://127.0.0.1:3000");
    expect(profileStore.getCurrentProfileName(cwd)).toBe("default");
  });

  it("profiles add <name> creates profile and caches spec", async () => {
    const localDir = `${cwd}/.ocli`;
    const profilesPath = `${localDir}/profiles.ini`;
    const spec = { openapi: "3.0.0", paths: {} };

    const fs = new MemoryFs({
      "/project/openapi.json": JSON.stringify(spec),
    });
    const locator = new ConfigLocator({ fs, homeDir });
    const profileStore = new ProfileStore({ fs, locator });
    const openapiLoader = new OpenapiLoader({ fs });

    await run(
      [
        "profiles",
        "add",
        "myapi",
        "--api-base-url",
        "http://127.0.0.1:3000",
        "--openapi-spec",
        "/project/openapi.json",
      ],
      { cwd, profileStore, openapiLoader }
    );

    expect(fs.existsSync(profilesPath)).toBe(true);
    const profile = profileStore.getCurrentProfile(cwd);
    expect(profile?.name).toBe("myapi");
    expect(profile?.apiBaseUrl).toBe("http://127.0.0.1:3000");
    expect(profileStore.getCurrentProfileName(cwd)).toBe("myapi");
  });

  it("profiles list prints profile names", async () => {
    const localDir = `${cwd}/.ocli`;
    const iniContent = [
      "[default]",
      "current_profile = a",
      "",
      "[a]",
      "api_base_url = http://a",
      "openapi_spec_cache = /tmp/specs/a.json",
      "",
      "[b]",
      "api_base_url = http://b",
      "openapi_spec_cache = /tmp/specs/b.json",
      "",
    ].join("\n");

    const { profileStore, openapiLoader } = createCliDeps(cwd, homeDir, {
      [`${localDir}/profiles.ini`]: iniContent,
    });

    const log: string[] = [];
    await run(["profiles", "list"], {
      cwd,
      profileStore,
      openapiLoader,
      stdout: (msg: string) => log.push(msg),
    });

    const out = log.join("");
    expect(out).toContain("a");
    expect(out).toContain("b");
  });

  it("use sets current profile", async () => {
    const localDir = `${cwd}/.ocli`;
    const profilesPath = `${localDir}/profiles.ini`;
    const iniContent = [
      "[default]",
      "current_profile = a",
      "",
      "[a]",
      "api_base_url = http://a",
      "openapi_spec_cache = /tmp/a.json",
      "",
      "[b]",
      "api_base_url = http://b",
      "openapi_spec_cache = /tmp/b.json",
      "",
    ].join("\n");

    const { profileStore, openapiLoader } = createCliDeps(cwd, homeDir, {
      [profilesPath]: iniContent,
    });

    await run(["use", "b"], { cwd, profileStore, openapiLoader });

    expect(profileStore.getCurrentProfileName(cwd)).toBe("b");
  });

  it("profiles remove deletes profile", async () => {
    const localDir = `${cwd}/.ocli`;
    const profilesPath = `${localDir}/profiles.ini`;
    const iniContent = [
      "[x]",
      "api_base_url = http://x",
      "openapi_spec_cache = /tmp/x.json",
      "",
    ].join("\n");

    const { profileStore, openapiLoader } = createCliDeps(cwd, homeDir, {
      [profilesPath]: iniContent,
      [`${localDir}/current`]: "x",
    });

    await run(["profiles", "remove", "x"], { cwd, profileStore, openapiLoader });

    expect(profileStore.listProfileNames(cwd)).toEqual([]);
    expect(profileStore.getCurrentProfileName(cwd)).toBe("default");
  });

  it("profiles show prints profile details", async () => {
    const localDir = `${cwd}/.ocli`;
    const iniContent = [
      "[default]",
      "current_profile = p",
      "",
      "[p]",
      "api_base_url = http://example.com",
      "api_bearer_token = SECRET",
      "openapi_spec_cache = /tmp/p.json",
      "",
    ].join("\n");

    const log: string[] = [];
    const { profileStore, openapiLoader } = createCliDeps(cwd, homeDir, {
      [`${localDir}/profiles.ini`]: iniContent,
    });

    await run(["profiles", "show", "p"], {
      cwd,
      profileStore,
      openapiLoader,
      stdout: (msg: string) => log.push(msg),
    });

    const out = log.join("");
    expect(out).toContain("http://example.com");
    expect(out).toContain("p");
  });

  it("commands lists available commands for the current profile", async () => {
    const localDir = `${cwd}/.ocli`;
    const profilesPath = `${localDir}/profiles.ini`;
    const specPath = "/project/spec.json";
    const cachePath = `${localDir}/specs/search-api.json`;

    const spec = {
      openapi: "3.0.0",
      paths: {
        "/api/v1/search/": {
          get: {
            summary: "Search in content index",
            parameters: [
              {
                name: "q",
                in: "query",
                required: true,
                schema: {
                  type: "string",
                },
              },
            ],
          },
        },
      },
    };

    const iniContent = [
      "[search-api]",
      "api_base_url = https://search.vamplabai.com",
      `openapi_spec_source = ${specPath}`,
      `openapi_spec_cache = ${cachePath}`,
      "include_endpoints = get:/api/v1/search/",
      "exclude_endpoints = ",
      "",
    ].join("\n");

    const log: string[] = [];
    const { profileStore, openapiLoader } = createCliDeps(cwd, homeDir, {
      [profilesPath]: iniContent,
      [`${localDir}/current`]: "search-api",
      [specPath]: JSON.stringify(spec),
    });

    await run(["commands"], {
      cwd,
      profileStore,
      openapiLoader,
      stdout: (msg: string) => log.push(msg),
    });

    const out = log.join("");
    expect(out).toContain("Available commands for profile search-api");
    expect(out).toContain("api_v1_search  Search in content index");
  });

  it("commands supports regex filtering of commands", async () => {
    const localDir = `${cwd}/.ocli`;
    const profilesPath = `${localDir}/profiles.ini`;
    const specPath = "/project/spec.json";
    const cachePath = `${localDir}/specs/messages-api.json`;

    const spec = {
      openapi: "3.0.0",
      paths: {
        "/messages": {
          get: {
            summary: "List messages",
          },
        },
        "/status": {
          get: {
            summary: "Get status",
          },
        },
      },
    };

    const iniContent = [
      "[messages-api]",
      "api_base_url = https://api.example.com",
      "api_basic_auth = ",
      "api_bearer_token = ",
      `openapi_spec_source = ${specPath}`,
      `openapi_spec_cache = ${cachePath}`,
      "include_endpoints = get:/messages,get:/status",
      "exclude_endpoints = ",
      "",
    ].join("\n");

    const log: string[] = [];
    const { profileStore, openapiLoader } = createCliDeps(cwd, homeDir, {
      [profilesPath]: iniContent,
      [`${localDir}/current`]: "messages-api",
      [specPath]: JSON.stringify(spec),
    });

    await run(["commands", "--regex", "messages"], {
      cwd,
      profileStore,
      openapiLoader,
      stdout: (msg: string) => log.push(msg),
    });

    const out = log.join("");
    expect(out).toContain("messages_get");
    expect(out).not.toContain("status");
  });

  it("commands supports BM25 query filtering of commands", async () => {
    const localDir = `${cwd}/.ocli`;
    const profilesPath = `${localDir}/profiles.ini`;
    const specPath = "/project/spec.json";
    const cachePath = `${localDir}/specs/messages-api.json`;

    const spec = {
      openapi: "3.0.0",
      paths: {
        "/messages": {
          get: {
            summary: "List messages",
          },
        },
        "/status": {
          get: {
            summary: "Get status",
          },
        },
      },
    };

    const iniContent = [
      "[messages-api]",
      "api_base_url = https://api.example.com",
      "api_basic_auth = ",
      "api_bearer_token = ",
      `openapi_spec_source = ${specPath}`,
      `openapi_spec_cache = ${cachePath}`,
      "include_endpoints = get:/messages,get:/status",
      "exclude_endpoints = ",
      "",
    ].join("\n");

    const log: string[] = [];
    const { profileStore, openapiLoader } = createCliDeps(cwd, homeDir, {
      [profilesPath]: iniContent,
      [`${localDir}/current`]: "messages-api",
      [specPath]: JSON.stringify(spec),
    });

    await run(["commands", "--query", "list messages"], {
      cwd,
      profileStore,
      openapiLoader,
      stdout: (msg: string) => log.push(msg),
    });

    const out = log.join("");
    expect(out).toContain("messages_get");
    expect(out).not.toContain("status");
  });

  it("commands add method suffix when spec path has multiple methods even if only one is included", async () => {
    const localDir = `${cwd}/.ocli`;
    const profilesPath = `${localDir}/profiles.ini`;
    const specPath = "/project/spec.json";
    const cachePath = `${localDir}/specs/messages-api.json`;

    const spec = {
      openapi: "3.0.0",
      paths: {
        "/messages": {
          get: {
            summary: "List messages",
          },
          post: {
            summary: "Create message",
          },
        },
        "/status": {
          get: {
            summary: "Get status",
          },
        },
        "/users": {
          get: {
            summary: "List users",
          },
        },
      },
    };

    const iniContent = [
      "[messages-api]",
      "api_base_url = https://api.example.com",
      "api_basic_auth = ",
      "api_bearer_token = ",
      `openapi_spec_source = ${specPath}`,
      `openapi_spec_cache = ${cachePath}`,
      "include_endpoints = get:/messages,get:/status,get:/users",
      "exclude_endpoints = ",
      "",
    ].join("\n");

    const log: string[] = [];
    const { profileStore, openapiLoader } = createCliDeps(cwd, homeDir, {
      [profilesPath]: iniContent,
      [`${localDir}/current`]: "messages-api",
      [specPath]: JSON.stringify(spec),
    });

    await run(["commands"], {
      cwd,
      profileStore,
      openapiLoader,
      stdout: (msg: string) => log.push(msg),
    });

    const out = log.join("");
    expect(out).toContain("Available commands for profile messages-api");
    expect(out).toContain("messages_get");
    expect(out).toContain("List messages");
    expect(out).toContain("status");
    expect(out).toContain("Get status");
    expect(out).toContain("users");
    expect(out).toContain("List users");
  });

  it("invokes API command with query parameters using current profile", async () => {
    const localDir = `${cwd}/.ocli`;
    const profilesPath = `${localDir}/profiles.ini`;
    const cachePath = `${localDir}/specs/search-api.json`;

    const spec = {
      openapi: "3.0.0",
      paths: {
        "/api/v1/search/": {
          get: {
            summary: "Search in content index",
            parameters: [
              {
                name: "q",
                in: "query",
                required: true,
                schema: { type: "string" },
              },
            ],
          },
        },
      },
    };

    const iniContent = [
      "[search-api]",
      "api_base_url = https://search.example.com",
      "api_basic_auth = ",
      "api_bearer_token = ",
      "openapi_spec_source = /project/spec.json",
      `openapi_spec_cache = ${cachePath}`,
      "include_endpoints = get:/api/v1/search/",
      "exclude_endpoints = ",
      "",
    ].join("\n");

    const capturedConfigs: unknown[] = [];
    const fakeHttpClient: HttpClient = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      request: async (config: any) => {
        capturedConfigs.push(config);
        return {
          status: 200,
          statusText: "OK",
          headers: {},
          config,
          data: { ok: true },
        };
      },
    };

    const log: string[] = [];
    const { profileStore, openapiLoader } = createCliDeps(cwd, homeDir, {
      [profilesPath]: iniContent,
      [cachePath]: JSON.stringify(spec),
      [`${localDir}/current`]: "search-api",
    });

    await run(["api_v1_search", "--q", "test"], {
      cwd,
      profileStore,
      openapiLoader,
      httpClient: fakeHttpClient,
      stdout: (msg: string) => log.push(msg),
    });

    expect(capturedConfigs).toHaveLength(1);
    const config = capturedConfigs[0] as { url: string; method: string };
    expect(config.method).toBe("GET");
    expect(config.url).toBe("https://search.example.com/api/v1/search/?q=test");

    const out = log.join("");
    expect(out).toContain('"ok": true');
  });
});
