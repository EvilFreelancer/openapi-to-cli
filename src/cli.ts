#!/usr/bin/env node

import path from "path";
import yargs from "yargs";
import axios, { AxiosRequestConfig, AxiosResponse } from "axios";

import { ConfigLocator } from "./config";
import { ProfileStore, Profile } from "./profile-store";
import { OpenapiLoader } from "./openapi-loader";
import { OpenapiToCommands, CliCommand, CliCommandOption } from "./openapi-to-commands";
import { CommandSearch } from "./command-search";
import { VERSION } from "./version";

export interface HttpClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  request(config: AxiosRequestConfig): Promise<AxiosResponse<any>>;
}

export interface RunOptions {
  cwd?: string;
  configLocator?: ConfigLocator;
  profileStore?: ProfileStore;
  openapiLoader?: OpenapiLoader;
  stdout?: (msg: string) => void;
  httpClient?: HttpClient;
}

const defaultStdout = (msg: string): void => {
  process.stdout.write(msg);
};

const defaultHttpClient: HttpClient = {
  request: (config: AxiosRequestConfig) => axios.request(config),
};

interface AddProfileArgs {
  "api-base-url": string;
  "openapi-spec": string;
  "api-basic-auth"?: string;
  "api-bearer-token"?: string;
  "include-endpoints"?: string;
  "exclude-endpoints"?: string;
  "command-prefix"?: string;
  "custom-headers"?: string;
}

async function runApiCommand(
  toolName: string,
  args: string[],
  env: {
    cwd: string;
    profileStore: ProfileStore;
    openapiLoader: OpenapiLoader;
    stdout: (msg: string) => void;
    httpClient: HttpClient;
  }
): Promise<void> {
  const { cwd, profileStore, openapiLoader, stdout, httpClient } = env;
  const openapiToCommands = new OpenapiToCommands();

  const profile = profileStore.getCurrentProfile(cwd);
  if (!profile) {
    throw new Error("No current profile configured");
  }

  const spec = await openapiLoader.loadSpec(profile);
  const commands = openapiToCommands.buildCommands(spec, profile);
  const command = commands.find((cmd) => cmd.name === toolName);

  if (!command) {
    throw new Error(`Command ${toolName} is not available for profile ${profile.name}`);
  }

  if (args.includes("-h") || args.includes("--help")) {
    stdout(`ocli ${command.name}\n\n`);

    if (command.description) {
      stdout(`${command.description}\n\n`);
    }

    stdout("Options:\n\n");

    const entries: Array<{
      key: string;
      desc: string;
      typeLabel: string;
      requiredLabel: string;
    }> = [];

    command.options.forEach((opt: CliCommandOption) => {
      const key = `--${opt.name}`;
      const requiredLabel = opt.required ? "required" : "";
      const baseType = opt.schemaType;
      let typeLabel = "string";
      if (baseType === "integer" || baseType === "number") {
        typeLabel = "number";
      } else if (baseType === "boolean") {
        typeLabel = "boolean";
      }
      const hintParts: string[] = [];
      if (opt.enumValues && opt.enumValues.length > 0) {
        hintParts.push(`enum: ${opt.enumValues.join(", ")}`);
      }
      if (opt.defaultValue !== undefined) {
        hintParts.push(`default: ${opt.defaultValue}`);
      }
      if (opt.nullable) {
        hintParts.push("nullable");
      }
      if (opt.oneOfTypes && opt.oneOfTypes.length > 0) {
        hintParts.push(`oneOf: ${opt.oneOfTypes.join(" | ")}`);
      }

      const descriptionPart = [opt.description ?? "", ...hintParts].filter(Boolean).join("; ");
      const descPrefix = opt.required ? "(required)" : "(optional)";
      const desc = descriptionPart ? `${descPrefix} ${descriptionPart}` : descPrefix;

      entries.push({
        key,
        desc,
        typeLabel,
        requiredLabel,
      });
    });

    entries.push({
      key: "-h, --help",
      desc: "Show help",
      typeLabel: "boolean",
      requiredLabel: "",
    });

    const maxKeyLength = entries.reduce((max, entry) => (entry.key.length > max ? entry.key.length : max), 0);
    const maxDescLength = entries.reduce((max, entry) => (entry.desc.length > max ? entry.desc.length : max), 0);
    const maxTypeLength = entries.reduce(
      (max, entry) => (entry.typeLabel.length > max ? entry.typeLabel.length : max),
      0
    );

    entries.forEach((entry, index) => {
      const keyPadded = entry.key.padEnd(maxKeyLength + 2, " ");
      const descPadded = entry.desc.padEnd(maxDescLength + 2, " ");
      const typePadded = entry.typeLabel.padEnd(maxTypeLength, " ");
      const requiredSuffix = entry.requiredLabel ? ` [${entry.requiredLabel}]` : "";

      const prefix = index === entries.length - 1 ? "  " : "      ";
      stdout(
        `${prefix}${keyPadded}${descPadded}[${typePadded}]${requiredSuffix}\n`
      );
    });

    stdout("\n");
    return;
  }

  const { flags } = parseArgs(args);

  const missingRequired = command.options
    .filter((opt) => opt.required)
    .filter((opt) => flags[opt.name] === undefined)
    .map((opt) => opt.name);

  if (missingRequired.length > 0) {
    throw new Error(`Missing required options: ${missingRequired.map((n) => `--${n}`).join(", ")}`);
  }

  const url = buildRequestUrl(profile, command, flags);
  const headers = buildHeaders(profile, command, flags);
  const payload = buildRequestPayload(command, flags);

  const method = command.method.toUpperCase();
  const hasBody = payload.data !== undefined;

  const requestConfig: AxiosRequestConfig = {
    method,
    url,
    headers: {
      ...headers,
      ...(hasBody && payload.contentType ? { "Content-Type": payload.contentType } : {}),
    },
    ...(hasBody ? { data: payload.data } : {}),
  };

  const response = await httpClient.request(requestConfig);
  stdout(`${JSON.stringify(response.data, null, 2)}\n`);
}

function parseBodyFlagValue(value: string): unknown {
  const trimmed = value.trim();

  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      throw new Error(`Invalid JSON body value: ${trimmed}`);
    }
  }

  return value;
}

function parseArgs(args: string[]): { flags: Record<string, string>; positional: string[] } {
  const flags: Record<string, string> = {};
  const positional: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--") {
      for (let j = i + 1; j < args.length; j += 1) {
        positional.push(args[j]);
      }
      break;
    }
    if (arg.startsWith("--")) {
      const withoutPrefix = arg.slice(2);
      const [key, inlineValue] = withoutPrefix.split("=", 2);
      if (inlineValue !== undefined) {
        flags[key] = inlineValue;
      } else if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
        flags[key] = args[i + 1];
        i += 1;
      } else {
        flags[key] = "true";
      }
    } else {
      positional.push(arg);
    }
  }

  return { flags, positional };
}

function buildRequestUrl(profile: Profile, command: CliCommand, flags: Record<string, string>): string {
  let pathValue = command.path;

  command.options
    .filter((opt) => opt.location === "path")
    .forEach((opt) => {
      const value = flags[opt.name];
      if (value !== undefined) {
        const token = `{${opt.name}}`;
        pathValue = pathValue.replace(token, serializePathParameter(opt, value));
      }
    });

  const baseUrl = (
    command.serverUrlOverridesProfile
      ? command.serverUrl ?? ""
      : profile.apiBaseUrl || command.serverUrl || ""
  ).replace(/\/+$/, "");
  let url = baseUrl ? `${baseUrl}${pathValue}` : pathValue;

  const queryParts: string[] = [];
  command.options
    .filter((opt) => opt.location === "query")
    .forEach((opt) => {
      const value = flags[opt.name];
      if (value !== undefined) {
        queryParts.push(...serializeQueryParameter(opt, value));
      }
    });

  if (queryParts.length > 0) {
    url += url.includes("?") ? `&${queryParts.join("&")}` : `?${queryParts.join("&")}`;
  }

  return url;
}

function buildHeaders(profile: Profile, command: CliCommand, flags: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {};

  if (profile.customHeaders) {
    Object.assign(headers, profile.customHeaders);
  }

  if (profile.apiBasicAuth) {
    const encoded = Buffer.from(profile.apiBasicAuth).toString("base64");
    headers.Authorization = `Basic ${encoded}`;
  } else if (profile.apiBearerToken) {
    headers.Authorization = `Bearer ${profile.apiBearerToken}`;
  }

  const cookiePairs: string[] = [];
  command.options
    .filter((opt) => opt.location === "header" || opt.location === "cookie")
    .forEach((opt) => {
      const value = flags[opt.name];
      if (value === undefined) {
        return;
      }

      if (opt.location === "header") {
        headers[opt.name] = value;
        return;
      }

      cookiePairs.push(`${encodeURIComponent(opt.name)}=${encodeURIComponent(value)}`);
    });

  if (cookiePairs.length > 0) {
    headers.Cookie = cookiePairs.join("; ");
  }

  return headers;
}

function buildRequestPayload(
  command: CliCommand,
  flags: Record<string, string>
): {
  data?: unknown;
  contentType?: string;
} {
  const knownOptionNames = new Set(command.options.map((o) => o.name));
  const bodyOptions = command.options.filter((opt) => opt.location === "body");
  const formOptions = command.options.filter((opt) => opt.location === "formData");
  const extraBodyEntries = Object.entries(flags)
    .filter(([key]) => !knownOptionNames.has(key))
    .map(([key, value]) => [key, parseBodyFlagValue(value)] as const);

  if (bodyOptions.length === 1 && bodyOptions[0].name === "body" && flags.body !== undefined) {
    return {
      data: parseBodyFlagValue(flags.body),
      contentType: command.requestContentType ?? "application/json",
    };
  }

  if (formOptions.length > 0) {
    const formEntries = formOptions
      .filter((opt) => flags[opt.name] !== undefined)
      .map((opt) => [opt.name, String(flags[opt.name])] as const);

    if (formEntries.length === 0) {
      return {};
    }

    if (command.requestContentType === "application/x-www-form-urlencoded") {
      const params = new URLSearchParams();
      formEntries.forEach(([key, value]) => params.append(key, value));
      return {
        data: params,
        contentType: "application/x-www-form-urlencoded",
      };
    }

    return {
      data: Object.fromEntries(formEntries),
      contentType: command.requestContentType ?? "multipart/form-data",
    };
  }

  const declaredBodyEntries = bodyOptions
    .filter((opt) => flags[opt.name] !== undefined)
    .map((opt) => [opt.name, parseBodyFlagValue(flags[opt.name])] as const);

  if (declaredBodyEntries.length > 0 || extraBodyEntries.length > 0) {
    return {
      data: Object.fromEntries([...declaredBodyEntries, ...extraBodyEntries]),
      contentType: command.requestContentType ?? "application/json",
    };
  }

  return {};
}

function serializePathParameter(option: CliCommandOption, rawValue: string): string {
  const value = parseStructuredParameterValue(option, rawValue);

  if (Array.isArray(value)) {
    const encoded = value.map((item) => encodeURIComponent(String(item)));
    const style = option.style ?? "simple";
    const explode = option.explode ?? false;

    if (style === "label") {
      return explode ? `.${encoded.join(".")}` : `.${encoded.join(",")}`;
    }

    if (style === "matrix") {
      return explode
        ? encoded.map((item) => `;${encodeURIComponent(option.name)}=${item}`).join("")
        : `;${encodeURIComponent(option.name)}=${encoded.join(",")}`;
    }

    return encoded.join(",");
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([key, item]) => [encodeURIComponent(key), encodeURIComponent(String(item))] as const
    );
    const style = option.style ?? "simple";
    const explode = option.explode ?? false;

    if (style === "label") {
      return explode
        ? `.${entries.map(([key, item]) => `${key}=${item}`).join(".")}`
        : `.${entries.flat().join(",")}`;
    }

    if (style === "matrix") {
      return explode
        ? entries.map(([key, item]) => `;${key}=${item}`).join("")
        : `;${encodeURIComponent(option.name)}=${entries.flat().join(",")}`;
    }

    return explode
      ? entries.map(([key, item]) => `${key}=${item}`).join(",")
      : entries.flat().join(",");
  }

  return encodeURIComponent(String(value));
}

function serializeQueryParameter(option: CliCommandOption, rawValue: string): string[] {
  const value = parseStructuredParameterValue(option, rawValue);
  const encodedName = encodeURIComponent(option.name);

  if (Array.isArray(value)) {
    const encodedValues = value.map((item) => encodeURIComponent(String(item)));

    if (option.collectionFormat === "multi") {
      return encodedValues.map((item) => `${encodedName}=${item}`);
    }

    const joiner = option.collectionFormat === "ssv"
      ? " "
      : option.collectionFormat === "tsv"
        ? "\t"
        : option.collectionFormat === "pipes"
          ? "|"
          : option.style === "spaceDelimited"
            ? " "
            : option.style === "pipeDelimited"
              ? "|"
              : ",";

    const explode = option.collectionFormat
      ? option.collectionFormat === "multi"
      : option.explode ?? true;

    if (explode && joiner === ",") {
      return encodedValues.map((item) => `${encodedName}=${item}`);
    }

    return [`${encodedName}=${encodedValues.join(encodeURIComponent(joiner))}`];
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([key, item]) => [encodeURIComponent(key), encodeURIComponent(String(item))] as const
    );
    const style = option.style ?? "form";
    const explode = option.explode ?? true;

    if (style === "deepObject") {
      return entries.map(([key, item]) => `${encodedName}%5B${key}%5D=${item}`);
    }

    if (explode) {
      return entries.map(([key, item]) => `${key}=${item}`);
    }

    return [`${encodedName}=${entries.flat().join(",")}`];
  }

  return [`${encodedName}=${encodeURIComponent(String(value))}`];
}

function parseStructuredParameterValue(option: CliCommandOption, rawValue: string): unknown {
  if (option.schemaType === "array") {
    const trimmed = rawValue.trim();
    if (trimmed.startsWith("[")) {
      return parseBodyFlagValue(rawValue);
    }
    return rawValue.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
  }

  if (option.schemaType === "object") {
    const trimmed = rawValue.trim();
    if (!trimmed.startsWith("{")) {
      throw new Error(`Object parameter --${option.name} expects JSON object value`);
    }
    return parseBodyFlagValue(rawValue);
  }

  return rawValue;
}

export async function run(argv: string[], options?: RunOptions): Promise<void> {
  const cwd = options?.cwd ?? process.cwd();
  const configLocator = options?.configLocator ?? new ConfigLocator();
  const profileStore = options?.profileStore ?? new ProfileStore({ locator: configLocator });
  const openapiLoader = options?.openapiLoader ?? new OpenapiLoader();
  const stdout = options?.stdout ?? defaultStdout;
  const httpClient = options?.httpClient ?? defaultHttpClient;
  const openapiToCommands = new OpenapiToCommands();

  const runAddProfile = async (profileName: string, args: AddProfileArgs): Promise<void> => {
    const configPaths = configLocator.resolveConfig(cwd);
    const cachePath = path.join(configPaths.specsDir, `${profileName}.json`);
    const includeEndpoints = args["include-endpoints"]
      ? args["include-endpoints"].split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    const excludeEndpoints = args["exclude-endpoints"]
      ? args["exclude-endpoints"].split(",").map((s) => s.trim()).filter(Boolean)
      : [];

    const customHeaders: Record<string, string> = {};
    if (args["custom-headers"]) {
      const raw = args["custom-headers"].trim();
      if (raw.startsWith("{")) {
        try {
          Object.assign(customHeaders, JSON.parse(raw));
        } catch {
          throw new Error("Invalid --custom-headers JSON. Expected format: '{\"Key\":\"Value\"}'");
        }
      } else {
        // Legacy comma-separated format: Key:Value,Key2:Value2
        raw.split(",").forEach((pair) => {
          const colonIdx = pair.indexOf(":");
          if (colonIdx > 0) {
            const key = pair.slice(0, colonIdx).trim();
            const value = pair.slice(colonIdx + 1).trim();
            if (key) customHeaders[key] = value;
          }
        });
      }
    }

    const profile: Profile = {
      name: profileName,
      apiBaseUrl: args["api-base-url"],
      apiBasicAuth: args["api-basic-auth"] ?? "",
      apiBearerToken: args["api-bearer-token"] ?? "",
      openapiSpecSource: args["openapi-spec"],
      openapiSpecCache: cachePath,
      includeEndpoints,
      excludeEndpoints,
      commandPrefix: args["command-prefix"] ?? "",
      customHeaders,
    };

    await openapiLoader.loadSpec(profile, { refresh: true });
    profileStore.saveProfile(cwd, profile, { makeCurrent: true });
  };

  const addProfileOptions = (y: ReturnType<typeof yargs>) =>
    y
      .option("api-base-url", {
        type: "string",
        demandOption: true,
        description: "Base URL for API requests.",
      })
      .option("openapi-spec", { type: "string", demandOption: true })
      .option("api-basic-auth", { type: "string", default: "" })
      .option("api-bearer-token", { type: "string", default: "" })
      .option("include-endpoints", { type: "string", default: "" })
      .option("exclude-endpoints", { type: "string", default: "" })
      .option("command-prefix", { type: "string", default: "", description: "Prefix for command names (e.g. api_ -> api_messages)" })
      .option("custom-headers", { type: "string", default: "", description: "Custom headers as JSON string, e.g. '{\"X-Tenant\":\"acme\"}'" });

  const staticCommands = new Set(["onboard", "profiles", "use", "commands", "search", "help", "--help", "-h", "--version"]);

  if (argv.length > 0 && !staticCommands.has(argv[0])) {
    const [toolName, ...rest] = argv;
    await runApiCommand(toolName, rest, { cwd, profileStore, openapiLoader, stdout, httpClient });
    return;
  }

  await yargs(argv)
    .scriptName("ocli")
    .version(VERSION)
    .exitProcess(false)
    .command(
      "onboard",
      "Add a new profile (alias for profiles add default)",
      (y) => addProfileOptions(y.version(false)),
      async (args) => {
        await runAddProfile("default", args as AddProfileArgs);
      }
    )
    .command(
      "profiles",
      "Profile management",
      (y) =>
        y
          .version(false)
          .demandCommand(1, "")
          .command(
            "add <profile>",
            "Add a new profile and cache OpenAPI spec",
            (yy) => addProfileOptions(yy.positional("profile", { type: "string", demandOption: true })),
            async (args) => {
              await runAddProfile(args.profile as string, args as unknown as AddProfileArgs);
            }
          )
          .command(
            "list",
            "List all profiles",
            () => {},
            () => {
              const names = profileStore.listProfileNames(cwd);
              names.forEach((n) => stdout(n + "\n"));
            }
          )
          .command(
            "show <profile>",
            "Show profile details",
            (yy) => yy.positional("profile", { type: "string", demandOption: true }),
            (args) => {
              const profile = profileStore.getProfileByName(cwd, args.profile as string);
              if (!profile) {
                throw new Error(`Profile not found: ${args.profile}`);
              }
              stdout(`name: ${profile.name}\n`);
              stdout(`api_base_url: ${profile.apiBaseUrl}\n`);
              stdout(`api_bearer_token: ${profile.apiBearerToken ? "(set)" : ""}\n`);
              stdout(`openapi_spec_cache: ${profile.openapiSpecCache}\n`);
            }
          )
          .command(
            "remove <profile>",
            "Remove a profile",
            (yy) => yy.positional("profile", { type: "string", demandOption: true }),
            (args) => {
              profileStore.removeProfile(cwd, args.profile as string);
            }
          )
    )
    .command(
      "use <profile>",
      "Set default profile",
      (y) => y.version(false).positional("profile", { type: "string", demandOption: true }),
      (args) => {
        profileStore.setCurrentProfile(cwd, args.profile as string);
      }
    )
    .command(
      "commands",
      "List available commands for the current profile (supports --query/--regex search filters)",
      (y) =>
        y
          .version(false)
          .option("query", {
            alias: "q",
            type: "string",
            description: "Natural language search query to filter commands",
          })
          .option("regex", {
            alias: "r",
            type: "string",
            description: "Regex pattern to filter commands by name, path, or description",
          })
          .option("limit", {
            alias: "n",
            type: "number",
            default: 10,
            description: "Maximum number of results when using query or regex filters",
          }),
      async (args) => {
        const profile = profileStore.getCurrentProfile(cwd);
        if (!profile) {
          throw new Error("No current profile configured");
        }
        const spec = await openapiLoader.loadSpec(profile);
        const commands = openapiToCommands.buildCommands(spec, profile);
        if (commands.length === 0) {
          stdout(`No commands available for profile ${profile.name}\n`);
          return;
        }

        const hasFilters = Boolean(args.query || args.regex);

        if (!hasFilters) {
          stdout(`Available commands for profile ${profile.name}:\n\n`);

          const maxNameLength = commands.reduce((max, cmd) => (cmd.name.length > max ? cmd.name.length : max), 0);
          const padding = maxNameLength + 2;

          commands.forEach((cmd) => {
            const description = cmd.description ?? "";
            const namePadded = cmd.name.padEnd(padding, " ");
            stdout(`  ${namePadded}${description}\n`);
          });
          return;
        }

        const searcher = new CommandSearch();
        searcher.load(commands);

        const limit = (args.limit as number) ?? 10;
        const results = args.query
          ? searcher.search(args.query as string, limit)
          : searcher.searchRegex(args.regex as string, limit);

        if (results.length === 0) {
          stdout("No commands found.\n");
          return;
        }

        stdout(`Available commands for profile ${profile.name}:\n\n`);

        const maxNameLength = results.reduce((max, r) => (r.name.length > max ? r.name.length : max), 0);
        const padding = maxNameLength + 2;

        results.forEach((r) => {
          const description = r.description ?? "";
          const namePadded = r.name.padEnd(padding, " ");
          stdout(`  ${namePadded}${description}\n`);
        });
      }
    )
    .command(
      "search",
      "Deprecated: use 'commands --query/--regex' instead",
      (y) =>
        y
          .version(false)
          .option("query", {
            alias: "q",
            type: "string",
            description: "Natural language search query (deprecated, use commands --query instead)",
          })
          .option("regex", {
            alias: "r",
            type: "string",
            description: "Regex pattern to match command name, path, or description (deprecated, use commands --regex instead)",
          })
          .option("limit", {
            alias: "n",
            type: "number",
            default: 10,
            description: "Maximum number of results",
          })
          .check((args) => {
            if (!args.query && !args.regex) {
              throw new Error("Provide --query or --regex");
            }
            return true;
          }),
      async (args) => {
        stdout("Warning: 'search' is deprecated, use 'commands --query/--regex' instead.\n\n");

        const limit = (args.limit as number) ?? 10;
        const forwardedArgs: string[] = [];
        if (args.query) {
          forwardedArgs.push("--query", String(args.query));
        }
        if (args.regex) {
          forwardedArgs.push("--regex", String(args.regex));
        }
        forwardedArgs.push("--limit", String(limit));

        await run(["commands", ...forwardedArgs], {
          cwd,
          configLocator,
          profileStore,
          openapiLoader,
          stdout,
          httpClient,
        });
      }
    )
    .demandCommand(1, "")
    .help("help")
    .alias("h", "help")
    .parseAsync();
}

function main(): void {
  run(process.argv.slice(2)).catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}

if (require.main === module) {
  main();
}
