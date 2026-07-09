import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { SlackAuthResult } from "../shared/slack";
import { TokenStore } from "./tokenStore";

const execFileAsync = promisify(execFile);

interface SlackBrowseTeam {
  token?: string;
  name?: string;
  id?: string;
  url?: string;
  user_id?: string;
}

interface SlackBrowseConfig {
  tokens?: Record<string, SlackBrowseTeam>;
  d_cookie?: string;
  default_team?: string;
}

function slackBrowseConfigPath(): string {
  return path.join(os.homedir(), ".config", "slack-browse", "slack-config.json");
}

function extractorCandidates(): string[] {
  return [
    process.env.SLACK_BROWSE_EXTRACTOR_PATH,
    path.join(
      os.homedir(),
      "projects",
      "service-engineering",
      ".agents",
      "skills",
      "slack-browse",
      "tools",
      "extract_slack_token.py"
    )
  ].filter(Boolean) as string[];
}

export class SlackDesktopAuthService {
  constructor(private readonly tokenStore: TokenStore) {}

  async importFromSlackDesktop(): Promise<SlackAuthResult> {
    let config = this.readConfig();
    if (!this.hasToken(config)) {
      await this.runExtractor();
      config = this.readConfig();
    }

    if (!this.hasToken(config)) {
      return {
        ok: false,
        errorMessage: "Slack Desktop 토큰을 찾지 못했습니다. Slack 앱에 로그인되어 있는지 확인해 주세요."
      };
    }

    const team = this.selectTeam(config);
    if (!team?.token) {
      return { ok: false, errorMessage: "가져올 Slack 워크스페이스 토큰을 찾지 못했습니다." };
    }

    this.tokenStore.saveDesktopAuth({
      token: team.token,
      dCookie: config?.d_cookie
    });

    return {
      ok: true,
      message: `${team.name ?? team.id ?? "Slack"} 세션을 가져왔습니다.`
    };
  }

  private readConfig(): SlackBrowseConfig | null {
    const configPath = slackBrowseConfigPath();
    if (!fs.existsSync(configPath)) {
      return null;
    }

    return JSON.parse(fs.readFileSync(configPath, "utf8")) as SlackBrowseConfig;
  }

  private hasToken(config: SlackBrowseConfig | null): config is SlackBrowseConfig {
    return Boolean(config?.tokens && Object.values(config.tokens).some((team) => team.token?.startsWith("xox")));
  }

  private selectTeam(config: SlackBrowseConfig | null): SlackBrowseTeam | undefined {
    if (!config?.tokens) {
      return undefined;
    }

    if (config.default_team && config.tokens[config.default_team]) {
      return config.tokens[config.default_team];
    }

    return Object.values(config.tokens)[0];
  }

  private async runExtractor(): Promise<void> {
    const extractor = extractorCandidates().find((candidate) => fs.existsSync(candidate));
    if (!extractor) {
      throw new Error(
        "Slack Browse extractor를 찾지 못했습니다. SLACK_BROWSE_EXTRACTOR_PATH를 설정하거나 slack-browse 토큰 추출을 먼저 실행해 주세요."
      );
    }

    await execFileAsync(process.env.PYTHON ?? "python3", [extractor], {
      timeout: 30000,
      windowsHide: true
    });
  }
}
