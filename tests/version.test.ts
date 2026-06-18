describe("VERSION", () => {
  const originalEnv = process.env.OCLI_VERSION;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.OCLI_VERSION;
    } else {
      process.env.OCLI_VERSION = originalEnv;
    }
    jest.resetModules();
  });

  it("falls back to v<package.json version> when OCLI_VERSION is not set", () => {
    delete process.env.OCLI_VERSION;
    jest.resetModules();

    const { VERSION } = require("../src/version") as { VERSION: string };
    const pkg = require("../package.json") as { version: string };

    expect(VERSION).toBe(`v${pkg.version}`);
  });

  it("uses OCLI_VERSION env var when set", () => {
    process.env.OCLI_VERSION = "v9.9.9-test";
    jest.resetModules();

    const { VERSION } = require("../src/version") as { VERSION: string };

    expect(VERSION).toBe("v9.9.9-test");
  });
});
