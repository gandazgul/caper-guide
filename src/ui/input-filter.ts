export interface TerminalInputHost {
  addInputListener(listener: (input: string) => { consume?: boolean } | undefined): () => void;
}

export function isTerminalMouseReport(input: string): boolean {
  return /^(?:\x1b\[<\d+;\d+;\d+[Mm])+$/.test(input) || /^\x1b\[M[\s\S]{3}$/.test(input);
}

export function installTerminalMouseInputGuard(host: TerminalInputHost): () => void {
  return host.addInputListener((input) => isTerminalMouseReport(input) ? { consume: true } : undefined);
}
