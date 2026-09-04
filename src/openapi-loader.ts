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

export interface SpecHttpClient {
  get(url: string, options?: { headers?: Record<string, string> }): Promise<{ data: unknown }>;
}

export interface OpenapiLoaderOptions {
  fs?: FileSystemForLoader;
  httpClient?: SpecHttpClient;
}

export interface LoadSpecOptions {
  refresh?: boolean;
  headers?: Record<string, string>;
}

interface RemoteAuth {
  headers: Record<string, string>;
  origins: Set<string>;
}

interface ResolveContext {
  currentSource: string;
  currentDocument: unknown;
  rawDocCache: Map<string, unknown>;
  resolvingRefs: Set<string>;
  remoteAuth?: RemoteAuth;
}

export class SpecFetchError extends Error {
  readonly url: string;
  readonly status?: number;

  constructor(url: string, status: number | undefined, detail: string) {
    super(
      status === undefined
        ? `Failed to fetch OpenAPI document ${url}: ${detail}`
        : `Failed to fetch OpenAPI document ${url}: HTTP ${status}`
    );
    this.name = "SpecFetchError";
    this.url = url;
    this.status = status;
  }
}

const defaultHttpClient: SpecHttpClient = {
  get: async (url, options) => {
    const response = await axios.get(url, { responseType: "text", headers: options?.headers });
    return { data: response.data };
  },
};

export class OpenapiLoader {
  private readonly fs: FileSystemForLoader;
  private readonly httpClient: SpecHttpClient;

  constructor(options?: OpenapiLoaderOptions) {
    this.fs = options?.fs ?? fsModule;
    this.httpClient = options?.httpClient ?? defaultHttpClient;
  }

  async loadSpec(profile: Profile, options?: LoadSpecOptions): Promise<unknown> {
    const cachePath = profile.openapiSpecCache;

    if (!options?.refresh && this.fs.existsSync(cachePath)) {
      const cached = this.fs.readFileSync(cachePath, "utf-8");
      return JSON.parse(cached);
    }

    const spec = await this.loadAndResolveSpec(profile.openapiSpecSource, this.remoteAuthFor(profile, options?.headers));
    this.ensureCacheDir(cachePath);

    const serialized = JSON.stringify(spec, null, 2);
    this.fs.writeFileSync(cachePath, serialized);

    return spec;
  }

  private async loadAndResolveSpec(source: string, remoteAuth?: RemoteAuth): Promise<unknown> {
    const rawDocCache = new Map<string, unknown>();
    const root = await this.loadDocument(source, rawDocCache, remoteAuth);
    return this.resolveRefs(root, {
      currentSource: source,
      currentDocument: root,
      rawDocCache,
      resolvingRefs: new Set<string>(),
      remoteAuth,
    });
  }

  // Profile credentials are meant for the hosts the user configured: the spec URL and the API base URL.
  // Any other origin reachable through an external $ref is fetched anonymously.
  private remoteAuthFor(profile: Profile, headers?: Record<string, string>): RemoteAuth | undefined {
    if (!headers || Object.keys(headers).length === 0) {
      return undefined;
    }

    const origins = new Set<string>();
    for (const candidate of [profile.openapiSpecSource, profile.apiBaseUrl]) {
      const origin = this.originOf(candidate);
      if (origin) {
        origins.add(origin);
      }
    }

    return { headers, origins };
  }

  private headersFor(source: string, remoteAuth?: RemoteAuth): Record<string, string> | undefined {
    if (!remoteAuth) {
      return undefined;
    }
    const origin = this.originOf(source);
    return origin && remoteAuth.origins.has(origin) ? remoteAuth.headers : undefined;
  }

  private originOf(source: string): string | undefined {
    if (!this.isRemote(source)) {
      return undefined;
    }
    try {
      return new URL(source).origin;
    } catch {
      return undefined;
    }
  }

  private isRemote(source: string): boolean {
    return source.startsWith("http://") || source.startsWith("https://");
  }

  private async loadFromSource(source: string, remoteAuth?: RemoteAuth): Promise<unknown> {
    if (this.isRemote(source)) {
      const headers = this.headersFor(source, remoteAuth);
      let response: { data: unknown };
      try {
        response = await this.httpClient.get(source, headers ? { headers } : {});
      } catch (err) {
        throw this.toFetchError(source, err);
      }
      return this.parseSpec(response.data, source);
    }

    const raw = this.fs.readFileSync(source, "utf-8");
    return this.parseSpec(raw, source);
  }

  private toFetchError(url: string, err: unknown): SpecFetchError {
    if (err instanceof SpecFetchError) {
      return err;
    }
    const status = (err as { response?: { status?: unknown } } | undefined)?.response?.status;
    const detail = err instanceof Error ? err.message : String(err);
    return new SpecFetchError(url, typeof status === "number" ? status : undefined, detail);
  }

  private async loadDocument(source: string, rawDocCache: Map<string, unknown>, remoteAuth?: RemoteAuth): Promise<unknown> {
    if (rawDocCache.has(source)) {
      return rawDocCache.get(source);
    }

    const loaded = await this.loadFromSource(source, remoteAuth);
    rawDocCache.set(source, loaded);
    return loaded;
  }

  private parseSpec(content: unknown, source: string): unknown {
    if (typeof content !== "string") {
      return content;
    }
    if (this.isYamlSource(source) || !this.looksLikeJson(content)) {
      return yaml.load(content);
    }
    return JSON.parse(content);
  }

  private async resolveRefs(value: unknown, context: ResolveContext): Promise<unknown> {
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

  private async resolveRef(ref: string, context: ResolveContext): Promise<unknown> {
    const { source, pointer } = this.splitRef(ref, context.currentSource);
    const cacheKey = `${source}#${pointer}`;

    if (context.resolvingRefs.has(cacheKey)) {
      return { $ref: ref };
    }

    context.resolvingRefs.add(cacheKey);

    const targetDocument = source === context.currentSource
      ? context.currentDocument
      : await this.loadDocument(source, context.rawDocCache, context.remoteAuth);

    const targetValue = this.resolvePointer(targetDocument, pointer);
    const resolvedValue = await this.resolveRefs(targetValue, {
      ...context,
      currentSource: source,
      currentDocument: targetDocument,
    });

    context.resolvingRefs.delete(cacheKey);
    return resolvedValue;
  }

  private splitRef(ref: string, currentSource: string): { source: string; pointer: string } {
    const [refSource, pointer = ""] = ref.split("#", 2);
    if (!refSource) {
      return { source: currentSource, pointer };
    }

    if (this.isRemote(refSource)) {
      return { source: refSource, pointer };
    }

    if (this.isRemote(currentSource)) {
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
