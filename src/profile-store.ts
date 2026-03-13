import fsModule from "fs";
import path from "path";
import ini from "ini";

import { ConfigLocator, ConfigPaths } from "./config";

export interface Profile {
  name: string;
  apiBaseUrl: string;
  apiBasicAuth: string;
  apiBearerToken: string;
  openapiSpecSource: string;
  openapiSpecCache: string;
  includeEndpoints: string[];
  excludeEndpoints: string[];
  commandPrefix: string;
  customHeaders: Record<string, string>;
}

interface FileSystemExtended {
  existsSync(pathToCheck: string): boolean;
  readFileSync(pathToRead: string, encoding: BufferEncoding): string;
  writeFileSync(pathToWrite: string, data: string): void;
  mkdirSync(pathToCreate: string, options?: { recursive?: boolean }): void;
}

export interface ProfileStoreOptions {
  fs?: FileSystemExtended;
  locator?: ConfigLocator;
}

export class ProfileStore {
  private readonly fs: FileSystemExtended;
  private readonly locator: ConfigLocator;

  constructor(options?: ProfileStoreOptions) {
    this.fs = options?.fs ?? fsModule;
    this.locator = options?.locator ?? new ConfigLocator();
  }

  getCurrentProfileName(cwd: string): string {
    const configPaths = this.getConfigPaths(cwd);
    const currentPath = path.join(configPaths.configDir, "current");
    if (!this.fs.existsSync(currentPath)) {
      return "default";
    }
    const raw = this.fs.readFileSync(currentPath, "utf-8").trim();
    return raw || "default";
  }

  getCurrentProfile(cwd: string): Profile | undefined {
    const currentName = this.getCurrentProfileName(cwd);
    return this.getProfileByName(cwd, currentName);
  }

  getProfileByName(cwd: string, name: string): Profile | undefined {
    const iniData = this.readIni(cwd);
    const section = iniData[name] as Record<string, string> | undefined;
    if (!section) {
      return undefined;
    }

    const includeRaw = section.include_endpoints ?? "";
    const excludeRaw = section.exclude_endpoints ?? "";

    const includeEndpoints = includeRaw
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    const excludeEndpoints = excludeRaw
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    const customHeadersRaw = section.custom_headers ?? "";
    const customHeaders: Record<string, string> = {};
    if (customHeadersRaw) {
      customHeadersRaw.split(",").forEach((pair: string) => {
        const colonIdx = pair.indexOf(":");
        if (colonIdx > 0) {
          const key = pair.slice(0, colonIdx).trim();
          const value = pair.slice(colonIdx + 1).trim();
          if (key) customHeaders[key] = value;
        }
      });
    }

    return {
      name,
      apiBaseUrl: section.api_base_url ?? "",
      apiBasicAuth: section.api_basic_auth ?? "",
      apiBearerToken: section.api_bearer_token ?? "",
      openapiSpecSource: section.openapi_spec_source ?? "",
      openapiSpecCache: section.openapi_spec_cache ?? "",
      includeEndpoints,
      excludeEndpoints,
      commandPrefix: section.command_prefix ?? "",
      customHeaders,
    };
  }

  listProfileNames(cwd: string): string[] {
    const iniData = this.readIni(cwd);
    return Object.keys(iniData);
  }

  removeProfile(cwd: string, name: string): void {
    const configPaths = this.getConfigPaths(cwd);
    if (!this.fs.existsSync(configPaths.profilesIniPath)) {
      return;
    }
    const currentName = this.getCurrentProfileName(cwd);
    const iniData = this.readIni(cwd);
    delete iniData[name];
    const serialized = ini.encode(iniData);
    this.fs.writeFileSync(configPaths.profilesIniPath, serialized);
    if (currentName === name) {
      this.writeCurrentProfileName(configPaths, "default");
    }
  }

  setCurrentProfile(cwd: string, name: string): void {
    const configPaths = this.getConfigPaths(cwd);
    this.ensureConfigDir(configPaths);
    this.writeCurrentProfileName(configPaths, name);
  }

  saveProfile(
    cwd: string,
    profile: Profile,
    options?: {
      makeCurrent?: boolean;
    }
  ): void {
    const configPaths = this.getConfigPaths(cwd);
    this.ensureConfigDir(configPaths);

    const iniData = this.readIni(cwd);

    const sectionName = profile.name;
    const customHeadersStr = Object.entries(profile.customHeaders)
      .map(([k, v]) => `${k}:${v}`)
      .join(",");

    iniData[sectionName] = {
      api_base_url: profile.apiBaseUrl,
      api_basic_auth: profile.apiBasicAuth,
      api_bearer_token: profile.apiBearerToken,
      openapi_spec_source: profile.openapiSpecSource,
      openapi_spec_cache: profile.openapiSpecCache,
      include_endpoints: profile.includeEndpoints.join(","),
      exclude_endpoints: profile.excludeEndpoints.join(","),
      command_prefix: profile.commandPrefix,
      custom_headers: customHeadersStr,
    };

    const serialized = ini.encode(iniData);
    this.fs.writeFileSync(configPaths.profilesIniPath, serialized);

    if (options?.makeCurrent) {
      this.writeCurrentProfileName(configPaths, profile.name);
    }
  }

  private writeCurrentProfileName(configPaths: ConfigPaths, name: string): void {
    const currentPath = path.join(configPaths.configDir, "current");
    this.fs.writeFileSync(currentPath, name);
  }

  private readIni(cwd: string): Record<string, unknown> {
    const configPaths = this.getConfigPaths(cwd);
    if (!this.fs.existsSync(configPaths.profilesIniPath)) {
      return {};
    }
    const raw = this.fs.readFileSync(configPaths.profilesIniPath, "utf-8");
    return ini.parse(raw);
  }

  private getConfigPaths(cwd: string): ConfigPaths {
    return this.locator.resolveConfig(cwd);
  }

  private ensureConfigDir(configPaths: ConfigPaths): void {
    const dir = configPaths.configDir;
    if (!this.fs.existsSync(dir)) {
      this.fs.mkdirSync(dir, { recursive: true });
    }
    const specsDir = path.join(dir, "specs");
    if (!this.fs.existsSync(specsDir)) {
      this.fs.mkdirSync(specsDir, { recursive: true });
    }
  }
}
