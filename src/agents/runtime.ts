import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  initTheme,
  InteractiveMode,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import type { AgentDefinition } from "./types.ts";
import type { AdventurePackage } from "../adventure/package.ts";
import { installTerminalMouseInputGuard } from "../ui/input-filter.ts";
import { ToolGroupDisplay } from "../ui/tool-groups.ts";
import { installGuideCompactionContinuity } from "./compaction.ts";

export function parseModelRef(value: string): { provider: string; id: string } {
  const slash = value.indexOf("/");
  const colon = value.indexOf(":");
  const separator = Math.min(...[slash, colon].filter((index) => index > 0));
  if (!Number.isFinite(separator) || separator === value.length - 1) {
    throw new Error(`Model must be provider/model or provider:model, received ${value}.`);
  }
  return { provider: value.slice(0, separator), id: value.slice(separator + 1) };
}

function findModel(available: Model<any>[], reference: string): Model<any> {
  const parsed = parseModelRef(reference);
  const model = available.find((candidate) =>
    candidate.provider === parsed.provider && candidate.id === parsed.id
  );
  if (!model) {
    throw new Error(
      `Model ${reference} is unavailable. Check its provider/model ID in ~/.wld/models.json and credentials in ~/.wld/auth.json.`,
    );
  }
  return model;
}

function shellQuote(value: string): string {
  if (/^[a-zA-Z0-9_./~:@-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function buildResumeCommand(resumeArgs: string[], sessionId: string): string {
  const configPath = fileURLToPath(new URL("../../deno.json", import.meta.url));
  return ["deno", "task", "--config", configPath, "adventure", ...resumeArgs, "--session", sessionId]
    .map(shellQuote)
    .join(" ");
}

export function getHarnessSessionDir(
  pkg: AdventurePackage,
  sessionGroup: string,
  homeDirectory = homedir(),
): string {
  const pathHash = createHash("sha256").update(pkg.root).digest("hex").slice(0, 12);
  const adventureKey = `${pkg.manifest.id}-${pathHash}`;
  const safeGroup = sessionGroup.replace(/[^a-zA-Z0-9_-]+/g, "-");
  return join(homeDirectory, ".adventure-guide", "sessions", adventureKey, safeGroup);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound || error instanceof Deno.errors.NotADirectory) return false;
    throw error;
  }
}

async function copyLegacySessions(legacyDir: string, sessionDir: string): Promise<void> {
  if (!(await pathExists(legacyDir))) return;
  await Deno.mkdir(sessionDir, { recursive: true });
  for await (const entry of Deno.readDir(legacyDir)) {
    if (!entry.isFile || !entry.name.endsWith(".jsonl")) continue;
    const target = join(sessionDir, entry.name);
    if (!(await pathExists(target))) await Deno.copyFile(join(legacyDir, entry.name), target);
  }
}

async function findSessionFile(sessionDir: string, sessionId: string): Promise<string> {
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(sessionId)) {
    throw new Error(`Invalid session ID: ${sessionId}`);
  }
  if (await pathExists(sessionDir)) {
    for await (const entry of Deno.readDir(sessionDir)) {
      if (entry.isFile && entry.name.endsWith(`_${sessionId}.jsonl`)) return join(sessionDir, entry.name);
    }
  }
  throw new Error(`Session ${sessionId} was not found in Adventure Runner's session store.`);
}

export async function continueAdventureSession(sessionDir: string, cwd: string): Promise<SessionManager> {
  // The directory already identifies this adventure and role; launch cwd is only for file completion.
  const sessions = await SessionManager.listAll(sessionDir);
  return sessions.length
    ? SessionManager.open(sessions[0].path, sessionDir, cwd)
    : SessionManager.create(cwd, sessionDir);
}

type SettingsInput = Parameters<typeof SettingsManager.inMemory>[0];

export function harnessSettings(raw: Record<string, unknown>): SettingsInput {
  return {
    ...raw,
    // undici 8.5's WebSocket MessageEvent is incompatible with Deno's native Event implementation.
    // The same providers support SSE, so the harness chooses it deterministically instead of crashing.
    transport: "sse",
    quietStartup: true,
    enableInstallTelemetry: false,
    enableAnalytics: false,
    extensions: [],
    skills: [],
    prompts: [],
    themes: [],
    packages: [],
    theme: undefined,
  } as SettingsInput;
}

async function loadHarnessSettings(agentDir: string): Promise<SettingsManager> {
  const path = join(agentDir, "settings.json");
  let raw: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(await Deno.readTextFile(path));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      raw = parsed as Record<string, unknown>;
    } else throw new Error("Settings must be a JSON object.");
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not read model defaults from ${path}: ${message}`);
    }
  }
  return SettingsManager.inMemory(harnessSettings(raw));
}

export function buildAgentSystemPrompt(
  agent: AgentDefinition,
  pkg: AdventurePackage,
  workingDirectory: string,
): string {
  return [
    agent.systemPrompt,
    "",
    "## Active package",
    `Adventure ID: ${pkg.manifest.id}`,
    `Package root: ${pkg.root}`,
    "Use adventure_inspect for the current title, status, and validation issues; these can change during authoring.",
    `File selection root: ${workingDirectory}`,
  ].join("\n");
}

export function selectStartupInstruction(
  options: { startupInstruction?: string; resumeInstruction?: string },
  hasConversation: boolean,
): string | undefined {
  return hasConversation ? options.resumeInstruction : options.startupInstruction;
}

export async function runAgentTui(options: {
  pkg: AdventurePackage;
  agent: AgentDefinition;
  tools: ToolDefinition[];
  sessionGroup: string;
  resumeArgs: string[];
  welcomeMessage: string;
  startupInstruction?: string;
  resumeInstruction?: string;
  workingDirectory?: string;
  model?: string;
  continueSession?: boolean;
  sessionId?: string;
}): Promise<void> {
  // Model providers read OS metadata when constructing request headers, after the TUI enters raw mode.
  // Check without prompting before starting the terminal so custom launch commands fail intelligibly.
  for (const kind of ["homedir", "osRelease"] as const) {
    if ((await Deno.permissions.query({ name: "sys", kind })).state !== "granted") {
      throw new Error(
        `The interactive harness requires --allow-sys=homedir,osRelease. Restart using 'deno task adventure' or add that flag to your deno run command. Missing: ${kind}.`,
      );
    }
  }
  const unknownTools = options.agent.tools.filter((name) =>
    !options.tools.some((tool) => tool.name === name)
  );
  if (unknownTools.length) {
    throw new Error(`${options.agent.displayName} requests unavailable tools: ${unknownTools.join(", ")}`);
  }

  const agentDir = join(homedir(), ".wld");
  const workingDirectory = options.workingDirectory ?? options.pkg.root;
  if (options.continueSession && options.sessionId) {
    throw new Error("Use either --continue or --session, not both.");
  }
  const sessionDir = getHarnessSessionDir(options.pkg, options.sessionGroup);
  await copyLegacySessions(join(options.pkg.root, ".sessions", options.sessionGroup), sessionDir);
  const sessionManager = options.sessionId
    ? SessionManager.open(
      await findSessionFile(sessionDir, options.sessionId),
      sessionDir,
      workingDirectory,
    )
    : options.continueSession
    ? await continueAdventureSession(sessionDir, workingDirectory)
    : SessionManager.create(workingDirectory, sessionDir);
  const dynamicContext = buildAgentSystemPrompt(options.agent, options.pkg, workingDirectory);
  const toolDisplay = new ToolGroupDisplay();
  const displayTools = toolDisplay.decorate(options.tools);
  const requestedModel = options.model ?? options.agent.model;

  const createRuntime = async (runtimeOptions: {
    cwd: string;
    agentDir: string;
    sessionManager: SessionManager;
    sessionStartEvent?: {
      type: "session_start";
      reason: "startup" | "reload" | "new" | "resume" | "fork";
      previousSessionFile?: string;
    };
  }) => {
    const settingsManager = await loadHarnessSettings(runtimeOptions.agentDir);
    const services = await createAgentSessionServices({
      cwd: runtimeOptions.cwd,
      agentDir: runtimeOptions.agentDir,
      settingsManager,
      resourceLoaderOptions: {
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        systemPrompt: dynamicContext,
        appendSystemPrompt: [],
      },
    });
    const model = requestedModel
      ? findModel(services.modelRegistry.getAvailable(), requestedModel)
      : undefined;
    const created = await createAgentSessionFromServices({
      services,
      sessionManager: runtimeOptions.sessionManager,
      sessionStartEvent: runtimeOptions.sessionStartEvent,
      model,
      thinkingLevel: options.agent.thinkingLevel,
      tools: options.agent.tools,
      customTools: displayTools,
    });
    if (options.agent.id === "guide") installGuideCompactionContinuity(created.session);
    if (typeof options.agent.temperature === "number") {
      const originalStream = created.session.agent.streamFn;
      const temperature = options.agent.temperature;
      created.session.agent.streamFn = (model, context, streamOptions) =>
        model.api === "openai-codex-responses"
          ? originalStream(model, context, streamOptions)
          : originalStream(model, context, { ...streamOptions, temperature });
    }
    return { ...created, services, diagnostics: services.diagnostics };
  };

  const runtime = await createAgentSessionRuntime(createRuntime, {
    cwd: workingDirectory,
    agentDir,
    sessionManager,
  });
  if (!runtime.session.systemPrompt.startsWith(options.agent.systemPrompt)) {
    throw new Error(
      `${options.agent.displayName} did not receive its loaded agent definition as system prompt.`,
    );
  }
  initTheme(runtime.services.settingsManager.getTheme(), true);
  Deno.env.set("PI_OFFLINE", "1");
  const hasConversation = runtime.session.sessionManager.buildSessionContext().messages.length > 0;
  const mode = new InteractiveMode(runtime, {
    verbose: false,
  });
  toolDisplay.install(mode);
  const modeInternals = mode as unknown as {
    ui: {
      addInputListener(listener: (input: string) => { consume?: boolean } | undefined): () => void;
      stop(): void;
      terminal: { drainInput(timeoutMs: number): Promise<void>; setTitle(title: string): void };
    };
    updateTerminalTitle(): void;
    uncaughtCrash(error: Error): never;
  };
  installTerminalMouseInputGuard(modeInternals.ui);
  const terminalTitle = `${options.agent.displayName} — Adventure Runner`;
  modeInternals.updateTerminalTitle = () => modeInternals.ui.terminal.setTitle(terminalTitle);
  modeInternals.uncaughtCrash = (error: Error): never => {
    try {
      modeInternals.ui.stop();
    } catch {
      // The terminal may already be gone; still report the harness-owned error below.
    }
    console.error("Adventure Runner exiting due to an unexpected error:");
    console.error(error);
    process.exit(1);
  };
  const shutdownInternals = modeInternals as typeof modeInternals & {
    isShuttingDown: boolean;
    runtimeHost: { dispose(): Promise<void> };
    themeController: { disableAutoSync(): void };
    stop(): void;
    shutdown(options?: { fromSignal?: boolean }): Promise<void>;
  };
  shutdownInternals.shutdown = async (shutdownOptions?: { fromSignal?: boolean }): Promise<void> => {
    if (shutdownInternals.isShuttingDown) return;
    shutdownInternals.isShuttingDown = true;
    if (shutdownOptions?.fromSignal) {
      await shutdownInternals.runtimeHost.dispose();
      shutdownInternals.themeController.disableAutoSync();
      await shutdownInternals.ui.terminal.drainInput(1000);
      shutdownInternals.stop();
      process.exit(0);
    }

    shutdownInternals.themeController.disableAutoSync();
    await shutdownInternals.ui.terminal.drainInput(1000);
    shutdownInternals.stop();
    await shutdownInternals.runtimeHost.dispose();
    const active = runtime.session.sessionManager;
    const sessionFile = active.getSessionFile();
    if (sessionFile && await pathExists(sessionFile)) {
      process.stdout.write(
        `To resume this session: ${buildResumeCommand(options.resumeArgs, active.getSessionId())}\n`,
      );
    }
    process.exit(0);
  };
  try {
    await mode.init();
    modeInternals.updateTerminalTitle();

    if (!hasConversation) {
      await runtime.session.sendCustomMessage({
        customType: "Adventure Runner",
        content: options.welcomeMessage,
        display: true,
        details: { kind: "welcome", agent: options.agent.id },
      });
    }
    const startupInstruction = selectStartupInstruction(options, hasConversation);
    if (startupInstruction) {
      await runtime.session.sendCustomMessage(
        {
          customType: "adventure-runner.startup",
          content: startupInstruction,
          display: false,
          details: { kind: hasConversation ? "resume" : "startup", agent: options.agent.id },
        },
        { triggerTurn: true },
      );
    }
    await mode.run();
  } catch (error) {
    shutdownInternals.themeController.disableAutoSync();
    shutdownInternals.stop();
    await runtime.dispose();
    throw error;
  }
}
