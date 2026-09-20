export interface CommandContext {
  cwd: string;
}

export interface CommandDefinition {
  name: string;
  aliases?: string[];
  displayName: string;
  description: string;
  summary: string;
  usage: string[];
  notes?: string[];
  execute(args: string[], context: CommandContext): Promise<void>;
}
