# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- OpenClaw skill (`skills/ocli-api/SKILL.md`) published to [ClawHub](https://clawhub.ai/skills/ocli-api)
- Fair 4-strategy token benchmark: MCP Naive, MCP+Search Full, MCP+Search Compact, CLI
- mcp2cli added to comparison table with MCP/GraphQL/TOON/OAuth features
- CHANGELOG.md

### Changed
- README rewritten: "CLI vs MCP" positioning replaced with 4-layer model (Built-in Tools, MCP, Skills, CLI)
- README reduced from 285 to 175 lines — removed implementation details available via `--help`
- Benchmark now uses same BM25 engine for all strategies (fair comparison)

### Fixed
- Nested JSON values for body flags now parsed correctly (#5, thanks @veged)

## [0.1.3] - 2026-03-12

### Added
- BM25 command search (`ocli commands --query "..."`)
- Regex command search (`ocli commands --regex "..."`)
- YAML spec support (Box API 258 endpoints tested)
- GitHub API test fixture (845 endpoints)
- Box API test fixture (258 endpoints)
- `ocli commands` replaces deprecated `ocli search`
- CLI-Anything added to comparison table
- MIT license file

## [0.1.2] - 2026-03-12

### Added
- Command generation from OpenAPI paths and methods

## [0.1.1] - 2026-03-12

### Fixed
- Version tag generation

## [0.1.0] - 2026-03-12

### Added
- Initial release
- OpenAPI/Swagger spec loading (URL and local file)
- Spec caching in `.ocli/specs/`
- Profile management (`profiles add/list/show/remove`, `use`)
- Command generation from OpenAPI paths with method suffix logic
- Path and query parameter extraction
- HTTP request execution (GET, POST, PUT, DELETE, PATCH)
- Basic and Bearer token authentication
- GitHub Actions CI/CD workflows

[Unreleased]: https://github.com/EvilFreelancer/openapi-to-cli/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/EvilFreelancer/openapi-to-cli/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/EvilFreelancer/openapi-to-cli/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/EvilFreelancer/openapi-to-cli/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/EvilFreelancer/openapi-to-cli/releases/tag/v0.1.0
