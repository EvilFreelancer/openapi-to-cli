const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function readGitTagVersion(projectRoot) {
  try {
    const tag = execSync("git describe --tags --abbrev=0", {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
    })
      .trim();

    if (!tag) {
      return null;
    }

    return tag;
  } catch {
    return null;
  }
}

function readPackageJsonVersion(projectRoot) {
  const pkgPath = path.join(projectRoot, "package.json");
  const pkgRaw = fs.readFileSync(pkgPath, { encoding: "utf-8" });
  const pkg = JSON.parse(pkgRaw);
  if (typeof pkg.version === "string" && pkg.version.length > 0) {
    return pkg.version;
  }
  return null;
}

function main() {
  const projectRoot = path.resolve(__dirname, "..");

  const gitVersion = readGitTagVersion(projectRoot);
  const fallbackVersion = readPackageJsonVersion(projectRoot) ?? "0.0.0-dev";
  const version = gitVersion ?? fallbackVersion;

  const targetPath = path.join(projectRoot, "src", "version.ts");
  const content = `export const VERSION = "${version}";\n`;

  fs.writeFileSync(targetPath, content, { encoding: "utf-8" });
}

main();
