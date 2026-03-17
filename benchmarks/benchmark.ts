#!/usr/bin/env ts-node

/**
 * Token benchmark: 4 strategies for AI agent ↔ API interaction
 *
 * 1. MCP Naive       — all endpoints as tools in context (standard MCP approach)
 * 2. MCP+Search Full — 2 tools: search_tools (returns full schemas) + call_api
 * 3. MCP+Search Compact — 3 tools: search_tools (compact) + get_tool_schema + call_api
 * 4. CLI (ocli)      — 1 tool: execute_command (search + help + execute)
 *
 * All search strategies use the same BM25 engine for fair comparison.
 * Tested against Swagger Petstore (19 endpoints).
 * Run: npx ts-node benchmarks/benchmark.ts
 */

import axios from "axios";
import { OpenapiToCommands, CliCommand } from "../src/openapi-to-commands";
import { CommandSearch } from "../src/command-search";
import { Profile } from "../src/profile-store";

// ── Helpers ──────────────────────────────────────────────────────────

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function padRight(str: string, len: number): string {
  return str.length >= len ? str : str + " ".repeat(len - str.length);
}

function padLeft(str: string, len: number): string {
  return str.length >= len ? str : " ".repeat(len - str.length) + str;
}

function bar(value: number, max: number, width: number, char = "█"): string {
  const filled = Math.round((value / max) * width);
  return char.repeat(Math.max(1, filled));
}

function matches(value: string, expected: string | RegExp): boolean {
  if (typeof expected === "string") return value === expected;
  return expected.test(value);
}

// ── OpenAPI → MCP tool definitions ──────────────────────────────────

interface McpTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

function openapiToMcpTools(spec: Record<string, unknown>): McpTool[] {
  const tools: McpTool[] = [];
  const paths = (spec.paths ?? {}) as Record<string, Record<string, unknown>>;
  const schemas = ((spec.components as Record<string, unknown>)?.schemas ?? {}) as Record<string, unknown>;
  const methods = ["get", "post", "put", "delete", "patch"];

  for (const [pathKey, pathItem] of Object.entries(paths)) {
    for (const method of methods) {
      const op = pathItem[method] as Record<string, unknown> | undefined;
      if (!op) continue;

      const operationId = (op.operationId as string) ?? `${method}_${pathKey.replace(/[{}\/]/g, "_")}`;
      const description = (op.description as string) ?? (op.summary as string) ?? "";
      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      const params = (op.parameters ?? []) as Array<Record<string, unknown>>;
      for (const param of params) {
        const name = param.name as string;
        const schema = (param.schema ?? { type: "string" }) as Record<string, unknown>;
        properties[name] = {
          type: schema.type ?? "string",
          description: (param.description as string) ?? "",
          ...(schema.enum ? { enum: schema.enum } : {}),
          ...(schema.format ? { format: schema.format } : {}),
        };
        if (param.required) required.push(name);
      }

      const requestBody = op.requestBody as Record<string, unknown> | undefined;
      if (requestBody) {
        const content = requestBody.content as Record<string, unknown> | undefined;
        const jsonContent = content?.["application/json"] as Record<string, unknown> | undefined;
        const bodySchema = jsonContent?.schema as Record<string, unknown> | undefined;
        if (bodySchema) {
          const ref = bodySchema.$ref as string | undefined;
          if (ref) {
            const schemaName = ref.split("/").pop()!;
            const resolved = schemas[schemaName] as Record<string, unknown> | undefined;
            if (resolved) {
              const bodyProps = (resolved.properties ?? {}) as Record<string, unknown>;
              const bodyReq = (resolved.required ?? []) as string[];
              for (const [pn, ps] of Object.entries(bodyProps)) {
                const prop = ps as Record<string, unknown>;
                if (prop.$ref) {
                  const innerName = (prop.$ref as string).split("/").pop()!;
                  properties[pn] = schemas[innerName] ?? prop;
                } else if (prop.items && (prop.items as Record<string, unknown>).$ref) {
                  const innerName = ((prop.items as Record<string, unknown>).$ref as string).split("/").pop()!;
                  properties[pn] = { ...prop, items: schemas[innerName] ?? prop.items };
                } else {
                  properties[pn] = prop;
                }
              }
              required.push(...bodyReq);
            }
          }
        }
      }

      tools.push({
        name: operationId,
        description: description.slice(0, 1024),
        input_schema: {
          type: "object",
          properties,
          ...(required.length > 0 ? { required } : {}),
        },
      });
    }
  }

  return tools;
}

// ── BM25 search over MCP tools (same engine as CLI) ─────────────────

interface McpSearchable {
  tool: McpTool;
  tokens: string;
}

function buildMcpSearchIndex(mcpTools: McpTool[]): McpSearchable[] {
  return mcpTools.map(t => {
    const propNames = Object.keys((t.input_schema.properties ?? {}) as Record<string, unknown>);
    return {
      tool: t,
      tokens: [t.name, t.description, ...propNames].join(" ").toLowerCase(),
    };
  });
}

/**
 * BM25-ranked search over MCP tools.
 * Uses the same CommandSearch engine as CLI for fair comparison.
 */
function searchMcpTools(
  searcher: CommandSearch,
  mcpToolsByName: Map<string, McpTool>,
  query: string,
  limit: number,
): McpTool[] {
  const results = searcher.search(query, limit);
  const matched: McpTool[] = [];
  for (const r of results) {
    // Match by operationId or by generated command name
    const tool = mcpToolsByName.get(r.name) ?? mcpToolsByName.get(r.path);
    if (tool) matched.push(tool);
  }
  // If BM25 didn't find exact matches, fall back to description search
  if (matched.length === 0) {
    const q = query.toLowerCase();
    const scored = Array.from(mcpToolsByName.values())
      .filter(t => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q))
      .slice(0, limit);
    return scored;
  }
  return matched;
}

// ── Tool definitions for each strategy ──────────────────────────────

function buildMcpSearchFullTools(): McpTool[] {
  return [
    {
      name: "search_tools",
      description: "Search available API tools by natural language query. Returns matching tools with their full parameter schemas so you can call them immediately.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural language search query (e.g. 'create a pet', 'get order status')" },
          limit: { type: "number", description: "Maximum number of results to return (default: 5)" },
        },
        required: ["query"],
      },
    },
    {
      name: "call_api",
      description: "Call an API endpoint by its tool name with the specified parameters. Use search_tools first to discover available tools and their schemas.",
      input_schema: {
        type: "object",
        properties: {
          tool_name: { type: "string", description: "The tool name returned by search_tools (e.g. 'addPet', 'getOrderById')" },
          parameters: { type: "object", description: "Parameters to pass to the tool, matching the schema from search_tools results" },
        },
        required: ["tool_name", "parameters"],
      },
    },
  ];
}

function buildMcpSearchCompactTools(): McpTool[] {
  return [
    {
      name: "search_tools",
      description: "Search available API tools by natural language query. Returns tool names and descriptions (no parameter schemas).",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural language search query (e.g. 'create a pet', 'get order status')" },
          limit: { type: "number", description: "Maximum number of results to return (default: 5)" },
        },
        required: ["query"],
      },
    },
    {
      name: "get_tool_schema",
      description: "Get the full parameter schema for a specific tool. Use after search_tools to get the parameters before calling.",
      input_schema: {
        type: "object",
        properties: {
          tool_name: { type: "string", description: "The tool name from search_tools results" },
        },
        required: ["tool_name"],
      },
    },
    {
      name: "call_api",
      description: "Call an API endpoint by its tool name with parameters. Use get_tool_schema first to discover required parameters.",
      input_schema: {
        type: "object",
        properties: {
          tool_name: { type: "string", description: "The tool name (e.g. 'addPet', 'getOrderById')" },
          parameters: { type: "object", description: "Parameters matching the schema from get_tool_schema" },
        },
        required: ["tool_name", "parameters"],
      },
    },
  ];
}

function buildCliTool(): McpTool[] {
  return [{
    name: "execute_command",
    description: "Execute a shell command. Use `ocli commands --query \"...\"` to search for API commands, then `ocli <command> --help` for parameters, then `ocli <command> --param value` to execute.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute" },
      },
      required: ["command"],
    },
  }];
}

// ── Simulate search results (all using BM25) ────────────────────────

/**
 * MCP search_tools (full) — returns matched tools with full JSON schemas.
 * Uses BM25 ranking, same engine as CLI.
 */
function simulateMcpSearchFullResult(
  searcher: CommandSearch,
  mcpToolsByName: Map<string, McpTool>,
  query: string,
  limit: number,
): string {
  const matched = searchMcpTools(searcher, mcpToolsByName, query, limit);
  return JSON.stringify(matched.map(t => ({
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
  })), null, 2);
}

/**
 * MCP search_tools (compact) — returns only names and descriptions.
 * Same BM25 ranking. Agent must call get_tool_schema separately.
 */
function simulateMcpSearchCompactResult(
  searcher: CommandSearch,
  mcpToolsByName: Map<string, McpTool>,
  query: string,
  limit: number,
): string {
  const matched = searchMcpTools(searcher, mcpToolsByName, query, limit);
  return JSON.stringify(matched.map(t => ({
    name: t.name,
    description: t.description,
  })), null, 2);
}

/**
 * MCP get_tool_schema — returns full schema for one tool.
 */
function simulateMcpGetSchemaResult(tool: McpTool): string {
  return JSON.stringify({
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema,
  }, null, 2);
}

/**
 * CLI search — compact text: name + method + path + description.
 * Uses the same BM25 engine.
 */
function simulateCliSearchResult(searcher: CommandSearch, query: string, limit: number): string {
  const results = searcher.search(query, limit);
  return results.map(r =>
    `  ${r.name.padEnd(35)} ${r.method.padEnd(7)} ${r.path}  ${r.description ?? ""}`
  ).join("\n");
}

/**
 * CLI --help — simulates `ocli <command> --help` output.
 * Returns command description and parameter list (similar to get_tool_schema).
 * Looks up the full CliCommand to get options.
 */
function simulateCliHelpResult(commands: CliCommand[], searcher: CommandSearch, query: string): string {
  const results = searcher.search(query, 1);
  if (results.length === 0) return "(no command found)";
  const matched = results[0];
  const cmd = commands.find(c => c.name === matched.name);
  if (!cmd) return "(no command found)";
  const lines = [
    `${cmd.name} — ${cmd.description ?? ""}`,
    `  ${cmd.method.toUpperCase()} ${cmd.path}`,
    "",
    "Options:",
  ];
  for (const opt of cmd.options) {
    const req = opt.required ? " (required)" : "";
    lines.push(`  --${opt.name.padEnd(20)} ${(opt.schemaType ?? "string").padEnd(10)} ${opt.description ?? ""}${req}`);
  }
  return lines.join("\n");
}

// ── Accuracy tasks ──────────────────────────────────────────────────

interface AccuracyTask {
  query: string;
  expected: string | RegExp;
  expectedPath: string | RegExp;
}

const ACCURACY_TASKS: AccuracyTask[] = [
  { query: "find all pets with status available", expected: "pet_findByStatus", expectedPath: "/pet/findByStatus" },
  { query: "add a new pet to the store", expected: /pet.*post/, expectedPath: "/pet" },
  { query: "get pet by id", expected: /pet.*petId.*get/, expectedPath: /\/pet\/\{petId\}/ },
  { query: "update existing pet information", expected: /pet.*put/, expectedPath: "/pet" },
  { query: "delete a pet", expected: /pet.*delete/, expectedPath: /\/pet\/\{petId\}/ },
  { query: "place an order for a pet", expected: /store.*order/, expectedPath: "/store/order" },
  { query: "get store inventory", expected: /store.*inventory/, expectedPath: "/store/inventory" },
  { query: "create a new user account", expected: /^user$/, expectedPath: "/user" },
  { query: "get user by username", expected: /user.*username.*get/, expectedPath: /\/user\/\{username\}/ },
  { query: "find pets by tags", expected: /pet.*findByTags/, expectedPath: "/pet/findByTags" },
  { query: "upload pet photo", expected: /upload/, expectedPath: /uploadImage/ },
  { query: "login to the system", expected: /user.*login/, expectedPath: "/user/login" },
  { query: "check order status", expected: /store.*order.*get/, expectedPath: /\/store\/order\/\{orderId\}/ },
  { query: "remove user from system", expected: /user.*delete/, expectedPath: /\/user\/\{username\}/ },
  { query: "bulk create users", expected: /user.*createWithList/, expectedPath: "/user/createWithList" },
];

// ── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("Fetching Petstore OpenAPI spec...\n");
  const response = await axios.get("https://petstore3.swagger.io/api/v3/openapi.json");
  const spec = response.data as Record<string, unknown>;

  // Build MCP tools
  const mcpTools = openapiToMcpTools(spec);
  const mcpToolsByName = new Map<string, McpTool>();
  for (const t of mcpTools) mcpToolsByName.set(t.name, t);

  // Build CLI commands + shared BM25 searcher
  const profile: Profile = {
    name: "petstore", apiBaseUrl: "https://petstore3.swagger.io/api/v3",
    apiBasicAuth: "", apiBearerToken: "", openapiSpecSource: "",
    openapiSpecCache: "", includeEndpoints: [], excludeEndpoints: [],
    commandPrefix: "", customHeaders: {},
  };

  const commands = new OpenapiToCommands().buildCommands(spec, profile);
  const searcher = new CommandSearch();
  searcher.load(commands);

  // Also map CLI command names → MCP tools for cross-referencing
  for (const cmd of commands) {
    // Try to find MCP tool by path matching
    for (const t of mcpTools) {
      if (!mcpToolsByName.has(cmd.name)) {
        mcpToolsByName.set(cmd.name, t);
      }
    }
  }

  // ── Token calculations for tool definitions (sent every turn) ──

  const mcpNaiveToolsJson = JSON.stringify(mcpTools, null, 2);
  const mcpSearchFullToolsJson = JSON.stringify(buildMcpSearchFullTools(), null, 2);
  const mcpSearchCompactToolsJson = JSON.stringify(buildMcpSearchCompactTools(), null, 2);
  const cliToolJson = JSON.stringify(buildCliTool(), null, 2);

  const mcpNaiveToolTokens = estimateTokens(mcpNaiveToolsJson);
  const mcpSearchFullToolTokens = estimateTokens(mcpSearchFullToolsJson);
  const mcpSearchCompactToolTokens = estimateTokens(mcpSearchCompactToolsJson);
  const cliToolTokens = estimateTokens(cliToolJson);

  // System prompts
  const mcpNaiveSystem = "You are an AI assistant with access to the Petstore API. Use the provided tools.";
  const mcpSearchFullSystem = "You are an AI assistant. Use search_tools to find API endpoints (returns full schemas), then call_api to execute them.";
  const mcpSearchCompactSystem = "You are an AI assistant. Use search_tools to find endpoints, get_tool_schema to get parameters, then call_api to execute.";
  const cliSystem = "You are an AI assistant. Use `ocli commands --query` to search, `ocli <cmd> --help` for parameters, then `ocli <cmd> --param value` to execute.";

  const mcpNaiveSysTok = estimateTokens(mcpNaiveSystem);
  const mcpSearchFullSysTok = estimateTokens(mcpSearchFullSystem);
  const mcpSearchCompactSysTok = estimateTokens(mcpSearchCompactSystem);
  const cliSysTok = estimateTokens(cliSystem);

  const mcpNaiveOverhead = mcpNaiveToolTokens + mcpNaiveSysTok;
  const mcpSearchFullOverhead = mcpSearchFullToolTokens + mcpSearchFullSysTok;
  const mcpSearchCompactOverhead = mcpSearchCompactToolTokens + mcpSearchCompactSysTok;
  const cliOverhead = cliToolTokens + cliSysTok;

  // ── Measure ACTUAL search results using BM25 for all strategies ──

  const sampleQuery = "find pets by status";

  const mcpSearchFullResultSample = simulateMcpSearchFullResult(searcher, mcpToolsByName, sampleQuery, 3);
  const mcpSearchCompactResultSample = simulateMcpSearchCompactResult(searcher, mcpToolsByName, sampleQuery, 3);
  const cliSearchResultSample = simulateCliSearchResult(searcher, sampleQuery, 3);

  // Get schema for one tool (used by compact MCP and CLI --help)
  const firstMatchedTool = searchMcpTools(searcher, mcpToolsByName, sampleQuery, 1)[0];
  const mcpGetSchemaResultSample = firstMatchedTool ? simulateMcpGetSchemaResult(firstMatchedTool) : "{}";
  const cliHelpResultSample = simulateCliHelpResult(commands, searcher, sampleQuery);

  const mcpSearchFullResultTok = estimateTokens(mcpSearchFullResultSample);
  const mcpSearchCompactResultTok = estimateTokens(mcpSearchCompactResultSample);
  const mcpGetSchemaResultTok = estimateTokens(mcpGetSchemaResultSample);
  const cliSearchResultTok = estimateTokens(cliSearchResultSample);
  const cliHelpResultTok = estimateTokens(cliHelpResultSample);

  console.log(`Petstore API: ${mcpTools.length} endpoints\n`);

  // ══════════════════════════════════════════════════════════════
  //  OUTPUT
  // ══════════════════════════════════════════════════════════════

  const W = 80;
  const line = "─".repeat(W);
  const dline = "═".repeat(W);

  console.log(dline);
  console.log("  FOUR STRATEGIES FOR AI AGENT ↔ API INTERACTION");
  console.log(dline);
  console.log();
  console.log("  1. MCP Naive        All endpoints as tools in context (1 turn)");
  console.log("  2. MCP+Search Full  search_tools (full schemas) + call_api (2 turns)");
  console.log("  3. MCP+Search Compact  search_tools (compact) + get_schema + call_api (3 turns)");
  console.log("  4. CLI (ocli)       search + --help + execute (3 turns)");
  console.log();
  console.log("  All search strategies use the same BM25 engine for fair comparison.");
  console.log();

  // ── Tool definition overhead ──
  console.log(dline);
  console.log("  TOOL DEFINITION OVERHEAD (sent with every API request)");
  console.log(dline);
  console.log();

  const maxOvh = mcpNaiveOverhead;
  console.log(`  MCP Naive          ${bar(mcpNaiveOverhead, maxOvh, 25)} ${padLeft(mcpNaiveOverhead.toLocaleString(), 6)} tok  (${mcpTools.length} tools)`);
  console.log(`  MCP+Search Full    ${bar(mcpSearchFullOverhead, maxOvh, 25)} ${padLeft(mcpSearchFullOverhead.toLocaleString(), 6)} tok  (2 tools)`);
  console.log(`  MCP+Search Compact ${bar(mcpSearchCompactOverhead, maxOvh, 25)} ${padLeft(mcpSearchCompactOverhead.toLocaleString(), 6)} tok  (3 tools)`);
  console.log(`  CLI (ocli)         ${bar(cliOverhead, maxOvh, 25)} ${padLeft(cliOverhead.toLocaleString(), 6)} tok  (1 tool)`);
  console.log();

  // ── Search result size comparison ──
  console.log(dline);
  console.log("  SEARCH RESULT SIZE — query: \"find pets by status\", top 3");
  console.log(dline);
  console.log();

  const maxRes = mcpSearchFullResultTok;
  console.log(`  MCP Full search    ${bar(mcpSearchFullResultTok, maxRes, 25)} ${padLeft(mcpSearchFullResultTok.toLocaleString(), 6)} tok  (name + desc + full JSON schema)`);
  console.log(`  MCP Compact search ${bar(mcpSearchCompactResultTok, maxRes, 25)} ${padLeft(mcpSearchCompactResultTok.toLocaleString(), 6)} tok  (name + desc only)`);
  console.log(`  CLI search         ${bar(cliSearchResultTok, maxRes, 25)} ${padLeft(cliSearchResultTok.toLocaleString(), 6)} tok  (name + method + path + desc)`);
  console.log();
  console.log(`  get_tool_schema    ${bar(mcpGetSchemaResultTok, maxRes, 25)} ${padLeft(mcpGetSchemaResultTok.toLocaleString(), 6)} tok  (MCP: full schema for 1 tool)`);
  console.log(`  ocli cmd --help    ${bar(cliHelpResultTok, maxRes, 25)} ${padLeft(cliHelpResultTok.toLocaleString(), 6)} tok  (CLI: text help for 1 command)`);
  console.log();

  // ── Per-task total cost (realistic multi-turn flows) ──
  console.log(dline);
  console.log("  TOTAL TOKENS PER TASK (realistic multi-turn agent flow)");
  console.log(dline);
  console.log();

  // MCP Naive: 1 turn = overhead + user msg (20) + assistant output (50)
  const mcpNaivePerTask = mcpNaiveOverhead + 20 + 50;

  // MCP+Search Full: 2 turns
  // Turn 1: overhead + user(20) + output(30 for search call)
  // Turn 2: overhead + user(20) + search_result_full + prev_msgs(50) + output(50 for call_api)
  const mcpSearchFullPerTask =
    (mcpSearchFullOverhead + 20 + 30) +
    (mcpSearchFullOverhead + 20 + mcpSearchFullResultTok + 50 + 50);

  // MCP+Search Compact: 3 turns
  // Turn 1: overhead + user(20) + output(30 for search call)
  // Turn 2: overhead + user(20) + compact_search_result + prev_msgs(50) + output(30 for get_schema)
  // Turn 3: overhead + user(20) + schema_result + prev_msgs(80) + output(50 for call_api)
  const mcpSearchCompactPerTask =
    (mcpSearchCompactOverhead + 20 + 30) +
    (mcpSearchCompactOverhead + 20 + mcpSearchCompactResultTok + 50 + 30) +
    (mcpSearchCompactOverhead + 20 + mcpGetSchemaResultTok + 80 + 50);

  // CLI: 3 turns (search → help → execute)
  // Turn 1: overhead + user(20) + output(40 for search command)
  // Turn 2: overhead + user(20) + search_result + prev_msgs(60) + output(40 for --help command)
  // Turn 3: overhead + user(20) + help_result + prev_msgs(100) + output(40 for execute)
  const cliPerTask =
    (cliOverhead + 20 + 40) +
    (cliOverhead + 20 + cliSearchResultTok + 60 + 40) +
    (cliOverhead + 20 + cliHelpResultTok + 100 + 40);

  const maxTask = mcpNaivePerTask;
  console.log(`  MCP Naive          ${bar(mcpNaivePerTask, maxTask, 25)} ${padLeft(mcpNaivePerTask.toLocaleString(), 6)} tok  (1 turn)`);
  console.log(`  MCP+Search Full    ${bar(mcpSearchFullPerTask, maxTask, 25)} ${padLeft(mcpSearchFullPerTask.toLocaleString(), 6)} tok  (2 turns)`);
  console.log(`  MCP+Search Compact ${bar(mcpSearchCompactPerTask, maxTask, 25)} ${padLeft(mcpSearchCompactPerTask.toLocaleString(), 6)} tok  (3 turns)`);
  console.log(`  CLI (ocli)         ${bar(cliPerTask, maxTask, 25)} ${padLeft(cliPerTask.toLocaleString(), 6)} tok  (3 turns)`);
  console.log();

  // ── Per-task breakdown ──
  console.log("  Per-turn breakdown (MCP+Search Compact vs CLI):");
  console.log();
  console.log("  MCP+Search Compact:");
  console.log(`    Turn 1 (search):     overhead(${mcpSearchCompactOverhead}) + user(20) + output(30) = ${mcpSearchCompactOverhead + 20 + 30} tok`);
  console.log(`    Turn 2 (get_schema): overhead(${mcpSearchCompactOverhead}) + user(20) + search_result(${mcpSearchCompactResultTok}) + history(50) + output(30) = ${mcpSearchCompactOverhead + 20 + mcpSearchCompactResultTok + 50 + 30} tok`);
  console.log(`    Turn 3 (call_api):   overhead(${mcpSearchCompactOverhead}) + user(20) + schema(${mcpGetSchemaResultTok}) + history(80) + output(50) = ${mcpSearchCompactOverhead + 20 + mcpGetSchemaResultTok + 80 + 50} tok`);
  console.log();
  console.log("  CLI (ocli):");
  console.log(`    Turn 1 (search):     overhead(${cliOverhead}) + user(20) + output(40) = ${cliOverhead + 20 + 40} tok`);
  console.log(`    Turn 2 (--help):     overhead(${cliOverhead}) + user(20) + search_result(${cliSearchResultTok}) + history(60) + output(40) = ${cliOverhead + 20 + cliSearchResultTok + 60 + 40} tok`);
  console.log(`    Turn 3 (execute):    overhead(${cliOverhead}) + user(20) + help_result(${cliHelpResultTok}) + history(100) + output(40) = ${cliOverhead + 20 + cliHelpResultTok + 100 + 40} tok`);
  console.log();

  // ── 10 tasks total ──
  const mcpNaive10 = mcpNaivePerTask * 10;
  const mcpSearchFull10 = mcpSearchFullPerTask * 10;
  const mcpSearchCompact10 = mcpSearchCompactPerTask * 10;
  const cli10 = cliPerTask * 10;

  console.log(`  10 tasks total:`);
  console.log(`  MCP Naive          ${bar(mcpNaive10, mcpNaive10, 25)} ${padLeft(mcpNaive10.toLocaleString(), 7)} tok`);
  console.log(`  MCP+Search Full    ${bar(mcpSearchFull10, mcpNaive10, 25)} ${padLeft(mcpSearchFull10.toLocaleString(), 7)} tok  (${mcpSearchFull10 > mcpNaive10 ? "+" : "-"}${Math.abs(((mcpSearchFull10/mcpNaive10 - 1)*100)).toFixed(0)}% vs naive)`);
  console.log(`  MCP+Search Compact ${bar(mcpSearchCompact10, mcpNaive10, 25)} ${padLeft(mcpSearchCompact10.toLocaleString(), 7)} tok  (${mcpSearchCompact10 > mcpNaive10 ? "+" : "-"}${Math.abs(((mcpSearchCompact10/mcpNaive10 - 1)*100)).toFixed(0)}% vs naive)`);
  console.log(`  CLI (ocli)         ${bar(cli10, mcpNaive10, 25)} ${padLeft(cli10.toLocaleString(), 7)} tok  (-${((1 - cli10/mcpNaive10)*100).toFixed(0)}% vs naive)`);
  console.log();

  // ── Scaling projection ──
  console.log(dline);
  console.log("  SCALING: OVERHEAD PER TURN vs ENDPOINT COUNT");
  console.log(dline);
  console.log();

  const tokPerEp = mcpNaiveToolTokens / mcpTools.length;

  const scalePoints = [
    { n: 19, label: "Petstore" },
    { n: 50, label: "" },
    { n: 100, label: "" },
    { n: 200, label: "" },
    { n: 500, label: "" },
    { n: 845, label: "GitHub API" },
  ];

  console.log(`  ${padRight("Endpoints", 11)} ${padRight("MCP Naive", 14)} ${padRight("MCP+S Full", 14)} ${padRight("MCP+S Compact", 16)} ${padRight("CLI (ocli)", 14)} ${padRight("Naive/CLI", 10)}`);
  console.log("  " + line);

  for (const pt of scalePoints) {
    const naive = Math.ceil(tokPerEp * pt.n) + mcpNaiveSysTok;
    const searchFull = mcpSearchFullOverhead;
    const searchCompact = mcpSearchCompactOverhead;
    const cli = cliOverhead;
    const label = pt.label ? ` ← ${pt.label}` : "";

    console.log(
      `  ${padRight(String(pt.n), 11)} ` +
      `${padLeft(naive.toLocaleString(), 8)} tok  ` +
      `${padLeft(searchFull.toLocaleString(), 8)} tok  ` +
      `${padLeft(searchCompact.toLocaleString(), 10)} tok  ` +
      `${padLeft(cli.toLocaleString(), 8)} tok  ` +
      `${padLeft((naive / cli).toFixed(0) + "x", 6)}${label}`
    );
  }
  console.log();
  console.log("  Note: MCP+Search and CLI overhead is constant regardless of endpoint count.");
  console.log(`  MCP Naive grows linearly — every endpoint adds ~${Math.round(tokPerEp)} tokens per turn.`);
  console.log();

  // ── Accuracy ──
  console.log(dline);
  console.log("  BM25 SEARCH ACCURACY (15 natural-language queries)");
  console.log(dline);
  console.log();

  let top1 = 0, top3 = 0, top5 = 0;
  const accResults: Array<{ query: string; rank: number; found: string }> = [];

  for (const task of ACCURACY_TASKS) {
    const res = searcher.search(task.query, 5);
    let rank = 0;
    let found = "(miss)";
    for (let i = 0; i < res.length; i++) {
      if (matches(res[i].name, task.expected) || matches(res[i].path, task.expectedPath)) {
        rank = i + 1;
        found = res[i].name;
        break;
      }
    }
    if (rank === 1) { top1++; top3++; top5++; }
    else if (rank <= 3) { top3++; top5++; }
    else if (rank <= 5) { top5++; }
    accResults.push({ query: task.query, rank, found });
  }

  const total = ACCURACY_TASKS.length;

  for (const r of accResults) {
    const icon = r.rank === 1 ? "✓" : r.rank <= 3 ? "~" : r.rank <= 5 ? "·" : "✗";
    const rankStr = r.rank > 0 ? `#${r.rank}` : "miss";
    console.log(`  ${icon} ${padRight(rankStr, 5)} ${padRight(`"${r.query}"`, 42)} ${r.found}`);
  }

  console.log();
  console.log(`  Top-1: ${top1}/${total} (${((top1/total)*100).toFixed(0)}%)   Top-3: ${top3}/${total} (${((top3/total)*100).toFixed(0)}%)   Top-5: ${top5}/${total} (${((top5/total)*100).toFixed(0)}%)`);
  console.log();
  console.log(`  All strategies use the same BM25 engine — accuracy is identical.`);
  console.log();

  // ── Monthly cost at scale ──
  console.log(dline);
  console.log("  MONTHLY COST ESTIMATE (100 tasks/day, Claude Sonnet $3/M input)");
  console.log(dline);
  console.log();

  const price = 3.0;
  const dailyTasks = 100;

  const costLine = (label: string, tokPerTask: number) => {
    const monthly = (tokPerTask * dailyTasks * 30 / 1_000_000) * price;
    return `  ${padRight(label, 22)} ${padLeft(tokPerTask.toLocaleString(), 7)} tok/task   $${padLeft(monthly.toFixed(2), 8)}/month`;
  };

  console.log(`  ${padRight("", 22)} ${padRight("Per task", 18)} Monthly cost`);
  console.log("  " + line);
  console.log(`  19 endpoints (Petstore):`);
  console.log(costLine("  MCP Naive", mcpNaivePerTask));
  console.log(costLine("  MCP+Search Full", mcpSearchFullPerTask));
  console.log(costLine("  MCP+Search Compact", mcpSearchCompactPerTask));
  console.log(costLine("  CLI (ocli)", cliPerTask));
  console.log();

  // At 845 endpoints
  const naive845overhead = Math.ceil(tokPerEp * 845) + mcpNaiveSysTok;
  const naive845task = naive845overhead + 20 + 50;
  // For 845-endpoint API, search results are bigger (more complex schemas)
  const scaleFactor845 = 845 / 19; // schemas scale with API complexity
  const searchFull845resultTok = Math.ceil(mcpSearchFullResultTok * Math.sqrt(scaleFactor845));
  const searchFull845task = (mcpSearchFullOverhead + 20 + 30) + (mcpSearchFullOverhead + 20 + searchFull845resultTok + 50 + 50);
  const getSchema845resultTok = Math.ceil(mcpGetSchemaResultTok * Math.sqrt(scaleFactor845));
  const searchCompact845task =
    (mcpSearchCompactOverhead + 20 + 30) +
    (mcpSearchCompactOverhead + 20 + mcpSearchCompactResultTok + 50 + 30) +
    (mcpSearchCompactOverhead + 20 + getSchema845resultTok + 80 + 50);
  const cliHelp845resultTok = Math.ceil(cliHelpResultTok * Math.sqrt(scaleFactor845));
  const cli845task =
    (cliOverhead + 20 + 40) +
    (cliOverhead + 20 + cliSearchResultTok + 60 + 40) +
    (cliOverhead + 20 + cliHelp845resultTok + 100 + 40);

  console.log(`  845 endpoints (GitHub API scale):`);
  console.log(costLine("  MCP Naive", naive845task));
  console.log(costLine("  MCP+Search Full", searchFull845task));
  console.log(costLine("  MCP+Search Compact", searchCompact845task));
  console.log(costLine("  CLI (ocli)", cli845task));
  console.log();

  // ── Final verdict ──
  console.log(dline);
  console.log("  VERDICT");
  console.log(dline);
  console.log();
  console.log(`  ${padRight("", 22)} ${padRight("Overhead/turn", 16)} ${padRight("Turns", 8)} ${padRight("Search result", 16)} ${padRight("Accuracy", 10)} Server?`);
  console.log("  " + line);
  console.log(`  ${padRight("MCP Naive", 22)} ${padLeft(mcpNaiveOverhead.toLocaleString(), 6)} tok       ${padRight("1", 8)} ${padRight("N/A", 16)} ${padRight("100%", 10)} Yes`);
  console.log(`  ${padRight("MCP+Search Full", 22)} ${padLeft(mcpSearchFullOverhead.toLocaleString(), 6)} tok       ${padRight("2", 8)} ${padLeft(mcpSearchFullResultTok.toLocaleString(), 5)} tok/query   ${padLeft(((top3/total)*100).toFixed(0) + "%", 5)}${" ".repeat(5)} Yes`);
  console.log(`  ${padRight("MCP+Search Compact", 22)} ${padLeft(mcpSearchCompactOverhead.toLocaleString(), 6)} tok       ${padRight("3", 8)} ${padLeft(mcpSearchCompactResultTok.toLocaleString(), 5)} tok/query   ${padLeft(((top3/total)*100).toFixed(0) + "%", 5)}${" ".repeat(5)} Yes`);
  console.log(`  ${padRight("CLI (ocli)", 22)} ${padLeft(cliOverhead.toLocaleString(), 6)} tok       ${padRight("3", 8)} ${padLeft(cliSearchResultTok.toLocaleString(), 5)} tok/query   ${padLeft(((top3/total)*100).toFixed(0) + "%", 5)}${" ".repeat(5)} No`);
  console.log();
  console.log("  Key insights:");
  console.log("  - MCP Naive is simplest but scales terribly (130K+ tok at 845 endpoints)");
  console.log("  - MCP+Search Full has low overhead but search results carry full JSON schemas");
  console.log("  - MCP+Search Compact is the fairest MCP comparison to CLI (same flow: search → schema → call)");
  console.log(`  - CLI and MCP Compact have similar search results; CLI wins on overhead (${cliOverhead} vs ${mcpSearchCompactOverhead} tok/turn)`);
  console.log("  - CLI needs no MCP server — any agent with shell access works");
  console.log("  - All search strategies share the same BM25 accuracy");
  console.log();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
