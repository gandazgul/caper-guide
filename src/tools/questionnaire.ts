import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  Editor,
  type EditorTheme,
  Key,
  matchesKey,
  Text,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { AdventurePackage } from "../adventure/package.ts";
import type { EvidenceRef } from "../adventure/types.ts";
import { validateEvidence } from "../adventure/validation.ts";
import { formatEvidence } from "./common.ts";

interface QuestionOption {
  value: string;
  label: string;
  description: string;
}

interface Question {
  id: string;
  label: string;
  prompt: string;
  whyItMatters: string;
  multiple: boolean;
  options: QuestionOption[];
  recommendedOptionId: string;
  recommendationReason: string;
  recommendationCitations: EvidenceRef[];
}

interface Answer {
  id: string;
  values: string[];
  labels: string[];
  customAnswers: string[];
}

interface QuestionnaireResult {
  questions: Question[];
  answers: Answer[];
  cancelled: boolean;
}

const optionSchema = Type.Object({
  value: Type.String({ minLength: 1 }),
  label: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 4 }),
});

const questionSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  label: Type.String({ minLength: 1 }),
  prompt: Type.String({ minLength: 8 }),
  whyItMatters: Type.String({ minLength: 8 }),
  multiple: Type.Optional(Type.Boolean({ default: false })),
  options: Type.Array(optionSchema, { minItems: 2, maxItems: 4 }),
  recommendedOptionId: Type.String({ minLength: 1 }),
  recommendationReason: Type.String({ minLength: 8 }),
  recommendationCitations: Type.Array(
    Type.Object({ sourceId: Type.String(), page: Type.Integer({ minimum: 1 }) }),
    { minItems: 1, maxItems: 8 },
  ),
});

function validateQuestions(pkg: AdventurePackage, questions: Question[]): void {
  const ids = new Set<string>();
  for (const question of questions) {
    if (ids.has(question.id)) throw new Error(`Duplicate question ID ${question.id}.`);
    ids.add(question.id);
    if (question.options.length < 2 || question.options.length > 4) {
      throw new Error(`${question.id} must have two to four choices.`);
    }
    if (!question.options.some((option) => option.value === question.recommendedOptionId)) {
      throw new Error(`${question.id} recommendation is not one of its choices.`);
    }
    const values = question.options.map((option) => option.value);
    if (values.includes("__other__") || new Set(values).size !== values.length) {
      throw new Error(`${question.id} choices need unique values; __other__ is reserved for free text.`);
    }
    const evidenceErrors = validateEvidence(pkg, question.recommendationCitations);
    if (evidenceErrors.length) throw new Error(`${question.id}: ${evidenceErrors.join(" ")}`);
  }
}

export function createQuestionnaireTool(pkg: AdventurePackage): ToolDefinition<any> {
  return {
    name: "ask_author",
    label: "Ask Author",
    description:
      "Ask one to three source-informed setup questions using Adventure Runner's multi-choice UI. Every question includes 2-4 choices, one cited recommendation, and an Other/free-text choice.",
    promptSnippet: "Ask source-informed multiple-choice questions with a recommended choice and Other",
    promptGuidelines: [
      "Use ask_author for every adventure setup decision; do not ask those questions as plain chat.",
      "Explain unfamiliar TTRPG terms in the prompt or option descriptions.",
    ],
    parameters: Type.Object({ questions: Type.Array(questionSchema, { minItems: 1, maxItems: 3 }) }),
    executionMode: "sequential",
    async execute(_toolCallId, rawParams: any, _signal, _onUpdate, ctx) {
      const questions: Question[] = rawParams.questions.map((question: any) => ({
        ...question,
        multiple: question.multiple === true,
      }));
      validateQuestions(pkg, questions);
      if (ctx.mode !== "tui") throw new Error("ask_author requires the interactive TUI.");

      const result = await ctx.ui.custom<QuestionnaireResult>((tui, theme, _keybindings, done) => {
        let tab = 0;
        let optionIndex = questions[0].options.findIndex((option) =>
          option.value === questions[0].recommendedOptionId
        );
        let editingOther = false;
        let cachedLines: string[] | undefined;
        let cachedWidth: number | undefined;
        let validationMessage = "";
        const selected = new Map<string, Set<string>>();
        const custom = new Map<string, string[]>();
        const answers = new Map<string, Answer>();
        for (const item of questions) {
          if (item.multiple) selected.set(item.id, new Set([item.recommendedOptionId]));
        }

        const editorTheme: EditorTheme = {
          borderColor: (value) => theme.fg("accent", value),
          selectList: {
            selectedPrefix: (value) => theme.fg("accent", value),
            selectedText: (value) => theme.fg("accent", value),
            description: (value) => theme.fg("muted", value),
            scrollInfo: (value) => theme.fg("dim", value),
            noMatch: (value) => theme.fg("warning", value),
          },
        };
        const editor = new Editor(tui, editorTheme);

        function question(): Question {
          return questions[tab];
        }

        function options(): Array<QuestionOption & { isOther?: boolean }> {
          return [...question().options, {
            value: "__other__",
            label: "Other — type your own answer",
            description: "Use your own idea instead of, or alongside, the listed choices.",
            isOther: true,
          }];
        }

        function refresh(): void {
          cachedLines = undefined;
          tui.requestRender();
        }

        function chooseDefaultIndex(): void {
          optionIndex = Math.max(
            0,
            question().options.findIndex((option) => option.value === question().recommendedOptionId),
          );
        }

        function buildAnswer(current: Question): Answer | undefined {
          const values = [...(selected.get(current.id) ?? new Set())];
          const customAnswers = custom.get(current.id) ?? [];
          if (values.length === 0 && customAnswers.length === 0) return undefined;
          return {
            id: current.id,
            values,
            labels: values.map((value) =>
              current.options.find((option) => option.value === value)?.label ?? value
            ),
            customAnswers,
          };
        }

        function saveAndAdvance(): void {
          const current = question();
          const answer = buildAnswer(current);
          if (!answer) {
            validationMessage = "Choose at least one option with Space, or use Other to type an answer.";
            refresh();
            return;
          }
          validationMessage = "";
          answers.set(current.id, answer);
          if (tab === questions.length - 1) {
            done({ questions, answers: [...answers.values()], cancelled: false });
          } else {
            tab += 1;
            chooseDefaultIndex();
            refresh();
          }
        }

        editor.onSubmit = (value) => {
          const trimmed = value.trim();
          if (!trimmed) return;
          const current = question();
          if (!current.multiple) selected.delete(current.id);
          custom.set(current.id, current.multiple ? [...(custom.get(current.id) ?? []), trimmed] : [trimmed]);
          editor.setText("");
          editingOther = false;
          if (!current.multiple) saveAndAdvance();
          else refresh();
        };

        function handleInput(data: string): void {
          if (editingOther) {
            if (matchesKey(data, Key.escape)) {
              editingOther = false;
              editor.setText("");
              refresh();
              return;
            }
            editor.handleInput(data);
            refresh();
            return;
          }
          const current = question();
          const displayed = options();
          if (matchesKey(data, Key.left) && tab > 0) {
            tab -= 1;
            validationMessage = "";
            chooseDefaultIndex();
          } else if (matchesKey(data, Key.up)) optionIndex = Math.max(0, optionIndex - 1);
          else if (matchesKey(data, Key.down)) optionIndex = Math.min(displayed.length - 1, optionIndex + 1);
          else if (matchesKey(data, Key.space) && current.multiple) {
            const option = displayed[optionIndex];
            if (option.isOther) editingOther = true;
            else {
              const values = selected.get(current.id) ?? new Set<string>();
              values.has(option.value) ? values.delete(option.value) : values.add(option.value);
              selected.set(current.id, values);
            }
          } else if (matchesKey(data, Key.enter)) {
            const option = displayed[optionIndex];
            if (option.isOther) editingOther = true;
            else if (current.multiple) saveAndAdvance();
            else {
              custom.delete(current.id);
              selected.set(current.id, new Set([option.value]));
              saveAndAdvance();
            }
          } else if (matchesKey(data, Key.escape)) {
            done({ questions, answers: [...answers.values()], cancelled: true });
          }
          refresh();
        }

        function render(width: number): string[] {
          if (cachedLines && cachedWidth === width) return cachedLines;
          cachedWidth = width;
          const lines: string[] = [];
          const renderWidth = Math.max(1, width);
          const current = question();
          const displayed = options();
          const add = (prefix: string, value: string) => {
            if (visibleWidth(prefix) >= renderWidth) prefix = "";
            const available = Math.max(1, renderWidth - visibleWidth(prefix));
            const wrapped = wrapTextWithAnsi(value, available);
            for (let index = 0; index < wrapped.length; index++) {
              lines.push(`${index === 0 ? prefix : " ".repeat(visibleWidth(prefix))}${wrapped[index]}`);
            }
          };

          lines.push(theme.fg("accent", "─".repeat(renderWidth)));
          add(" ", theme.fg("accent", theme.bold(`${current.label}  (${tab + 1}/${questions.length})`)));
          add(" ", current.prompt);
          add(" ", theme.fg("muted", `Why this matters: ${current.whyItMatters}`));
          lines.push("");
          for (let index = 0; index < displayed.length; index++) {
            const option = displayed[index];
            const cursor = index === optionIndex;
            const checked = !option.isOther && (selected.get(current.id)?.has(option.value) ?? false);
            const recommended = option.value === current.recommendedOptionId;
            const marker = current.multiple ? (checked ? "[✓]" : "[ ]") : `${index + 1}.`;
            add(
              cursor ? theme.fg("accent", "> ") : "  ",
              theme.fg(
                cursor ? "accent" : "text",
                `${marker} ${option.label}${recommended ? "  ★ Recommended" : ""}`,
              ),
            );
            add("      ", theme.fg("muted", option.description));
            if (recommended) {
              add(
                "      ",
                theme.fg(
                  "success",
                  `${current.recommendationReason} (${formatEvidence(current.recommendationCitations)})`,
                ),
              );
            }
          }
          if ((custom.get(current.id)?.length ?? 0) > 0) {
            add("   ", theme.fg("success", `Custom: ${custom.get(current.id)!.join("; ")}`));
          }
          if (editingOther) {
            lines.push("");
            add(" ", theme.fg("muted", "Your answer:"));
            for (const line of editor.render(Math.max(1, renderWidth - 2))) lines.push(` ${line}`);
          }
          lines.push("");
          if (validationMessage) add(" ", theme.fg("warning", validationMessage));
          const help = editingOther
            ? "Enter save • Esc return"
            : current.multiple
            ? "↑↓ move • Space toggle • Enter continue • Other accepts typing • Esc cancel"
            : "↑↓ move • Enter choose • Other accepts typing • Esc cancel";
          add(" ", theme.fg("dim", `${help}${tab > 0 && !editingOther ? " • ← previous question" : ""}`));
          lines.push(theme.fg("accent", "─".repeat(renderWidth)));
          cachedLines = lines;
          return lines;
        }

        return { render, invalidate: () => cachedLines = undefined, handleInput };
      });

      if (result.cancelled) {
        return {
          content: [{
            type: "text",
            text:
              "The author cancelled the questionnaire. No answers were confirmed; do not save partial choices.",
          }],
          details: result,
        };
      }
      const text = result.answers.map((answer) => {
        const values = [...answer.labels, ...answer.customAnswers.map((value) => `(custom) ${value}`)];
        return `${answer.id}: ${values.join(", ")}`;
      }).join("\n");
      return { content: [{ type: "text", text }], details: result };
    },
    renderCall(args: any, theme) {
      return new Text(
        theme.fg("toolTitle", theme.bold(`Ask Author · ${args.questions?.length ?? 0} question(s)`)),
        0,
        0,
      );
    },
    renderResult(result, _options, theme) {
      const details = result.details as QuestionnaireResult | undefined;
      if (details?.cancelled) return new Text(theme.fg("warning", "Questionnaire cancelled"), 0, 0);
      const text = result.content.find((content) => content.type === "text");
      return new Text(theme.fg("success", text?.type === "text" ? text.text : "Answers saved"), 0, 0);
    },
  };
}
