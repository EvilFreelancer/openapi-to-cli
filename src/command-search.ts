import { BM25Engine, BM25Result } from "./bm25";
import { CliCommand } from "./openapi-to-commands";

export interface CommandSearchResult {
  name: string;
  method: string;
  path: string;
  description?: string;
  score: number;
}

export class CommandSearch {
  private engine: BM25Engine<CliCommand> | null = null;
  private commands: CliCommand[] = [];

  load(commands: CliCommand[]): void {
    this.commands = commands;
    this.engine = new BM25Engine(commands, (cmd) => {
      const parts = [cmd.name.replace(/_/g, " "), cmd.method, cmd.path.replace(/[/{}/]/g, " ")];
      if (cmd.description) parts.push(cmd.description);
      for (const opt of cmd.options) {
        parts.push(opt.name);
        if (opt.description) parts.push(opt.description);
      }
      return parts.join(" ");
    });
  }

  search(query: string, topK = 10): CommandSearchResult[] {
    if (!this.engine || this.commands.length === 0) return [];

    const ranked: BM25Result<CliCommand>[] = this.engine.search(query, topK);
    return ranked.map((r) => ({
      name: r.document.name,
      method: r.document.method.toUpperCase(),
      path: r.document.path,
      description: r.document.description,
      score: Math.round(r.score * 1000) / 1000,
    }));
  }

  searchRegex(pattern: string, maxResults = 10): CommandSearchResult[] {
    if (this.commands.length === 0) return [];

    const regex = new RegExp(pattern, "i");
    const results: CommandSearchResult[] = [];

    for (const cmd of this.commands) {
      if (regex.test(cmd.name) || regex.test(cmd.description ?? "") || regex.test(cmd.path)) {
        results.push({
          name: cmd.name,
          method: cmd.method.toUpperCase(),
          path: cmd.path,
          description: cmd.description,
          score: 1,
        });
        if (results.length >= maxResults) break;
      }
    }

    return results;
  }
}
