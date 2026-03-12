import path from "path";
import fsModule from "fs";
import os from "os";

export interface FileSystemLike {
  existsSync(pathToCheck: string): boolean;
}

export interface ConfigPaths {
  configDir: string;
  profilesIniPath: string;
  specsDir: string;
}

export interface ConfigLocatorOptions {
  fs?: FileSystemLike;
  homeDir?: string;
}

export class ConfigLocator {
  private readonly fs: FileSystemLike;
  private readonly homeDir: string;

  constructor(options?: ConfigLocatorOptions) {
    this.fs = options?.fs ?? fsModule;
    this.homeDir = options?.homeDir ?? os.homedir();
  }

  resolveConfig(cwd: string): ConfigPaths {
    const localConfigDir = path.join(cwd, ".ocli");
    const globalConfigDir = path.join(this.homeDir, ".ocli");

    const localProfiles = path.join(localConfigDir, "profiles.ini");
    const globalProfiles = path.join(globalConfigDir, "profiles.ini");

    let configDir = localConfigDir;

    if (this.fs.existsSync(localProfiles)) {
      configDir = localConfigDir;
    } else if (this.fs.existsSync(globalProfiles)) {
      configDir = globalConfigDir;
    }

    const profilesIniPath = path.join(configDir, "profiles.ini");
    const specsDir = path.join(configDir, "specs");

    return {
      configDir,
      profilesIniPath,
      specsDir,
    };
  }
}
