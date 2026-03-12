import { ConfigLocator, ConfigLocatorOptions, ConfigPaths } from "../src/config";

interface TestFs {
  existsSync: (path: string) => boolean;
}

function createLocator(fsMap: Record<string, boolean>, homeDir: string, cwd: string): { locator: ConfigLocator; cwd: string } {
  const testFs: TestFs = {
    existsSync: (path) => Boolean(fsMap[path]),
  };

  const options: ConfigLocatorOptions = {
    fs: testFs,
    homeDir,
  };

  const locator = new ConfigLocator(options);

  return { locator, cwd };
}

describe("ConfigLocator", () => {
  const homeDir = "/home/user";

  it("prefers local .oclirc when profiles.ini exists locally", () => {
    const cwd = "/project";
    const localConfigDir = `${cwd}/.oclirc`;
    const globalConfigDir = `${homeDir}/.oclirc`;

    const fsMap: Record<string, boolean> = {
      [`${localConfigDir}/profiles.ini`]: true,
      [`${globalConfigDir}/profiles.ini`]: true,
    };

    const { locator } = createLocator(fsMap, homeDir, cwd);

    const paths: ConfigPaths = locator.resolveConfig(cwd);

    expect(paths.configDir).toBe(localConfigDir);
    expect(paths.profilesIniPath).toBe(`${localConfigDir}/profiles.ini`);
    expect(paths.specsDir).toBe(`${localConfigDir}/specs`);
  });

  it("falls back to global .oclirc when local profiles.ini is missing", () => {
    const cwd = "/project";
    const localConfigDir = `${cwd}/.oclirc`;
    const globalConfigDir = `${homeDir}/.oclirc`;

    const fsMap: Record<string, boolean> = {
      [`${globalConfigDir}/profiles.ini`]: true,
    };

    const { locator } = createLocator(fsMap, homeDir, cwd);

    const paths: ConfigPaths = locator.resolveConfig(cwd);

    expect(paths.configDir).toBe(globalConfigDir);
    expect(paths.profilesIniPath).toBe(`${globalConfigDir}/profiles.ini`);
    expect(paths.specsDir).toBe(`${globalConfigDir}/specs`);
  });

  it("returns configDir and specsDir even when no profiles.ini exists", () => {
    const cwd = "/project";
    const localConfigDir = `${cwd}/.oclirc`;
    const globalConfigDir = `${homeDir}/.oclirc`;

    const fsMap: Record<string, boolean> = {};

    const { locator } = createLocator(fsMap, homeDir, cwd);

    const paths: ConfigPaths = locator.resolveConfig(cwd);

    expect(paths.configDir).toBe(localConfigDir);
    expect(paths.profilesIniPath).toBe(`${localConfigDir}/profiles.ini`);
    expect(paths.specsDir).toBe(`${localConfigDir}/specs`);
  });
});
