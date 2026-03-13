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

    stdout("Опции:\n\n");

    const entries: Array<{
      key: string;
      desc: string;
      typeLabel: string;
      requiredLabel: string;
    }> = [];

    command.options.forEach((opt: CliCommandOption) => {
      const key = `--${opt.name}`;
      const requiredLabel = opt.required ? "необходимо" : "";
      const baseType = opt.schemaType;
      let typeLabel = "строковой тип";
      if (baseType === "integer" || baseType === "number") {
        typeLabel = "число";
      } else if (baseType === "boolean") {
        typeLabel = "булевый тип";
      }
      const descriptionPart = opt.description ?? "";
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
      desc: "Показать помощь",
      typeLabel: "булевый тип",
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
  const headers = buildAuthHeaders(profile);

  const knownOptionNames = new Set(command.options.map((o) => o.name));
  const body: Record<string, string> = {};

  Object.keys(flags).forEach((key) => {
    if (!knownOptionNames.has(key)) {
      body[key] = flags[key];
    }
  });

  const method = command.method.toUpperCase();
  const hasBody = Object.keys(body).length > 0 && (method === "POST" || method === "PUT" || method === "PATCH");

  const requestConfig: AxiosRequestConfig = {
    method,
    url,
    headers: {
      ...headers,
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
    },
    ...(hasBody ? { data: body } : {}),
  };

  const response = await httpClient.request(requestConfig);
  stdout(`${JSON.stringify(response.data, null, 2)}\n`);
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
        pathValue = pathValue.replace(token, encodeURIComponent(value));
      }
    });

  const baseUrl = profile.apiBaseUrl.replace(/\/+$/, "");
  let url = `${baseUrl}${pathValue}`;

  const queryParams = new URLSearchParams();
  command.options
    .filter((opt) => opt.location === "query")
    .forEach((opt) => {
      const value = flags[opt.name];
      if (value !== undefined) {
        queryParams.set(opt.name, value);
      }
    });

  const queryString = queryParams.toString();
  if (queryString) {
    url += url.includes("?") ? `&${queryString}` : `?${queryString}`;
  }

  return url;
}

function buildAuthHeaders(profile: Profile): Record<string, string> {
  const headers: Record<string, string> = {};

  if (profile.apiBasicAuth) {
    const encoded = Buffer.from(profile.apiBasicAuth).toString("base64");
    headers.Authorization = `Basic ${encoded}`;
  } else if (profile.apiBearerToken) {
    headers.Authorization = `Bearer ${profile.apiBearerToken}`;
  }

  return headers;
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

    const profile: Profile = {
      name: profileName,
      apiBaseUrl: args["api-base-url"],
      apiBasicAuth: args["api-basic-auth"] ?? "",
      apiBearerToken: args["api-bearer-token"] ?? "",
      openapiSpecSource: args["openapi-spec"],
      openapiSpecCache: cachePath,
      includeEndpoints,
      excludeEndpoints,
    };

    await openapiLoader.loadSpec(profile, { refresh: true });
    profileStore.saveProfile(cwd, profile, { makeCurrent: true });
  };

  const addProfileOptions = (y: ReturnType<typeof yargs>) =>
    y
      .option("api-base-url", { type: "string", demandOption: true })
      .option("openapi-spec", { type: "string", demandOption: true })
      .option("api-basic-auth", { type: "string", default: "" })
      .option("api-bearer-token", { type: "string", default: "" })
      .option("include-endpoints", { type: "string", default: "" })
      .option("exclude-endpoints", { type: "string", default: "" });

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
      "List available commands for the current profile",
      (y) => y.version(false),
      async () => {
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

        stdout(`Available commands for profile ${profile.name}:\n\n`);

        const maxNameLength = commands.reduce((max, cmd) => (cmd.name.length > max ? cmd.name.length : max), 0);
        const padding = maxNameLength + 2;

        commands.forEach((cmd) => {
          const description = cmd.description ?? "";
          const namePadded = cmd.name.padEnd(padding, " ");
          stdout(`  ${namePadded}${description}\n`);
        });
      }
    )
    .command(
      "search",
      "Search commands by query (BM25) or regex pattern",
      (y) =>
        y
          .version(false)
          .option("query", {
            alias: "q",
            type: "string",
            description: "Natural language search query",
          })
          .option("regex", {
            alias: "r",
            type: "string",
            description: "Regex pattern to match command name, path, or description",
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
        const profile = profileStore.getCurrentProfile(cwd);
        if (!profile) {
          throw new Error("No current profile configured");
        }

        const spec = await openapiLoader.loadSpec(profile);
        const commands = openapiToCommands.buildCommands(spec, profile);

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

        const maxName = results.reduce((m, r) => (r.name.length > m ? r.name.length : m), 0);
        const maxMethod = results.reduce((m, r) => (r.method.length > m ? r.method.length : m), 0);

        stdout(`Found ${results.length} command(s):\n\n`);
        for (const r of results) {
          const name = r.name.padEnd(maxName + 2);
          const method = r.method.padEnd(maxMethod + 1);
          const desc = r.description ?? "";
          const scorePart = r.score < 1 ? ` [score: ${r.score}]` : "";
          stdout(`  ${name}${method} ${r.path}  ${desc}${scorePart}\n`);
        }
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
