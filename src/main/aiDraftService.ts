import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import type { AiIntegrationStatus, AiProvider, AiProviderPreference, PendingSlackMessage, ReplyTone } from "../shared/slack";

export interface DraftContext {
  message: PendingSlackMessage;
  tone: ReplyTone;
  threadMessages: string[];
  variantIndex: number;
}

export interface AiDraftService {
  generateReplyDraft(context: DraftContext, providerPreference?: AiProviderPreference): Promise<string>;
  getIntegrationStatus(providerPreference: AiProviderPreference): Promise<AiIntegrationStatus>;
}

export class LocalCliDraftService implements AiDraftService {
  async generateReplyDraft(context: DraftContext, providerPreference: AiProviderPreference = "auto"): Promise<string> {
    const prompt = buildDraftPrompt(context);
    const status = await this.getIntegrationStatus(providerPreference);

    if (status.activeProvider === "claude") {
      try {
        const claudePath = await resolveBinary("claude");
        if (!claudePath) {
          throw new Error("Claude Code CLI를 찾지 못했습니다.");
        }
        return await runClaude(claudePath, prompt);
      } catch (error) {
        if (providerPreference === "claude") {
          throw error;
        }
        const codexPath = await resolveBinary("codex");
        if (!codexPath) {
          throw error;
        }
        return runCodex(codexPath, prompt);
      }
    }

    if (status.activeProvider === "codex") {
      const codexPath = await resolveBinary("codex");
      if (!codexPath) {
        throw new Error("Codex CLI를 찾지 못했습니다.");
      }
      return runCodex(codexPath, prompt);
    }

    throw new Error("Claude Code CLI와 Codex CLI를 찾지 못했습니다.");
  }

  async getIntegrationStatus(providerPreference: AiProviderPreference): Promise<AiIntegrationStatus> {
    const [claudePath, codexPath] = await Promise.all([resolveBinary("claude"), resolveBinary("codex")]);
    const activeProvider = chooseProvider(providerPreference, Boolean(claudePath), Boolean(codexPath));
    return {
      providerPreference,
      activeProvider,
      claudeAvailable: Boolean(claudePath),
      codexAvailable: Boolean(codexPath),
      checkedAtLabel: "방금 전",
      errorMessage: activeProvider ? undefined : "Claude Code CLI와 Codex CLI를 찾지 못했습니다."
    };
  }
}

function chooseProvider(
  providerPreference: AiProviderPreference,
  claudeAvailable: boolean,
  codexAvailable: boolean
): AiProvider | null {
  if (providerPreference === "claude") {
    return claudeAvailable ? "claude" : null;
  }
  if (providerPreference === "codex") {
    return codexAvailable ? "codex" : null;
  }
  if (claudeAvailable) {
    return "claude";
  }
  return codexAvailable ? "codex" : null;
}

const systemPrompt =
  "You are a Slack reply drafting assistant inside a macOS desktop app. " +
  "Write only the reply draft, no preface, no markdown fences. " +
  "Use Korean unless the source message is clearly in another language. " +
  "Do not claim that you sent a message or performed an action. " +
  "Be concise, helpful, and preserve uncertainty when the context is insufficient.";

function buildDraftPrompt({ message, tone, threadMessages, variantIndex }: DraftContext): string {
  const toneInstruction: Record<ReplyTone, string> = {
    formal: "격식 있고 정중한 말투",
    default: "업무용 기본 말투",
    friendly: "친근하지만 과하지 않은 말투",
    short: "짧고 핵심만 담은 말투"
  };
  const contextLines = threadMessages.length > 0
    ? threadMessages.map((line, index) => `${index + 1}. ${line}`).join("\n")
    : "(추가 스레드 맥락 없음)";

  return [
    "Slack 답장 초안을 작성해 주세요.",
    "",
    `톤: ${toneInstruction[tone]}`,
    `변형 번호: ${variantIndex + 1}`,
    `채널: ${message.channelLabel}`,
    `보낸 사람: ${message.sender.name}`,
    `감지 사유: ${message.reasonTags.join(", ")}`,
    "",
    "스레드/대화 맥락:",
    contextLines,
    "",
    "답장 대상 메시지:",
    message.body,
    "",
    "출력 규칙:",
    "- 답장 본문만 출력",
    "- 사용자가 최종 승인 전 편집할 수 있는 초안으로 작성",
    "- 모르는 내용을 확정적으로 말하지 않기",
    "- Slack에 이미 전송했다고 말하지 않기"
  ].join("\n");
}

async function runClaude(claudePath: string, prompt: string): Promise<string> {
  const result = await runCommand(
    claudePath,
    [
      "-p",
      "--output-format",
      "json",
      "--max-turns",
      "1",
      "--append-system-prompt",
      systemPrompt,
      prompt
    ],
    { timeoutMs: 120000 }
  );
  const draft = extractAgentMessage(result.stdout);
  if (!draft) {
    throw new Error("Claude Code가 빈 답장을 반환했습니다.");
  }
  return draft;
}

async function runCodex(codexPath: string, prompt: string): Promise<string> {
  const outputPath = path.join(os.tmpdir(), `slack-reply-draft-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);

  try {
    await runCommand(
      codexPath,
      [
        "exec",
        "--sandbox",
        "read-only",
        "--skip-git-repo-check",
        "--ephemeral",
        "--output-last-message",
        outputPath,
        `${systemPrompt}\n\n${prompt}`
      ],
      { timeoutMs: 120000 }
    );
    const draft = (await fs.readFile(outputPath, "utf8")).trim();
    if (!draft) {
      throw new Error("Codex CLI가 빈 답장을 반환했습니다.");
    }
    return draft;
  } finally {
    await fs.unlink(outputPath).catch(() => undefined);
  }
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

interface CommandOptions {
  timeoutMs?: number;
}

function runCommand(file: string, args: string[], options: CommandOptions = {}): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        timeout: options.timeoutMs ?? 30000,
        maxBuffer: 1024 * 1024 * 4,
        env: {
          ...process.env,
          TERM: process.env.TERM || "xterm-256color"
        }
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(Object.assign(error, { stdout, stderr }));
          return;
        }

        resolve({ stdout, stderr });
      }
    );
  });
}

async function resolveBinary(binaryName: "claude" | "codex"): Promise<string | null> {
  try {
    const result = await runCommand("/bin/zsh", ["-lc", `command -v ${binaryName}`], { timeoutMs: 5000 });
    return result.stdout.trim().split("\n")[0] || null;
  } catch {
    return null;
  }
}

function extractAgentMessage(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return "";
  }

  try {
    return readAgentResult(JSON.parse(trimmed) as unknown);
  } catch {
    return trimmed;
  }
}

function readAgentResult(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  const directResult = record.result ?? record.message ?? record.response;
  if (typeof directResult === "string") {
    return directResult.trim();
  }

  if (Array.isArray(record.content)) {
    return record.content
      .map((item) => {
        if (!item || typeof item !== "object") {
          return "";
        }
        const contentRecord = item as Record<string, unknown>;
        return typeof contentRecord.text === "string" ? contentRecord.text : "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  return "";
}
