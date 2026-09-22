import { stripVTControlCharacters } from "node:util";
import { type Theme, type ToolDefinition, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  type Container,
  Text,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

export const EXPANDED_TOOL_LINE_LIMIT = 500;
export const CHAT_HISTORY_COMPONENT_LIMIT = 120;
export const CHAT_HISTORY_LINE_LIMIT = 2_000;

// Pi 0.80.6 compatibility seam: retain its components/events/Ctrl+O behavior, but project
// their display into harness-owned groups. No upstream package or extension is modified.
export interface ToolDisplayState {
  toolName: string;
  toolCallId: string;
  args: unknown;
  expanded: boolean;
  isPartial: boolean;
  result?: { isError: boolean; content: Array<{ type: string; text?: string; mimeType?: string }> };
}

function plain(value: string): string {
  return stripVTControlCharacters(value).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
}

export class ToolGroupDisplay {
  private theme?: Theme;
  private durations = new Map<string, number>();

  decorate(tools: ToolDefinition[]): ToolDefinition[] {
    return tools.map((tool) => ({
      ...tool,
      renderCall: (args, theme, context) => {
        this.theme = theme;
        return tool.renderCall?.(args, theme, context) ?? new Text(tool.name, 0, 0);
      },
      execute: async (id, args, signal, update, ctx) => {
        const start = performance.now();
        try {
          return await tool.execute(id, args, signal, update, ctx);
        } finally {
          this.durations.set(id, performance.now() - start);
        }
      },
    }));
  }

  renderTool(tool: ToolDisplayState, width: number): string[] {
    if (width < 1) return [];
    const bg = tool.result?.isError ? "toolErrorBg" : tool.isPartial ? "toolPendingBg" : "toolSuccessBg";
    const paint = (text: string) => this.theme?.bg(bg, text) ?? text;
    const pad = width > 2 ? 1 : 0;
    const inner = Math.max(1, width - pad * 2);
    const fit = (text: string) => {
      const clipped = truncateToWidth(text, inner);
      return paint(" ".repeat(pad) + clipped + " ".repeat(Math.max(0, width - pad - visibleWidth(clipped))));
    };
    const status = tool.result?.isError ? "✗" : tool.isPartial ? "…" : "✓";
    const elapsed = this.durations.get(tool.toolCallId);
    const suffix = elapsed === undefined ? "" : `Took ${(elapsed / 1000).toFixed(1)}s`;
    // Arguments can spoil discoveries. Only show them after deliberate expansion,
    // preserving the existing troubleshooting view without leaking during streaming.
    let args = "";
    if (tool.expanded) {
      try {
        args = plain(JSON.stringify(tool.args ?? {})).replace(/\s+/g, " ").slice(0, 240);
      } catch {
        args = "[arguments unavailable]";
      }
    }
    const title = `${status} ${tool.toolName}${args && args !== "{}" ? ` ${args}` : ""}`;
    const available = suffix && inner > suffix.length + 4 ? inner - suffix.length - 1 : inner;
    const clippedTitle = truncateToWidth(title, available);
    const header = available < inner
      ? clippedTitle + " ".repeat(inner - visibleWidth(clippedTitle) - suffix.length) + suffix
      : clippedTitle;
    const lines = [fit(header)];
    if (!tool.expanded) return lines;
    const content =
      tool.result?.content.map((part) =>
        part.type === "text"
          ? part.text ?? ""
          : part.type === "image"
          ? `[Image: ${part.mimeType ?? "unknown"}; delivered to model]`
          : `[${part.type}]`
      ).join("\n") ?? "Running…";
    // Display truncation never changes the result delivered to the model or stored in the session.
    const bounded = content.length > 100_000
      ? content.slice(0, 50_000) + "\n… display text omitted …\n" + content.slice(-50_000)
      : content;
    let body = wrapTextWithAnsi(plain(bounded), inner);
    if (body.length > EXPANDED_TOOL_LINE_LIMIT - 1) {
      const head = 249;
      const tail = 249;
      body = [
        ...body.slice(0, head),
        `… ${body.length - head - tail} display lines omitted …`,
        ...body.slice(-tail),
      ];
    }
    lines.push(...body.map(fit));
    return lines;
  }

  renderChildren(children: Component[], width: number): string[] {
    const firstVisible = Math.max(0, children.length - CHAT_HISTORY_COMPONENT_LIMIT);
    const visibleChildren = children.slice(firstVisible);
    const lines: string[] = [];
    let group: ToolExecutionComponent[] = [];
    let pendingBlank: string[] = [];
    const flush = () => {
      if (!group.length) return;
      const padding = this.theme?.bg("toolSuccessBg", " ".repeat(Math.max(0, width))) ??
        " ".repeat(Math.max(0, width));
      lines.push("", padding);
      for (const tool of group) lines.push(...this.renderTool(tool as unknown as ToolDisplayState, width));
      lines.push(padding);
      group = [];
    };
    for (const child of visibleChildren) {
      if (child instanceof ToolExecutionComponent) {
        pendingBlank = [];
        group.push(child);
      } else {
        const rendered = child.render(width);
        if (group.length && rendered.every((line) => !stripVTControlCharacters(line).trim())) {
          pendingBlank.push(...rendered);
        } else {
          flush();
          lines.push(...pendingBlank, ...rendered);
          pendingBlank = [];
        }
      }
    }
    flush();
    lines.push(...pendingBlank);

    if (firstVisible === 0 && lines.length <= CHAT_HISTORY_LINE_LIMIT) return lines;
    const notice = new Text("… older chat output hidden; the full session remains saved.", 0, 0).render(
      width,
    );
    const available = Math.max(0, CHAT_HISTORY_LINE_LIMIT - notice.length);
    return [...notice.slice(0, CHAT_HISTORY_LINE_LIMIT), ...lines.slice(-available)];
  }

  install(mode: unknown): void {
    const host = mode as { chatContainer?: Container };
    if (!host.chatContainer || !Array.isArray(host.chatContainer.children)) {
      throw new Error(
        "Tool grouping is incompatible with this TUI version; expected Pi library 0.80.6 chat container.",
      );
    }
    const container = host.chatContainer;
    container.render = (width) => this.renderChildren(container.children, width);
  }
}
