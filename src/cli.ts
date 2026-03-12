#!/usr/bin/env node

import path from "path";
import yargs from "yargs";

import { ConfigLocator } from "./config";
import { ProfileStore, Profile } from "./profile-store";
import { OpenapiLoader } from "./openapi-loader";

export interface RunOptions {
  cwd?: string;
  configLocator?: ConfigLocator;
  profileStore?: ProfileStore;
  openapiLoader?: OpenapiLoader;
  stdout?: (msg: string) => void;
}

const defaultStdout = (msg: string): void => {
  process.stdout.write(msg);
};

interface AddProfileArgs {
  "api-base-url": string;
  "openapi-spec": string;
  "api-basic-auth"?: string;
  "api-bearer-token"?: string;
  "include-endpoints"?: string;
  "exclude-endpoints"?: string;
}

export async function run(argv: string[], options?: RunOptions): Promise<void> {
  const cwd = options?.cwd ?? process.cwd();
  const configLocator = options?.configLocator ?? new ConfigLocator();
  const profileStore = options?.profileStore ?? new ProfileStore({ locator: configLocator });
  const openapiLoader = options?.openapiLoader ?? new OpenapiLoader();
  const stdout = options?.stdout ?? defaultStdout;

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

  await yargs(argv)
    .scriptName("ocli")
    .command(
      "onboard",
      "Add a new profile (alias for profiles add default)",
      (y) => addProfileOptions(y),
      async (args) => {
        await runAddProfile("default", args as AddProfileArgs);
      }
    )
    .command(
      "profiles",
      "Profile management",
      (y) =>
        y
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
      (y) => y.positional("profile", { type: "string", demandOption: true }),
      (args) => {
        profileStore.setCurrentProfile(cwd, args.profile as string);
      }
    )
    .parseAsync();
}

function main(): void {
  run(process.argv.slice(2)).catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}

main();
