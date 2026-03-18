import axios from "axios";
import { Profile } from "../src/profile-store";
import { OpenapiLoader } from "../src/openapi-loader";

jest.mock("axios");

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

describe("OpenapiLoader", () => {
  const mockedAxios = axios as jest.Mocked<typeof axios>;

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

  beforeEach(() => {
    mockedAxios.get.mockReset();
  });

  it("downloads spec from HTTP URL and caches it when cache is missing", async () => {
    const spec = { openapi: "3.0.0", info: { title: "API", version: "1.0.0" } };
    mockedAxios.get.mockResolvedValueOnce({ data: spec });

    const fs = new MemoryFs();
    const loader = new OpenapiLoader({ fs });

    const profile: Profile = {
      ...baseProfile,
      openapiSpecSource: "http://127.0.0.1:3000/openapi.json",
    };

    const loaded = await loader.loadSpec(profile);

    expect(loaded).toEqual(spec);
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

    const loader = new OpenapiLoader({ fs });

    const loaded = await loader.loadSpec(profile);

    expect(loaded).toEqual(cachedSpec);
    // No HTTP call is needed when cache exists.
    mockedAxios.get.mockClear();
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

    const loader = new OpenapiLoader({ fs });

    const loaded = await loader.loadSpec(profile, { refresh: true });

    expect(loaded).toEqual(sourceSpec);
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

    const loader = new OpenapiLoader({ fs });
    const loaded = await loader.loadSpec(profile, { refresh: true }) as Record<string, unknown>;

    expect((loaded as any).openapi).toBe("3.0.0");
    expect((loaded as any).info.title).toBe("YAML API");
    expect((loaded as any).paths["/test"].get.summary).toBe("Test endpoint");
  });

  it("loads YAML spec from HTTP URL", async () => {
    const yamlContent = `openapi: "3.0.0"\ninfo:\n  title: Remote YAML\n  version: "2.0"\npaths: {}`;
    mockedAxios.get.mockResolvedValueOnce({ data: yamlContent });

    const profile: Profile = {
      ...baseProfile,
      openapiSpecSource: "https://example.com/spec.yaml",
    };

    const fs = new MemoryFs();
    const loader = new OpenapiLoader({ fs });
    const loaded = await loader.loadSpec(profile, { refresh: true }) as Record<string, unknown>;

    expect((loaded as any).openapi).toBe("3.0.0");
    expect((loaded as any).info.title).toBe("Remote YAML");
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

    const loader = new OpenapiLoader({ fs });
    const loaded = await loader.loadSpec(profile, { refresh: true }) as Record<string, unknown>;

    expect((loaded as any).info.title).toBe("Auto Detect");
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

    const loader = new OpenapiLoader({ fs });
    const loaded = await loader.loadSpec(profile, { refresh: true }) as Record<string, any>;

    expect(loaded.paths["/jobs"].post.requestBody.content["application/json"].schema.properties.name.type).toBe("string");
  });

  it("resolves remote external refs across multiple documents", async () => {
    mockedAxios.get.mockImplementation(async (source: string) => {
      if (source === "https://example.com/root.yaml") {
        return {
          data: `openapi: "3.0.0"\npaths:\n  /jobs:\n    $ref: "./paths/jobs.yaml#/jobsPath"\n`,
        };
      }

      if (source === "https://example.com/paths/jobs.yaml") {
        return {
          data: `jobsPath:\n  get:\n    parameters:\n      - $ref: "../components/params.yaml#/JobId"\n`,
        };
      }

      if (source === "https://example.com/components/params.yaml") {
        return {
          data: `JobId:\n  name: job_id\n  in: query\n  required: true\n  schema:\n    type: string\n`,
        };
      }

      throw new Error(`Unexpected URL: ${source}`);
    });

    const profile: Profile = {
      ...baseProfile,
      openapiSpecSource: "https://example.com/root.yaml",
    };

    const fs = new MemoryFs();
    const loader = new OpenapiLoader({ fs });
    const loaded = await loader.loadSpec(profile, { refresh: true }) as Record<string, any>;

    expect(loaded.paths["/jobs"].get.parameters[0].name).toBe("job_id");
    expect(loaded.paths["/jobs"].get.parameters[0].in).toBe("query");
  });
});
