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

    const spec = await this.loadAndResolveSpec(profile.openapiSpecSource);
    this.ensureCacheDir(cachePath);

    const serialized = JSON.stringify(spec, null, 2);
    this.fs.writeFileSync(cachePath, serialized);

    return spec;
  }

  private async loadAndResolveSpec(source: string): Promise<unknown> {
    const rawDocCache = new Map<string, unknown>();
    const root = await this.loadDocument(source, rawDocCache);
    return this.resolveRefs(root, {
      currentSource: source,
      currentDocument: root,
      rawDocCache,
      resolvingRefs: new Set<string>(),
    });
  }

  private async loadFromSource(source: string): Promise<unknown> {
    if (source.startsWith("http://") || source.startsWith("https://")) {
      const response = await axios.get(source, { responseType: "text" });
      return this.parseSpec(response.data, source);
    }

    const raw = this.fs.readFileSync(source, "utf-8");
    return this.parseSpec(raw, source);
  }

  private async loadDocument(source: string, rawDocCache: Map<string, unknown>): Promise<unknown> {
    if (rawDocCache.has(source)) {
      return rawDocCache.get(source);
    }

    const loaded = await this.loadFromSource(source);
    rawDocCache.set(source, loaded);
    return loaded;
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

  private async resolveRefs(
    value: unknown,
    context: {
      currentSource: string;
      currentDocument: unknown;
      rawDocCache: Map<string, unknown>;
      resolvingRefs: Set<string>;
    }
  ): Promise<unknown> {
    if (Array.isArray(value)) {
      const items = await Promise.all(value.map((item) => this.resolveRefs(item, context)));
      return items;
    }

    if (!value || typeof value !== "object") {
      return value;
    }

    const record = value as Record<string, unknown>;
    const ref = record.$ref;

    if (typeof ref === "string") {
      const siblingEntries = Object.entries(record).filter(([key]) => key !== "$ref");
      const resolvedRef = await this.resolveRef(ref, context);
      const resolvedSiblings = Object.fromEntries(
        await Promise.all(
          siblingEntries.map(async ([key, siblingValue]) => [key, await this.resolveRefs(siblingValue, context)] as const)
        )
      );

      if (resolvedRef && typeof resolvedRef === "object" && !Array.isArray(resolvedRef)) {
        return {
          ...(resolvedRef as Record<string, unknown>),
          ...resolvedSiblings,
        };
      }

      return Object.keys(resolvedSiblings).length > 0 ? resolvedSiblings : resolvedRef;
    }

    const resolvedEntries = await Promise.all(
      Object.entries(record).map(async ([key, nested]) => [key, await this.resolveRefs(nested, context)] as const)
    );
    return Object.fromEntries(resolvedEntries);
  }

  private async resolveRef(
    ref: string,
    context: {
      currentSource: string;
      currentDocument: unknown;
      rawDocCache: Map<string, unknown>;
      resolvingRefs: Set<string>;
    }
  ): Promise<unknown> {
    const { source, pointer } = this.splitRef(ref, context.currentSource);
    const cacheKey = `${source}#${pointer}`;

    if (context.resolvingRefs.has(cacheKey)) {
      return { $ref: ref };
    }

    context.resolvingRefs.add(cacheKey);

    const targetDocument = source === context.currentSource
      ? context.currentDocument
      : await this.loadDocument(source, context.rawDocCache);

    const targetValue = this.resolvePointer(targetDocument, pointer);
    const resolvedValue = await this.resolveRefs(targetValue, {
      currentSource: source,
      currentDocument: targetDocument,
      rawDocCache: context.rawDocCache,
      resolvingRefs: context.resolvingRefs,
    });

    context.resolvingRefs.delete(cacheKey);
    return resolvedValue;
  }

  private splitRef(ref: string, currentSource: string): { source: string; pointer: string } {
    const [refSource, pointer = ""] = ref.split("#", 2);
    if (!refSource) {
      return { source: currentSource, pointer };
    }

    if (refSource.startsWith("http://") || refSource.startsWith("https://")) {
      return { source: refSource, pointer };
    }

    if (currentSource.startsWith("http://") || currentSource.startsWith("https://")) {
      return { source: new URL(refSource, currentSource).toString(), pointer };
    }

    return { source: path.resolve(path.dirname(currentSource), refSource), pointer };
  }

  private resolvePointer(document: unknown, pointer: string): unknown {
    if (!pointer) {
      return document;
    }

    if (!pointer.startsWith("/")) {
      return document;
    }

    const parts = pointer
      .slice(1)
      .split("/")
      .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));

    let current: unknown = document;
    for (const part of parts) {
      if (!current || typeof current !== "object" || !(part in (current as Record<string, unknown>))) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }

    return current;
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
