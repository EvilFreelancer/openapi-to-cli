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
    expect(out).toContain("messages  List messages");
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
    expect(out).toContain("messages  List messages");
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

  // --- Body flag JSON parsing tests ---

  function createPostApiDeps() {
    const localDir = `${cwd}/.ocli`;
    const profilesPath = `${localDir}/profiles.ini`;
    const cachePath = `${localDir}/specs/body-api.json`;

    const spec = {
      openapi: "3.0.0",
      paths: {
        "/{org_slug}/{repo_slug}/ci/workflows/{workflow_name}/trigger": {
          post: {
            summary: "Trigger workflow",
            parameters: [
              { name: "org_slug", in: "path", required: true, schema: { type: "string" } },
              { name: "repo_slug", in: "path", required: true, schema: { type: "string" } },
              { name: "workflow_name", in: "path", required: true, schema: { type: "string" } },
            ],
          },
        },
      },
    };

    const iniContent = [
      "[body-api]",
      "api_base_url = https://api.example.com",
      "api_basic_auth = ",
      "api_bearer_token = tok",
      "openapi_spec_source = /spec.json",
      `openapi_spec_cache = ${cachePath}`,
      "include_endpoints = ",
      "exclude_endpoints = ",
      "",
    ].join("\n");

    const capturedConfigs: unknown[] = [];
    const fakeHttpClient: HttpClient = {
      request: async (config: any) => {
        capturedConfigs.push(config);
        return { status: 200, statusText: "OK", headers: {}, config, data: { ok: true } };
      },
    };

    const { profileStore, openapiLoader } = createCliDeps(cwd, homeDir, {
      [profilesPath]: iniContent,
      [cachePath]: JSON.stringify(spec),
      [`${localDir}/current`]: "body-api",
    });

    return { profileStore, openapiLoader, fakeHttpClient, capturedConfigs };
  }

  it("parses JSON object body flags before sending request", async () => {
    const { profileStore, openapiLoader, fakeHttpClient, capturedConfigs } = createPostApiDeps();

    await run(
      [
        "org_slug_repo_slug_ci_workflows_workflow_name_trigger",
        "--org_slug", "myorg",
        "--repo_slug", "myrepo",
        "--workflow_name", "deploy",
        "--revision", "main",
        "--workflow_revision", "main",
        "--input", '{"values":[{"name":"FOO","value":"bar"}]}',
      ],
      { cwd, profileStore, openapiLoader, httpClient: fakeHttpClient, stdout: () => {} }
    );

    expect(capturedConfigs).toHaveLength(1);
    const config = capturedConfigs[0] as { data: Record<string, unknown> };
    expect(config.data).toEqual({
      revision: "main",
      workflow_revision: "main",
      input: {
        values: [{ name: "FOO", value: "bar" }],
      },
    });
  });

  it("parses boolean body flags before sending request", async () => {
    const { profileStore, openapiLoader, fakeHttpClient, capturedConfigs } = createPostApiDeps();

    await run(
      [
        "org_slug_repo_slug_ci_workflows_workflow_name_trigger",
        "--org_slug", "myorg",
        "--repo_slug", "myrepo",
        "--workflow_name", "deploy",
        "--shared", "true",
        "--draft", "false",
      ],
      { cwd, profileStore, openapiLoader, httpClient: fakeHttpClient, stdout: () => {} }
    );

    expect(capturedConfigs).toHaveLength(1);
    const config = capturedConfigs[0] as { data: Record<string, unknown> };
    expect(config.data.shared).toBe(true);
    expect(config.data.draft).toBe(false);
  });

  it("parses null body flags before sending request", async () => {
    const { profileStore, openapiLoader, fakeHttpClient, capturedConfigs } = createPostApiDeps();

    await run(
      [
        "org_slug_repo_slug_ci_workflows_workflow_name_trigger",
        "--org_slug", "myorg",
        "--repo_slug", "myrepo",
        "--workflow_name", "deploy",
        "--description", "null",
      ],
      { cwd, profileStore, openapiLoader, httpClient: fakeHttpClient, stdout: () => {} }
    );

    expect(capturedConfigs).toHaveLength(1);
    const config = capturedConfigs[0] as { data: Record<string, unknown> };
    expect(config.data.description).toBeNull();
  });

  it("parses JSON array body flags before sending request", async () => {
    const { profileStore, openapiLoader, fakeHttpClient, capturedConfigs } = createPostApiDeps();

    await run(
      [
        "org_slug_repo_slug_ci_workflows_workflow_name_trigger",
        "--org_slug", "myorg",
        "--repo_slug", "myrepo",
        "--workflow_name", "deploy",
        "--tags", '["ci","deploy"]',
      ],
      { cwd, profileStore, openapiLoader, httpClient: fakeHttpClient, stdout: () => {} }
    );

    expect(capturedConfigs).toHaveLength(1);
    const config = capturedConfigs[0] as { data: Record<string, unknown> };
    expect(config.data.tags).toEqual(["ci", "deploy"]);
  });

  it("preserves plain string body flags", async () => {
    const { profileStore, openapiLoader, fakeHttpClient, capturedConfigs } = createPostApiDeps();

    await run(
      [
        "org_slug_repo_slug_ci_workflows_workflow_name_trigger",
        "--org_slug", "myorg",
        "--repo_slug", "myrepo",
        "--workflow_name", "deploy",
        "--revision", "main",
      ],
      { cwd, profileStore, openapiLoader, httpClient: fakeHttpClient, stdout: () => {} }
    );

    expect(capturedConfigs).toHaveLength(1);
    const config = capturedConfigs[0] as { data: Record<string, unknown> };
    expect(config.data.revision).toBe("main");
  });

  it("throws on invalid JSON-like body flags", async () => {
    const { profileStore, openapiLoader, fakeHttpClient } = createPostApiDeps();

    await expect(
      run(
        [
          "org_slug_repo_slug_ci_workflows_workflow_name_trigger",
          "--org_slug", "myorg",
          "--repo_slug", "myrepo",
          "--workflow_name", "deploy",
          "--input", '{"values":',
        ],
        { cwd, profileStore, openapiLoader, httpClient: fakeHttpClient, stdout: () => {} }
      )
    ).rejects.toThrow("Invalid JSON body value");
  });

  it("builds JSON request body from declared OAS3 requestBody properties", async () => {
    const localDir = `${cwd}/.ocli`;
    const profilesPath = `${localDir}/profiles.ini`;
    const cachePath = `${localDir}/specs/oas3-body-api.json`;

    const spec = {
      openapi: "3.0.0",
      components: {
        parameters: {
          RepoSlug: {
            name: "repo_slug",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        },
      },
      paths: {
        "/repos/{repo_slug}/dispatch": {
          parameters: [
            { $ref: "#/components/parameters/RepoSlug" },
          ],
          post: {
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["event_type"],
                    properties: {
                      event_type: { type: "string" },
                      draft: { type: "boolean" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    const iniContent = [
      "[oas3-body-api]",
      "api_base_url = https://api.example.com",
      "api_basic_auth = ",
      "api_bearer_token = tok",
      "openapi_spec_source = /spec.json",
      `openapi_spec_cache = ${cachePath}`,
      "include_endpoints = ",
      "exclude_endpoints = ",
      "",
    ].join("\n");

    const capturedConfigs: unknown[] = [];
    const fakeHttpClient: HttpClient = {
      request: async (config: any) => {
        capturedConfigs.push(config);
        return { status: 200, statusText: "OK", headers: {}, config, data: { ok: true } };
      },
    };

    const { profileStore, openapiLoader } = createCliDeps(cwd, homeDir, {
      [profilesPath]: iniContent,
      [cachePath]: JSON.stringify(spec),
      [`${localDir}/current`]: "oas3-body-api",
    });

    await run(
      [
        "repos_repo_slug_dispatch",
        "--repo_slug", "hello",
        "--event_type", "deploy",
        "--draft", "true",
      ],
      { cwd, profileStore, openapiLoader, httpClient: fakeHttpClient, stdout: () => {} }
    );

    const config = capturedConfigs[0] as { headers: Record<string, string>; data: Record<string, unknown> };
    expect(config.headers["Content-Type"]).toBe("application/json");
    expect(config.data).toEqual({
      event_type: "deploy",
      draft: true,
    });
  });

  it("builds Swagger 2 form payload from formData parameters", async () => {
    const localDir = `${cwd}/.ocli`;
    const profilesPath = `${localDir}/profiles.ini`;
    const cachePath = `${localDir}/specs/swagger-form-api.json`;

    const spec = {
      swagger: "2.0",
      paths: {
        "/uploads": {
          post: {
            consumes: ["application/x-www-form-urlencoded"],
            parameters: [
              { name: "title", in: "formData", required: true, type: "string" },
              { name: "draft", in: "formData", required: false, type: "string" },
            ],
          },
        },
      },
    };

    const iniContent = [
      "[swagger-form-api]",
      "api_base_url = https://api.example.com",
      "api_basic_auth = ",
      "api_bearer_token = tok",
      "openapi_spec_source = /spec.json",
      `openapi_spec_cache = ${cachePath}`,
      "include_endpoints = ",
      "exclude_endpoints = ",
      "",
    ].join("\n");

    const capturedConfigs: unknown[] = [];
    const fakeHttpClient: HttpClient = {
      request: async (config: any) => {
        capturedConfigs.push(config);
        return { status: 200, statusText: "OK", headers: {}, config, data: { ok: true } };
      },
    };

    const { profileStore, openapiLoader } = createCliDeps(cwd, homeDir, {
      [profilesPath]: iniContent,
      [cachePath]: JSON.stringify(spec),
      [`${localDir}/current`]: "swagger-form-api",
    });

    await run(
      ["uploads", "--title", "Quarterly report", "--draft", "yes"],
      { cwd, profileStore, openapiLoader, httpClient: fakeHttpClient, stdout: () => {} }
    );

    const config = capturedConfigs[0] as { headers: Record<string, string>; data: URLSearchParams };
    expect(config.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(config.data.toString()).toBe("title=Quarterly+report&draft=yes");
  });

  it("injects header and cookie parameters into the request", async () => {
    const localDir = `${cwd}/.ocli`;
    const profilesPath = `${localDir}/profiles.ini`;
    const cachePath = `${localDir}/specs/headers-and-cookies-api.json`;

    const spec = {
      openapi: "3.0.0",
      paths: {
        "/me": {
          get: {
            parameters: [
              { name: "X-Request-Id", in: "header", required: true, schema: { type: "string" } },
              { name: "session_id", in: "cookie", required: true, schema: { type: "string" } },
            ],
          },
        },
      },
    };

    const iniContent = [
      "[headers-and-cookies-api]",
      "api_base_url = https://api.example.com",
      "api_basic_auth = ",
      "api_bearer_token = tok",
      "openapi_spec_source = /spec.json",
      `openapi_spec_cache = ${cachePath}`,
      "include_endpoints = ",
      "exclude_endpoints = ",
      "",
    ].join("\n");

    const capturedConfigs: unknown[] = [];
    const fakeHttpClient: HttpClient = {
      request: async (config: any) => {
        capturedConfigs.push(config);
        return { status: 200, statusText: "OK", headers: {}, config, data: { ok: true } };
      },
    };

    const { profileStore, openapiLoader } = createCliDeps(cwd, homeDir, {
      [profilesPath]: iniContent,
      [cachePath]: JSON.stringify(spec),
      [`${localDir}/current`]: "headers-and-cookies-api",
    });

    await run(
      ["me", "--X-Request-Id", "req-123", "--session_id", "cookie-abc"],
      { cwd, profileStore, openapiLoader, httpClient: fakeHttpClient, stdout: () => {} }
    );

    const config = capturedConfigs[0] as { headers: Record<string, string> };
    expect(config.headers["X-Request-Id"]).toBe("req-123");
    expect(config.headers.Cookie).toBe("session_id=cookie-abc");
  });

  it("shows schema hints in command help output", async () => {
    const localDir = `${cwd}/.ocli`;
    const profilesPath = `${localDir}/profiles.ini`;
    const cachePath = `${localDir}/specs/help-hints-api.json`;

    const spec = {
      openapi: "3.1.0",
      paths: {
        "/reports": {
          post: {
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      format: {
                        type: "string",
                        enum: ["csv", "json"],
                        default: "json",
                      },
                      note: {
                        type: "string",
                        nullable: true,
                      },
                      filter: {
                        oneOf: [
                          { type: "string" },
                          { type: "integer" },
                        ],
                      },
                    },
                    required: ["format"],
                  },
                },
              },
            },
          },
        },
      },
    };

    const iniContent = [
      "[help-hints-api]",
      "api_base_url = https://api.example.com",
      "api_basic_auth = ",
      "api_bearer_token = tok",
      "openapi_spec_source = /spec.json",
      `openapi_spec_cache = ${cachePath}`,
      "include_endpoints = ",
      "exclude_endpoints = ",
      "",
    ].join("\n");

    const log: string[] = [];
    const { profileStore, openapiLoader } = createCliDeps(cwd, homeDir, {
      [profilesPath]: iniContent,
      [cachePath]: JSON.stringify(spec),
      [`${localDir}/current`]: "help-hints-api",
    });

    await run(["reports", "--help"], {
      cwd,
      profileStore,
      openapiLoader,
      stdout: (msg: string) => log.push(msg),
    });

    const out = log.join("");
    expect(out).toContain('enum: "csv", "json"');
    expect(out).toContain('default: "json"');
    expect(out).toContain("nullable");
    expect(out).toContain("oneOf: string | integer");
  });

  it("serializes query arrays and deepObject parameters from spec metadata", async () => {
    const localDir = `${cwd}/.ocli`;
    const profilesPath = `${localDir}/profiles.ini`;
    const cachePath = `${localDir}/specs/serialization-api.json`;

    const spec = {
      openapi: "3.0.0",
      paths: {
        "/reports/{report_id}": {
          get: {
            parameters: [
              {
                name: "report_id",
                in: "path",
                required: true,
                schema: { type: "array" },
                style: "label",
                explode: true,
              },
              {
                name: "tags",
                in: "query",
                schema: { type: "array" },
                style: "pipeDelimited",
                explode: false,
              },
              {
                name: "filter",
                in: "query",
                schema: { type: "object" },
                style: "deepObject",
                explode: true,
              },
            ],
          },
        },
      },
    };

    const iniContent = [
      "[serialization-api]",
      "api_base_url = https://api.example.com",
      "api_basic_auth = ",
      "api_bearer_token = tok",
      "openapi_spec_source = /spec.json",
      `openapi_spec_cache = ${cachePath}`,
      "include_endpoints = ",
      "exclude_endpoints = ",
      "",
    ].join("\n");

    const capturedConfigs: unknown[] = [];
    const fakeHttpClient: HttpClient = {
      request: async (config: any) => {
        capturedConfigs.push(config);
        return { status: 200, statusText: "OK", headers: {}, config, data: { ok: true } };
      },
    };

    const { profileStore, openapiLoader } = createCliDeps(cwd, homeDir, {
      [profilesPath]: iniContent,
      [cachePath]: JSON.stringify(spec),
      [`${localDir}/current`]: "serialization-api",
    });

    await run(
      [
        "reports_report_id",
        "--report_id", '["r1","r2"]',
        "--tags", '["daily","ops"]',
        "--filter", '{"status":"open","owner":"alice"}',
      ],
      { cwd, profileStore, openapiLoader, httpClient: fakeHttpClient, stdout: () => {} }
    );

    const config = capturedConfigs[0] as { url: string };
    expect(config.url).toBe(
      "https://api.example.com/reports/.r1.r2?tags=daily%7Cops&filter%5Bstatus%5D=open&filter%5Bowner%5D=alice"
    );
  });

  it("requires --api-base-url when onboarding", async () => {
    const spec = {
      openapi: "3.0.0",
      servers: [{ url: "https://api.example.com/root" }],
      paths: {},
    };

    const fs = new MemoryFs({
      "/project/openapi.json": JSON.stringify(spec),
    });
    const locator = new ConfigLocator({ fs, homeDir });
    const profileStore = new ProfileStore({ fs, locator });
    const openapiLoader = new OpenapiLoader({ fs });

    await expect(
      run(
        [
          "onboard",
          "--openapi-spec",
          "/project/openapi.json",
        ],
        { cwd, profileStore, openapiLoader }
      )
    ).rejects.toThrow(/api-base-url/);
  });

  it("uses operation-level server URL override when executing commands", async () => {
    const localDir = `${cwd}/.ocli`;
    const profilesPath = `${localDir}/profiles.ini`;
    const cachePath = `${localDir}/specs/server-override-api.json`;

    const spec = {
      openapi: "3.0.0",
      servers: [{ url: "https://root.example.com/api" }],
      paths: {
        "/messages": {
          get: {
            servers: [{ url: "https://ops.example.com/custom" }],
            summary: "List messages",
          },
        },
      },
    };

    const iniContent = [
      "[server-override-api]",
      "api_base_url = https://fallback.example.com",
      "api_basic_auth = ",
      "api_bearer_token = tok",
      "openapi_spec_source = /spec.json",
      `openapi_spec_cache = ${cachePath}`,
      "include_endpoints = ",
      "exclude_endpoints = ",
      "",
    ].join("\n");

    const capturedConfigs: unknown[] = [];
    const fakeHttpClient: HttpClient = {
      request: async (config: any) => {
        capturedConfigs.push(config);
        return { status: 200, statusText: "OK", headers: {}, config, data: { ok: true } };
      },
    };

    const { profileStore, openapiLoader } = createCliDeps(cwd, homeDir, {
      [profilesPath]: iniContent,
      [cachePath]: JSON.stringify(spec),
      [`${localDir}/current`]: "server-override-api",
    });

    await run(
      ["messages"],
      { cwd, profileStore, openapiLoader, httpClient: fakeHttpClient, stdout: () => {} }
    );

    const config = capturedConfigs[0] as { url: string };
    expect(config.url).toBe("https://ops.example.com/custom/messages");
  });

  it("shows schema hints in command help output", async () => {
    const localDir = `${cwd}/.ocli`;
    const profilesPath = `${localDir}/profiles.ini`;
    const cachePath = `${localDir}/specs/help-hints-api.json`;

    const spec = {
      openapi: "3.1.0",
      paths: {
        "/reports": {
          post: {
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      format: {
                        type: "string",
                        enum: ["csv", "json"],
                        default: "json",
                      },
                      note: {
                        type: "string",
                        nullable: true,
                      },
                      filter: {
                        oneOf: [
                          { type: "string" },
                          { type: "integer" },
                        ],
                      },
                    },
                    required: ["format"],
                  },
                },
              },
            },
          },
        },
      },
    };

    const iniContent = [
      "[help-hints-api]",
      "api_base_url = https://api.example.com",
      "api_basic_auth = ",
      "api_bearer_token = tok",
      "openapi_spec_source = /spec.json",
      `openapi_spec_cache = ${cachePath}`,
      "include_endpoints = ",
      "exclude_endpoints = ",
      "",
    ].join("\n");

    const log: string[] = [];
    const { profileStore, openapiLoader } = createCliDeps(cwd, homeDir, {
      [profilesPath]: iniContent,
      [cachePath]: JSON.stringify(spec),
      [`${localDir}/current`]: "help-hints-api",
    });

    await run(["reports", "--help"], {
      cwd,
      profileStore,
      openapiLoader,
      stdout: (msg: string) => log.push(msg),
    });

    const out = log.join("");
    expect(out).toContain('enum: "csv", "json"');
    expect(out).toContain('default: "json"');
    expect(out).toContain("nullable");
    expect(out).toContain("oneOf: string | integer");
  });

  it("serializes query arrays and deepObject parameters from spec metadata", async () => {
    const localDir = `${cwd}/.ocli`;
    const profilesPath = `${localDir}/profiles.ini`;
    const cachePath = `${localDir}/specs/serialization-api.json`;

    const spec = {
      openapi: "3.0.0",
      paths: {
        "/reports/{report_id}": {
          get: {
            parameters: [
              {
                name: "report_id",
                in: "path",
                required: true,
                schema: { type: "array" },
                style: "label",
                explode: true,
              },
              {
                name: "tags",
                in: "query",
                schema: { type: "array" },
                style: "pipeDelimited",
                explode: false,
              },
              {
                name: "filter",
                in: "query",
                schema: { type: "object" },
                style: "deepObject",
                explode: true,
              },
            ],
          },
        },
      },
    };

    const iniContent = [
      "[serialization-api]",
      "api_base_url = https://api.example.com",
      "api_basic_auth = ",
      "api_bearer_token = tok",
      "openapi_spec_source = /spec.json",
      `openapi_spec_cache = ${cachePath}`,
      "include_endpoints = ",
      "exclude_endpoints = ",
      "",
    ].join("\n");

    const capturedConfigs: unknown[] = [];
    const fakeHttpClient: HttpClient = {
      request: async (config: any) => {
        capturedConfigs.push(config);
        return { status: 200, statusText: "OK", headers: {}, config, data: { ok: true } };
      },
    };

    const { profileStore, openapiLoader } = createCliDeps(cwd, homeDir, {
      [profilesPath]: iniContent,
      [cachePath]: JSON.stringify(spec),
      [`${localDir}/current`]: "serialization-api",
    });

    await run(
      [
        "reports_report_id",
        "--report_id", '["r1","r2"]',
        "--tags", '["daily","ops"]',
        "--filter", '{"status":"open","owner":"alice"}',
      ],
      { cwd, profileStore, openapiLoader, httpClient: fakeHttpClient, stdout: () => {} }
    );

    const config = capturedConfigs[0] as { url: string };
    expect(config.url).toBe(
      "https://api.example.com/reports/.r1.r2?tags=daily%7Cops&filter%5Bstatus%5D=open&filter%5Bowner%5D=alice"
    );
  });

  it("uses operation-level server URL override when executing commands", async () => {
    const localDir = `${cwd}/.ocli`;
    const profilesPath = `${localDir}/profiles.ini`;
    const cachePath = `${localDir}/specs/server-override-api.json`;

    const spec = {
      openapi: "3.0.0",
      servers: [{ url: "https://root.example.com/api" }],
      paths: {
        "/messages": {
          get: {
            servers: [{ url: "https://ops.example.com/custom" }],
            summary: "List messages",
          },
        },
      },
    };

    const iniContent = [
      "[server-override-api]",
      "api_base_url = https://fallback.example.com",
      "api_basic_auth = ",
      "api_bearer_token = tok",
      "openapi_spec_source = /spec.json",
      `openapi_spec_cache = ${cachePath}`,
      "include_endpoints = ",
      "exclude_endpoints = ",
      "",
    ].join("\n");

    const capturedConfigs: unknown[] = [];
    const fakeHttpClient: HttpClient = {
      request: async (config: any) => {
        capturedConfigs.push(config);
        return { status: 200, statusText: "OK", headers: {}, config, data: { ok: true } };
      },
    };

    const { profileStore, openapiLoader } = createCliDeps(cwd, homeDir, {
      [profilesPath]: iniContent,
      [cachePath]: JSON.stringify(spec),
      [`${localDir}/current`]: "server-override-api",
    });

    await run(
      ["messages"],
      { cwd, profileStore, openapiLoader, httpClient: fakeHttpClient, stdout: () => {} }
    );

    const config = capturedConfigs[0] as { url: string };
    expect(config.url).toBe("https://ops.example.com/custom/messages");
  });

  it("sends custom headers from profile in API requests", async () => {
    const localDir = `${cwd}/.ocli`;
    const profilesPath = `${localDir}/profiles.ini`;
    const cachePath = `${localDir}/specs/headers-api.json`;

    const spec = {
      openapi: "3.0.0",
      paths: {
        "/data": {
          get: { summary: "Get data" },
        },
      },
    };

    const iniContent = [
      "[headers-api]",
      "api_base_url = https://api.example.com",
      "api_basic_auth = ",
      "api_bearer_token = tok123",
      "openapi_spec_source = /spec.json",
      `openapi_spec_cache = ${cachePath}`,
      "include_endpoints = ",
      "exclude_endpoints = ",
      "command_prefix = ",
      'custom_headers = {"X-Custom-Id":"abc123","X-Tenant":"myorg"}',
      "",
    ].join("\n");

    const capturedConfigs: unknown[] = [];
    const fakeHttpClient: HttpClient = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      request: async (config: any) => {
        capturedConfigs.push(config);
        return { status: 200, statusText: "OK", headers: {}, config, data: { ok: true } };
      },
    };

    const { profileStore, openapiLoader } = createCliDeps(cwd, homeDir, {
      [profilesPath]: iniContent,
      [cachePath]: JSON.stringify(spec),
      [`${localDir}/current`]: "headers-api",
    });

    await run(["data", "--help"], {
      cwd,
      profileStore,
      openapiLoader,
      httpClient: fakeHttpClient,
      stdout: () => {},
    });

    const profile = profileStore.getProfileByName(cwd, "headers-api");
    expect(profile?.customHeaders).toEqual({ "X-Custom-Id": "abc123", "X-Tenant": "myorg" });
    expect(profile?.commandPrefix).toBe("");
  });
});
