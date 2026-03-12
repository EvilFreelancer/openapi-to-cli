import { Profile } from "./profile-store";

export type ParameterLocation = "path" | "query";

export interface CliCommandOption {
  name: string;
  location: ParameterLocation;
  required: boolean;
  schemaType?: string;
}

export interface CliCommand {
  name: string;
  method: string;
  path: string;
  options: CliCommandOption[];
}

type HttpMethod = "get" | "post" | "put" | "delete" | "patch" | "head" | "options";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OpenapiSpecLike = any;

interface PathOperation {
  path: string;
  method: HttpMethod;
  operation: {
    parameters?: Array<{
      name: string;
      in: string;
      required?: boolean;
      schema?: {
        type?: string;
      };
    }>;
  };
}

export class OpenapiToCommands {
  buildCommands(spec: OpenapiSpecLike, profile: Profile): CliCommand[] {
    const operations = this.collectOperations(spec);
    const filtered = this.applyFilters(operations, profile);
    return this.toCliCommands(filtered);
  }

  private collectOperations(spec: OpenapiSpecLike): PathOperation[] {
    const result: PathOperation[] = [];
    const paths = spec.paths ?? {};

    const methods: HttpMethod[] = ["get", "post", "put", "delete", "patch", "head", "options"];

    for (const pathKey of Object.keys(paths)) {
      const pathItem = paths[pathKey];
      for (const method of methods) {
        const op = pathItem[method];
        if (op) {
          result.push({
            path: pathKey,
            method,
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

  private toCliCommands(operations: PathOperation[]): CliCommand[] {
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
      const multipleMethods = ops.length > 1;

      for (const op of ops) {
        const name = multipleMethods ? `${baseName}_${op.method}` : baseName;
        const options = this.extractOptions(op);

        commands.push({
          name,
          method: op.method,
          path: op.path,
          options,
        });
      }
    }

    return commands;
  }

  private extractOptions(op: PathOperation): CliCommandOption[] {
    const params = op.operation.parameters ?? [];
    const result: CliCommandOption[] = [];

    for (const param of params) {
      if (param.in !== "path" && param.in !== "query") {
        continue;
      }

      result.push({
        name: param.name,
        location: param.in,
        required: Boolean(param.required),
        schemaType: param.schema?.type,
      });
    }

    return result;
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
}
