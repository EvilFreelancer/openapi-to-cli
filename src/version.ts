// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require("../package.json") as { version: string };

export const VERSION = process.env.OCLI_VERSION ?? `v${pkg.version}`;
