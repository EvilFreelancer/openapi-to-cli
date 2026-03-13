import fsModule from "fs";
import path from "path";
import axios from "axios";
import yaml from "js-yaml";

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
      const response = await axios.get(source, { responseType: "text" });
      return this.parseSpec(response.data, source);
    }

    const raw = this.fs.readFileSync(source, "utf-8");
    return this.parseSpec(raw, source);
  }

  private parseSpec(content: string | object, source: string): unknown {
    if (typeof content !== "string") {
      return content;
    }
    if (this.isYamlSource(source) || !this.looksLikeJson(content)) {
      return yaml.load(content);
    }
    return JSON.parse(content);
  }

  private isYamlSource(source: string): boolean {
    const lower = source.toLowerCase().split("?")[0];
    return lower.endsWith(".yaml") || lower.endsWith(".yml");
  }

  private looksLikeJson(content: string): boolean {
    const trimmed = content.trimStart();
    return trimmed.startsWith("{") || trimmed.startsWith("[");
  }

  private ensureCacheDir(cachePath: string): void {
    const dir = path.dirname(cachePath);
    if (!this.fs.existsSync(dir)) {
      this.fs.mkdirSync(dir, { recursive: true });
    }
  }
}
