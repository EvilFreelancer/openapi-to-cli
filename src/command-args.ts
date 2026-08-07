import { CliCommand } from "./openapi-to-commands";

export interface UnknownFlag {
  name: string;
  suggestion?: string;
}

const BODY_CAPABLE_METHODS = new Set(["post", "put", "patch", "delete"]);
const MAX_SUGGESTION_DISTANCE = 2;

export function acceptsFreeFormBody(command: CliCommand): boolean {
  const declaresBody = command.options.some(
    (opt) => opt.location === "body" || opt.location === "formData"
  );

  return !declaresBody && BODY_CAPABLE_METHODS.has(command.method.toLowerCase());
}

export function findUnknownFlags(command: CliCommand, flagNames: string[]): UnknownFlag[] {
  if (acceptsFreeFormBody(command)) {
    return [];
  }

  const knownNames = command.options.map((opt) => opt.name);
  const known = new Set(knownNames);

  return flagNames
    .filter((name) => !known.has(name))
    .map((name) => {
      const suggestion = suggestOptionName(name, knownNames);
      return suggestion ? { name, suggestion } : { name };
    });
}

export function formatUnknownFlagsError(commandName: string, unknown: UnknownFlag[]): string {
  const listed = unknown
    .map((flag) => (flag.suggestion ? `--${flag.name} (did you mean --${flag.suggestion}?)` : `--${flag.name}`))
    .join(", ");
  const label = unknown.length === 1 ? "Unknown option" : "Unknown options";

  return `${label}: ${listed}. Run 'ocli ${commandName} --help' to see available options.`;
}

function suggestOptionName(unknownName: string, knownNames: string[]): string | undefined {
  const normalizedUnknown = normalizeOptionName(unknownName);

  const normalizedMatch = knownNames.find((name) => normalizeOptionName(name) === normalizedUnknown);
  if (normalizedMatch) {
    return normalizedMatch;
  }

  let best: { name: string; distance: number } | undefined;
  knownNames.forEach((name) => {
    const distance = editDistance(unknownName.toLowerCase(), name.toLowerCase());
    if (distance > MAX_SUGGESTION_DISTANCE || distance >= Math.min(unknownName.length, name.length)) {
      return;
    }
    if (!best || distance < best.distance) {
      best = { name, distance };
    }
  });

  return best?.name;
}

function normalizeOptionName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitution);
    }
    previous = current;
  }

  return previous[b.length];
}
