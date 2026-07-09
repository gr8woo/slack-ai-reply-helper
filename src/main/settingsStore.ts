import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { SlackReplySettings } from "../shared/slack";

export class SettingsStore {
  private readonly filePath: string;

  constructor(private readonly defaults: SlackReplySettings) {
    this.filePath = path.join(app.getPath("userData"), "slack-reply-settings.json");
  }

  load(): SlackReplySettings {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const saved = JSON.parse(raw) as Partial<SlackReplySettings>;
      return this.merge(saved);
    } catch {
      return this.merge({});
    }
  }

  save(settings: SlackReplySettings): void {
    const payload: SlackReplySettings = {
      ...settings,
      availableChannels: []
    };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  }

  private merge(saved: Partial<SlackReplySettings>): SlackReplySettings {
    return {
      ...this.defaults,
      ...saved,
      channels: saved.channels ?? this.defaults.channels,
      availableChannels: [],
      rules: saved.rules ?? this.defaults.rules,
      keywords: saved.keywords ?? this.defaults.keywords,
      aiIntegration: {
        ...this.defaults.aiIntegration,
        ...saved.aiIntegration
      }
    };
  }
}
