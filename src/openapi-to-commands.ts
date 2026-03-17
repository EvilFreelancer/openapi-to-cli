import { Profile } from "./profile-store";

export type ParameterLocation = "path" | "query" | "header" | "cookie" | "body" | "formData";

export interface CliCommandOption {
  name: string;
  location: ParameterLocation;
  required: boolean;
  schemaType?: string;
  description?: string;
}

export interface CliCommand {
  name: string;
  method: string;
  path: string;
  options: CliCommandOption[];
  description?: string;
  requestContentType?: string;
}

type HttpMethod = "get" | "post" | "put" | "delete" | "patch" | "head" | "options" | "trace";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OpenapiSpecLike = any;

interface PathOperation {
  path: string;
  method: HttpMethod;
  pathParameters?: unknown[];
  operation: {
    summary?: string;
    description?: string;
    parameters?: unknown[];
    requestBody?: unknown;
    consumes?: string[];
  };
}

interface ParameterLike {
  name?: string;
  in?: string;
  required?: boolean;
  schema?: SchemaLike;
  type?: string;
  description?: string;
}

interface SchemaLike {
  type?: string;
  description?: string;
  required?: string[];
  properties?: Record<string, SchemaLike>;
  items?: SchemaLike;
  $ref?: string;
}

interface RequestBodyLike {
  required?: boolean;
  content?: Record<string, { schema?: SchemaLike }>;
}

export class OpenapiToCommands {
  buildCommands(spec: OpenapiSpecLike, profile: Profile): CliCommand[] {
    const operations = this.collectOperations(spec);
    const methodsByPath: Record<string, Set<HttpMethod>> = {};

    for (const op of operations) {
      if (!methodsByPath[op.path]) {
        methodsByPath[op.path] = new Set<HttpMethod>();
      }
      methodsByPath[op.path].add(op.method);
    }

    const filtered = this.applyFilters(operations, profile);
    const commands = this.toCliCommands(filtered, methodsByPath, spec);

    const prefix = profile.commandPrefix;
    if (prefix) {
      for (const cmd of commands) {
        cmd.name = `${prefix}${cmd.name}`;
      }
    }

    return commands;
  }

  private collectOperations(spec: OpenapiSpecLike): PathOperation[] {
    const result: PathOperation[] = [];
    const paths = spec.paths ?? {};

    const methods: HttpMethod[] = ["get", "post", "put", "delete", "patch", "head", "options", "trace"];

    for (const pathKey of Object.keys(paths)) {
      const pathItem = paths[pathKey];
      const pathParameters = Array.isArray(pathItem?.parameters) ? pathItem.parameters : [];
      for (const method of methods) {
        const op = pathItem[method];
        if (op) {
          result.push({
            path: pathKey,
            method,
            pathParameters,
            operation: op,
          });
        }
      }
    }

    return result;
  }

  private applyFilters(operations: PathOperation[], profile: Profile): PathOperation[] {
    const include = profile.includeEndpoints;
    const exclude = new Set(profile.excludeEndpoints);

    const hasInclude = include.length > 0;
    const includeSet = new Set(include);

    return operations.filter((op) => {
      const key = this.endpointKey(op.method, op.path);

      if (exclude.has(key)) {
        return false;
      }

      if (!hasInclude) {
        return true;
      }

      return includeSet.has(key);
    });
  }

  private toCliCommands(
    operations: PathOperation[],
    methodsByPath: Record<string, Set<HttpMethod>>,
    spec: OpenapiSpecLike
  ): CliCommand[] {
    const byPath: Record<string, PathOperation[]> = {};

    for (const op of operations) {
      if (!byPath[op.path]) {
        byPath[op.path] = [];
      }
      byPath[op.path].push(op);
    }

    const commands: CliCommand[] = [];

    for (const pathKey of Object.keys(byPath)) {
      const ops = byPath[pathKey];
      const baseName = this.commandBaseNameFromPath(pathKey);
      const allMethodsForPath = methodsByPath[pathKey];
      const multipleMethods = allMethodsForPath ? allMethodsForPath.size > 1 : ops.length > 1;

      for (const op of ops) {
        const name = multipleMethods ? `${baseName}_${op.method}` : baseName;
        const { options, requestContentType } = this.extractOptions(op, spec);
        const description = op.operation.summary ?? op.operation.description;

        commands.push({
          name,
          method: op.method,
          path: op.path,
          options,
          description,
          requestContentType,
        });
      }
    }

    return commands;
  }

  private extractOptions(
    op: PathOperation,
    spec: OpenapiSpecLike
  ): {
    options: CliCommandOption[];
    requestContentType?: string;
  } {
    const params = this.mergeParameters(op.pathParameters ?? [], op.operation.parameters ?? [], spec);
    const result: CliCommandOption[] = [];

    for (const param of params) {
      if (!param.name || !param.in) {
        continue;
      }

      if (param.in === "body") {
        result.push(...this.extractSchemaOptions(param.schema, {
          spec,
          location: "body",
          required: Boolean(param.required),
          fallbackName: "body",
        }));
        continue;
      }

      if (
        param.in !== "path" &&
        param.in !== "query" &&
        param.in !== "header" &&
        param.in !== "cookie" &&
        param.in !== "formData"
      ) {
        continue;
      }

      result.push({
        name: param.name,
        location: param.in,
        required: param.in === "path" ? true : Boolean(param.required),
        schemaType: this.getParameterSchemaType(param),
        description: param.description,
      });
    }

    const requestBody = this.resolveRequestBody(op.operation.requestBody, spec);
    if (!requestBody) {
      return {
        options: result,
        requestContentType: this.pickSwaggerConsumesType(op.operation.consumes),
      };
    }

    const requestContentType = this.pickRequestBodyContentType(requestBody);
    if (!requestContentType) {
      return { options: result };
    }

    const bodySchema = requestBody.content?.[requestContentType]?.schema;
    result.push(...this.extractSchemaOptions(bodySchema, {
      spec,
      location: requestContentType === "application/x-www-form-urlencoded" || requestContentType === "multipart/form-data"
        ? "formData"
        : "body",
      required: Boolean(requestBody.required),
      fallbackName: "body",
    }));

    return { options: result, requestContentType };
  }

  private commandBaseNameFromPath(pathValue: string): string {
    const segments = pathValue
      .split("/")
      .filter((segment) => segment.length > 0)
      .map((segment) => {
        if (segment.startsWith("{") && segment.endsWith("}")) {
          const inner = segment.slice(1, -1);
          return inner;
        }
        return segment;
      });

    return segments.join("_");
  }

  private endpointKey(method: HttpMethod, pathValue: string): string {
    return `${method}:${pathValue}`;
  }

  private mergeParameters(pathParameters: unknown[], operationParameters: unknown[], spec: OpenapiSpecLike): ParameterLike[] {
    const merged = new Map<string, ParameterLike>();

    for (const rawParam of pathParameters) {
      const param = this.resolveParameter(rawParam, spec);
      if (!param.name || !param.in) {
        continue;
      }
      merged.set(`${param.in}:${param.name}`, param);
    }

    for (const rawParam of operationParameters) {
      const param = this.resolveParameter(rawParam, spec);
      if (!param.name || !param.in) {
        continue;
      }
      merged.set(`${param.in}:${param.name}`, param);
    }

    return Array.from(merged.values());
  }

  private resolveParameter(rawParam: unknown, spec: OpenapiSpecLike): ParameterLike {
    return this.resolveValue(rawParam, spec) as ParameterLike;
  }

  private resolveRequestBody(rawBody: unknown, spec: OpenapiSpecLike): RequestBodyLike | undefined {
    if (!rawBody) {
      return undefined;
    }
    return this.resolveValue(rawBody, spec) as RequestBodyLike;
  }

  private resolveSchema(schema: SchemaLike | undefined, spec: OpenapiSpecLike): SchemaLike | undefined {
    if (!schema) {
      return undefined;
    }
    return this.resolveValue(schema, spec) as SchemaLike;
  }

  private resolveValue(value: unknown, spec: OpenapiSpecLike, seenRefs?: Set<string>): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.resolveValue(item, spec, seenRefs));
    }

    if (!value || typeof value !== "object") {
      return value;
    }

    const record = value as Record<string, unknown>;
    const ref = record.$ref;

    if (typeof ref === "string" && ref.startsWith("#/")) {
      const localSeen = seenRefs ?? new Set<string>();
      if (localSeen.has(ref)) {
        return value;
      }
      localSeen.add(ref);
      const resolvedTarget = this.resolveValue(this.getLocalRef(spec, ref), spec, localSeen);
      const siblingEntries = Object.entries(record).filter(([key]) => key !== "$ref");
      if (siblingEntries.length === 0) {
        localSeen.delete(ref);
        return resolvedTarget;
      }
      const resolvedSiblings = Object.fromEntries(
        siblingEntries.map(([key, siblingValue]) => [key, this.resolveValue(siblingValue, spec, localSeen)])
      );
      localSeen.delete(ref);

      if (resolvedTarget && typeof resolvedTarget === "object" && !Array.isArray(resolvedTarget)) {
        return {
          ...(resolvedTarget as Record<string, unknown>),
          ...resolvedSiblings,
        };
      }

      return resolvedSiblings;
    }

    const resolvedEntries = Object.entries(record).map(([key, nested]) => [key, this.resolveValue(nested, spec, seenRefs)]);
    return Object.fromEntries(resolvedEntries);
  }

  private getLocalRef(spec: OpenapiSpecLike, ref: string): unknown {
    const parts = ref
      .slice(2)
      .split("/")
      .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));

    let current: unknown = spec;
    for (const part of parts) {
      if (!current || typeof current !== "object" || !(part in (current as Record<string, unknown>))) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  private extractSchemaOptions(
    schema: SchemaLike | undefined,
    context: {
      spec: OpenapiSpecLike;
      location: "body" | "formData";
      required: boolean;
      fallbackName: string;
    }
  ): CliCommandOption[] {
    const resolvedSchema = this.resolveSchema(schema, context.spec);
    if (!resolvedSchema) {
      return [];
    }

    const properties = resolvedSchema.properties ?? {};
    const propertyNames = Object.keys(properties);

    if (resolvedSchema.type === "object" || propertyNames.length > 0) {
      if (propertyNames.length === 0) {
        return [{
          name: context.fallbackName,
          location: context.location,
          required: context.required,
          schemaType: resolvedSchema.type,
          description: resolvedSchema.description,
        }];
      }

      const required = new Set(resolvedSchema.required ?? []);
      return propertyNames.map((propertyName) => {
        const propertySchema = this.resolveSchema(properties[propertyName], context.spec);
        return {
          name: propertyName,
          location: context.location,
          required: required.has(propertyName),
          schemaType: propertySchema?.type,
          description: propertySchema?.description,
        };
      });
    }

    return [{
      name: context.fallbackName,
      location: context.location,
      required: context.required,
      schemaType: resolvedSchema.type,
      description: resolvedSchema.description,
    }];
  }

  private getParameterSchemaType(param: ParameterLike): string | undefined {
    if (param.schema?.type) {
      return param.schema.type;
    }
    return param.type;
  }

  private pickRequestBodyContentType(requestBody: RequestBodyLike): string | undefined {
    const content = requestBody.content ?? {};
    const contentTypes = Object.keys(content);
    if (contentTypes.length === 0) {
      return undefined;
    }

    const preferred = [
      "application/json",
      "application/x-www-form-urlencoded",
      "multipart/form-data",
    ];

    for (const candidate of preferred) {
      if (candidate in content) {
        return candidate;
      }
    }

    return contentTypes[0];
  }

  private pickSwaggerConsumesType(consumes?: string[]): string | undefined {
    if (!Array.isArray(consumes) || consumes.length === 0) {
      return undefined;
    }

    const preferred = [
      "application/json",
      "application/x-www-form-urlencoded",
      "multipart/form-data",
    ];

    for (const candidate of preferred) {
      if (consumes.includes(candidate)) {
        return candidate;
      }
    }

    return consumes[0];
  }
}
