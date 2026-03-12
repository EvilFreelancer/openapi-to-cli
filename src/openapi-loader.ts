import fsModule from "fs";
import path from "path";
import axios from "axios";

import { Profile } from "./profile-store";

interface FileSystemForLoader {
  existsSync(pathToCheck: string): boolean;
  readFileSync(pathToRead: string, encoding: BufferEncoding): string;
  writeFileSync(pathToWrite: string, data: string): void;
  mkdirSync(pathToCreate: string, options?: { recursive?: boolean }): void;
}

export interface OpenapiLoaderOptions {
  fs?: FileSystemForLoader;
}

export class OpenapiLoader {
  private readonly fs: FileSystemForLoader;

  constructor(options?: OpenapiLoaderOptions) {
    this.fs = options?.fs ?? fsModule;
  }

  async loadSpec(
    profile: Profile,
    options?: {
      refresh?: boolean;
    }
  ): Promise<unknown> {
    const cachePath = profile.openapiSpecCache;

    if (!options?.refresh && this.fs.existsSync(cachePath)) {
      const cached = this.fs.readFileSync(cachePath, "utf-8");
      return JSON.parse(cached);
    }

    const spec = await this.loadFromSource(profile.openapiSpecSource);
    this.ensureCacheDir(cachePath);

    const serialized = JSON.stringify(spec, null, 2);
    this.fs.writeFileSync(cachePath, serialized);

    return spec;
  }

  private async loadFromSource(source: string): Promise<unknown> {
    if (source.startsWith("http://") || source.startsWith("https://")) {
      const response = await axios.get(source);
      return response.data;
    }

    const raw = this.fs.readFileSync(source, "utf-8");
    return JSON.parse(raw);
  }

  private ensureCacheDir(cachePath: string): void {
    const dir = path.dirname(cachePath);
    if (!this.fs.existsSync(dir)) {
      this.fs.mkdirSync(dir, { recursive: true });
    }
  }
}
