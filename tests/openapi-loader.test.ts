import { Profile } from "../src/profile-store";
import { OpenapiLoader, SpecFetchError, SpecHttpClient } from "../src/openapi-loader";

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

type SpecHttpGet = jest.MockedFunction<SpecHttpClient["get"]>;

interface FakeSpecHttpClient extends SpecHttpClient {
  get: SpecHttpGet;
}

function createHttpClient(): FakeSpecHttpClient {
  return { get: jest.fn() as SpecHttpGet };
}

function serveDocuments(documents: Record<string, string | object>): SpecHttpClient["get"] {
  return async (url: string) => {
    if (url in documents) {
      return { data: documents[url] };
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
}

function headersSentTo(httpClient: FakeSpecHttpClient, url: string): Record<string, string> | undefined {
  const call = httpClient.get.mock.calls.find(([calledUrl]) => calledUrl === url);
  if (!call) {
    throw new Error(`No request was made to ${url}`);
  }
  return call[1]?.headers;
}

describe("OpenapiLoader", () => {
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

  const profileHeaders = { Authorization: "Bearer token123", "x-api-key": "key123" };

  let httpClient: FakeSpecHttpClient;

  beforeEach(() => {
    httpClient = createHttpClient();
  });

  it("downloads spec from HTTP URL and caches it when cache is missing", async () => {
    const spec = { openapi: "3.0.0", info: { title: "API", version: "1.0.0" } };
    httpClient.get.mockResolvedValueOnce({ data: spec });

    const fs = new MemoryFs();
    const loader = new OpenapiLoader({ fs, httpClient });

    const profile: Profile = {
      ...baseProfile,
      openapiSpecSource: "http://127.0.0.1:3000/openapi.json",
    };

    const loaded = await loader.loadSpec(profile);

    expect(loaded).toEqual(spec);
    expect(httpClient.get).toHaveBeenCalledTimes(1);
    expect(httpClient.get.mock.calls[0][0]).toBe(profile.openapiSpecSource);
    expect(fs.existsSync(profile.openapiSpecCache)).toBe(true);

    const cachedRaw = fs.readFileSync(profile.openapiSpecCache, "utf-8");
    expect(JSON.parse(cachedRaw)).toEqual(spec);
  });

  it("reads spec from cache when it already exists and refresh is not requested", async () => {
    const cachedSpec = { openapi: "3.0.0", cached: true };

    const profile: Profile = {
      ...baseProfile,
      openapiSpecSource: "http://127.0.0.1:3000/openapi.json",
    };

    const fs = new MemoryFs({
      [profile.openapiSpecCache]: JSON.stringify(cachedSpec),
    });

    const loader = new OpenapiLoader({ fs, httpClient });

    const loaded = await loader.loadSpec(profile);

    expect(loaded).toEqual(cachedSpec);
    expect(httpClient.get).not.toHaveBeenCalled();
  });

  it("loads spec from local file path and writes cache", async () => {
    const sourceSpec = { openapi: "3.0.0", source: "file" };

    const profile: Profile = {
      ...baseProfile,
      openapiSpecSource: "/project/openapi.json",
    };

    const fs = new MemoryFs({
      [profile.openapiSpecSource]: JSON.stringify(sourceSpec),
    });

    const loader = new OpenapiLoader({ fs, httpClient });

    const loaded = await loader.loadSpec(profile, { refresh: true });

    expect(loaded).toEqual(sourceSpec);
    expect(httpClient.get).not.toHaveBeenCalled();
    expect(fs.existsSync(profile.openapiSpecCache)).toBe(true);

    const cachedRaw = fs.readFileSync(profile.openapiSpecCache, "utf-8");
    expect(JSON.parse(cachedRaw)).toEqual(sourceSpec);
  });

  it("loads YAML spec from local file path", async () => {
    const yamlContent = `openapi: "3.0.0"\ninfo:\n  title: YAML API\n  version: "1.0.0"\npaths:\n  /test:\n    get:\n      summary: Test endpoint\n`;

    const profile: Profile = {
      ...baseProfile,
      openapiSpecSource: "/project/openapi.yaml",
    };

    const fs = new MemoryFs({
      [profile.openapiSpecSource]: yamlContent,
    });

    const loader = new OpenapiLoader({ fs, httpClient });
    const loaded = await loader.loadSpec(profile, { refresh: true }) as Record<string, any>;

    expect(loaded.openapi).toBe("3.0.0");
    expect(loaded.info.title).toBe("YAML API");
    expect(loaded.paths["/test"].get.summary).toBe("Test endpoint");
  });

  it("loads YAML spec from HTTP URL", async () => {
    const yamlContent = `openapi: "3.0.0"\ninfo:\n  title: Remote YAML\n  version: "2.0"\npaths: {}`;
    httpClient.get.mockResolvedValueOnce({ data: yamlContent });

    const profile: Profile = {
      ...baseProfile,
      openapiSpecSource: "https://example.com/spec.yaml",
    };

    const fs = new MemoryFs();
    const loader = new OpenapiLoader({ fs, httpClient });
    const loaded = await loader.loadSpec(profile, { refresh: true }) as Record<string, any>;

    expect(loaded.openapi).toBe("3.0.0");
    expect(loaded.info.title).toBe("Remote YAML");
  });

  it("auto-detects YAML content even without .yaml extension", async () => {
    const yamlContent = `openapi: "3.0.0"\ninfo:\n  title: Auto Detect\n  version: "1.0"\npaths: {}`;

    const profile: Profile = {
      ...baseProfile,
      openapiSpecSource: "/project/spec.txt",
    };

    const fs = new MemoryFs({
      [profile.openapiSpecSource]: yamlContent,
    });

    const loader = new OpenapiLoader({ fs, httpClient });
    const loaded = await loader.loadSpec(profile, { refresh: true }) as Record<string, any>;

    expect(loaded.info.title).toBe("Auto Detect");
  });

  it("resolves local external refs across multiple files", async () => {
    const rootSpec = `openapi: "3.0.0"\npaths:\n  /jobs:\n    $ref: "./paths/jobs.yaml#/jobsPath"\n`;
    const jobsPath = `jobsPath:\n  post:\n    requestBody:\n      $ref: "./components/request-bodies.yaml#/CreateJob"\n`;
    const requestBodies = `CreateJob:\n  required: true\n  content:\n    application/json:\n      schema:\n        type: object\n        required: [name]\n        properties:\n          name:\n            type: string\n`;

    const profile: Profile = {
      ...baseProfile,
      openapiSpecSource: "/project/root.yaml",
    };

    const fs = new MemoryFs({
      "/project/root.yaml": rootSpec,
      "/project/paths/jobs.yaml": jobsPath,
      "/project/paths/components/request-bodies.yaml": requestBodies,
    });

    const loader = new OpenapiLoader({ fs, httpClient });
    const loaded = await loader.loadSpec(profile, { refresh: true }) as Record<string, any>;

    expect(loaded.paths["/jobs"].post.requestBody.content["application/json"].schema.properties.name.type).toBe("string");
  });

  it("resolves remote external refs across multiple documents", async () => {
    httpClient.get.mockImplementation(
      serveDocuments({
        "https://example.com/root.yaml": `openapi: "3.0.0"\npaths:\n  /jobs:\n    $ref: "./paths/jobs.yaml#/jobsPath"\n`,
        "https://example.com/paths/jobs.yaml": `jobsPath:\n  get:\n    parameters:\n      - $ref: "../components/params.yaml#/JobId"\n`,
        "https://example.com/components/params.yaml": `JobId:\n  name: job_id\n  in: query\n  required: true\n  schema:\n    type: string\n`,
      })
    );

    const profile: Profile = {
      ...baseProfile,
      openapiSpecSource: "https://example.com/root.yaml",
    };

    const fs = new MemoryFs();
    const loader = new OpenapiLoader({ fs, httpClient });
    const loaded = await loader.loadSpec(profile, { refresh: true }) as Record<string, any>;

    expect(loaded.paths["/jobs"].get.parameters[0].name).toBe("job_id");
    expect(loaded.paths["/jobs"].get.parameters[0].in).toBe("query");
    expect(headersSentTo(httpClient, "https://example.com/components/params.yaml")).toBeUndefined();
  });

  describe("profile headers", () => {
    it("sends the headers to the spec and to every same-origin ref document, including nested ones", async () => {
      httpClient.get.mockImplementation(
        serveDocuments({
          "https://example.com/root.yaml": `openapi: "3.0.0"\npaths:\n  /jobs:\n    $ref: "./paths/jobs.yaml#/jobsPath"\n`,
          "https://example.com/paths/jobs.yaml": `jobsPath:\n  get:\n    parameters:\n      - $ref: "../components/params.yaml#/JobId"\n`,
          "https://example.com/components/params.yaml": `JobId:\n  name: job_id\n  in: query\n  schema:\n    type: string\n`,
        })
      );

      const profile: Profile = {
        ...baseProfile,
        openapiSpecSource: "https://example.com/root.yaml",
      };

      const fs = new MemoryFs();
      const loader = new OpenapiLoader({ fs, httpClient });
      const loaded = await loader.loadSpec(profile, { refresh: true, headers: profileHeaders }) as Record<string, any>;

      expect(loaded.paths["/jobs"].get.parameters[0].name).toBe("job_id");
      expect(httpClient.get).toHaveBeenCalledTimes(3);
      expect(headersSentTo(httpClient, "https://example.com/root.yaml")).toEqual(profileHeaders);
      expect(headersSentTo(httpClient, "https://example.com/paths/jobs.yaml")).toEqual(profileHeaders);
      expect(headersSentTo(httpClient, "https://example.com/components/params.yaml")).toEqual(profileHeaders);
    });

    it("does not send the headers to ref documents on another origin", async () => {
      httpClient.get.mockImplementation(
        serveDocuments({
          "https://api.example.com/root.yaml": `openapi: "3.0.0"\npaths:\n  /pets:\n    get:\n      responses:\n        "200":\n          description: ok\n          content:\n            application/json:\n              schema:\n                $ref: "https://schemas.example.org/pet.yaml#/Pet"\n`,
          "https://schemas.example.org/pet.yaml": `Pet:\n  type: object\n  properties:\n    id:\n      type: integer\n`,
        })
      );

      const profile: Profile = {
        ...baseProfile,
        apiBaseUrl: "https://api.example.com",
        openapiSpecSource: "https://api.example.com/root.yaml",
      };

      const fs = new MemoryFs();
      const loader = new OpenapiLoader({ fs, httpClient });
      const loaded = await loader.loadSpec(profile, { refresh: true, headers: profileHeaders }) as Record<string, any>;

      expect(loaded.paths["/pets"].get.responses["200"].content["application/json"].schema.type).toBe("object");
      expect(headersSentTo(httpClient, "https://api.example.com/root.yaml")).toEqual(profileHeaders);
      expect(headersSentTo(httpClient, "https://schemas.example.org/pet.yaml")).toBeUndefined();
    });

    it("sends the headers to ref documents on the API base URL origin when the spec lives elsewhere", async () => {
      httpClient.get.mockImplementation(
        serveDocuments({
          "https://docs.example.com/root.yaml": `openapi: "3.0.0"\npaths:\n  /pets:\n    $ref: "https://api.example.com/paths/pets.yaml#/petsPath"\n`,
          "https://api.example.com/paths/pets.yaml": `petsPath:\n  get:\n    summary: List pets\n`,
        })
      );

      const profile: Profile = {
        ...baseProfile,
        apiBaseUrl: "https://api.example.com/v1",
        openapiSpecSource: "https://docs.example.com/root.yaml",
      };

      const fs = new MemoryFs();
      const loader = new OpenapiLoader({ fs, httpClient });
      const loaded = await loader.loadSpec(profile, { refresh: true, headers: profileHeaders }) as Record<string, any>;

      expect(loaded.paths["/pets"].get.summary).toBe("List pets");
      expect(headersSentTo(httpClient, "https://docs.example.com/root.yaml")).toEqual(profileHeaders);
      expect(headersSentTo(httpClient, "https://api.example.com/paths/pets.yaml")).toEqual(profileHeaders);
    });
  });

  it("wraps a failed download into SpecFetchError carrying the URL and HTTP status", async () => {
    httpClient.get.mockRejectedValueOnce(
      Object.assign(new Error("Request failed with status code 401"), { response: { status: 401 } })
    );

    const profile: Profile = {
      ...baseProfile,
      openapiSpecSource: "https://api.example.com/openapi.json",
    };

    const fs = new MemoryFs();
    const loader = new OpenapiLoader({ fs, httpClient });

    const failure = await loader.loadSpec(profile, { refresh: true }).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(SpecFetchError);
    expect((failure as SpecFetchError).url).toBe("https://api.example.com/openapi.json");
    expect((failure as SpecFetchError).status).toBe(401);
    expect((failure as SpecFetchError).message).toContain("https://api.example.com/openapi.json");
    expect((failure as SpecFetchError).message).toContain("401");
    expect(fs.existsSync(profile.openapiSpecCache)).toBe(false);
  });
});
