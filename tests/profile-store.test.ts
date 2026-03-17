import { ConfigLocator } from "../src/config";
import { ProfileStore, Profile } from "../src/profile-store";

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

function createStoreWithFs(
  cwd: string,
  homeDir: string,
  files: Record<string, string>
): { store: ProfileStore; fs: MemoryFs } {
  const fs = new MemoryFs(files);
  const locator = new ConfigLocator({ fs, homeDir });
  const store = new ProfileStore({ fs, locator });
  return { store, fs };
}

describe("ProfileStore", () => {
  const homeDir = "/home/user";

  it("loads current profile from local profiles.ini and parses its fields", () => {
    const cwd = "/project";
    const localDir = `${cwd}/.ocli`;
    const profilesPath = `${localDir}/profiles.ini`;

    const iniContent = [
      "[myapi]",
      "api_base_url = http://127.0.0.1:3000",
      "api_basic_auth = ",
      "api_bearer_token = TOKEN",
      "openapi_spec_source = http://127.0.0.1:3000/openapi.json",
      "openapi_spec_cache = /home/user/.ocli/specs/myapi.json",
      "include_endpoints = get:/messages,get:/channels",
      "exclude_endpoints = post:/admin/secret",
      "",
    ].join("\n");

    const { store } = createStoreWithFs(cwd, homeDir, {
      [profilesPath]: iniContent,
      [`${localDir}/current`]: "myapi",
    });

    const currentName = store.getCurrentProfileName(cwd);
    expect(currentName).toBe("myapi");

    const profile = store.getCurrentProfile(cwd);
    expect(profile).not.toBeUndefined();
    expect(profile?.name).toBe("myapi");
    expect(profile?.apiBaseUrl).toBe("http://127.0.0.1:3000");
    expect(profile?.apiBearerToken).toBe("TOKEN");
    expect(profile?.includeEndpoints).toEqual(["get:/messages", "get:/channels"]);
    expect(profile?.excludeEndpoints).toEqual(["post:/admin/secret"]);
  });

  it("prefers local profiles.ini over global when both exist", () => {
    const cwd = "/project";
    const localDir = `${cwd}/.ocli`;
    const globalDir = `${homeDir}/.ocli`;

    const localIni = ["[localapi]", "api_base_url = http://local", ""].join("\n");
    const globalIni = ["[globalapi]", "api_base_url = http://global", ""].join("\n");

    const { store } = createStoreWithFs(cwd, homeDir, {
      [`${localDir}/profiles.ini`]: localIni,
      [`${localDir}/current`]: "localapi",
      [`${globalDir}/profiles.ini`]: globalIni,
      [`${globalDir}/current`]: "globalapi",
    });

    const currentName = store.getCurrentProfileName(cwd);
    expect(currentName).toBe("localapi");
  });

  it("saves a new profile and makes it current when requested", () => {
    const cwd = "/project";
    const localDir = `${cwd}/.ocli`;
    const profilesPath = `${localDir}/profiles.ini`;

    const { store, fs } = createStoreWithFs(cwd, homeDir, {});

    const profile: Profile = {
      name: "savedapi",
      apiBaseUrl: "http://example.com",
      apiBasicAuth: "",
      apiBearerToken: "X",
      authValues: {},
      openapiSpecSource: "http://example.com/openapi.json",
      openapiSpecCache: "/home/user/.ocli/specs/savedapi.json",
      includeEndpoints: ["get:/messages"],
      excludeEndpoints: [],
      commandPrefix: "",
      customHeaders: {},
    };

    store.saveProfile(cwd, profile, { makeCurrent: true });

    const currentName = store.getCurrentProfileName(cwd);
    expect(currentName).toBe("savedapi");

    const savedProfile = store.getCurrentProfile(cwd);
    expect(savedProfile?.name).toBe("savedapi");
    expect(savedProfile?.authValues).toEqual({});

    expect(fs.existsSync(localDir)).toBe(true);
    expect(fs.existsSync(profilesPath)).toBe(true);
  });

  it("persists auth_values JSON in profiles.ini", () => {
    const cwd = "/project";
    const { store } = createStoreWithFs(cwd, homeDir, {});

    const profile: Profile = {
      name: "secured",
      apiBaseUrl: "https://api.example.com",
      apiBasicAuth: "",
      apiBearerToken: "",
      authValues: {
        ApiKeyAuth: "secret-123",
        SessionCookie: "cookie-456",
      },
      openapiSpecSource: "https://api.example.com/openapi.json",
      openapiSpecCache: "/home/user/.ocli/specs/secured.json",
      includeEndpoints: [],
      excludeEndpoints: [],
      commandPrefix: "",
      customHeaders: {},
    };

    store.saveProfile(cwd, profile);

    const loaded = store.getProfileByName(cwd, "secured");
    expect(loaded?.authValues).toEqual({
      ApiKeyAuth: "secret-123",
      SessionCookie: "cookie-456",
    });
  });

  it("listProfileNames returns all profile section names", () => {
    const cwd = "/project";
    const localDir = `${cwd}/.ocli`;
    const iniContent = [
      "[default]",
      "api_base_url = http://default",
      "",
      "[myapi]",
      "api_base_url = http://a",
      "",
      "[other]",
      "api_base_url = http://b",
      "",
    ].join("\n");

    const { store } = createStoreWithFs(cwd, homeDir, {
      [`${localDir}/profiles.ini`]: iniContent,
    });

    const names = store.listProfileNames(cwd);
    expect(names.sort()).toEqual(["default", "myapi", "other"]);
  });

  it("removeProfile deletes profile section and sets current to default if it was current", () => {
    const cwd = "/project";
    const localDir = `${cwd}/.ocli`;
    const profilesPath = `${localDir}/profiles.ini`;
    const iniContent = [
      "[myapi]",
      "api_base_url = http://a",
      "",
      "[other]",
      "api_base_url = http://b",
      "",
    ].join("\n");

    const { store } = createStoreWithFs(cwd, homeDir, {
      [profilesPath]: iniContent,
      [`${localDir}/current`]: "myapi",
    });

    store.removeProfile(cwd, "myapi");

    expect(store.listProfileNames(cwd)).toEqual(["other"]);
    expect(store.getCurrentProfileName(cwd)).toBe("default");
  });

  it("setCurrentProfile writes current profile name to .ocli/current", () => {
    const cwd = "/project";
    const localDir = `${cwd}/.ocli`;
    const iniContent = [
      "[a]",
      "api_base_url = http://a",
      "",
      "[b]",
      "api_base_url = http://b",
      "",
    ].join("\n");

    const { store } = createStoreWithFs(cwd, homeDir, {
      [`${localDir}/profiles.ini`]: iniContent,
    });

    store.setCurrentProfile(cwd, "b");

    expect(store.getCurrentProfileName(cwd)).toBe("b");
  });
});
