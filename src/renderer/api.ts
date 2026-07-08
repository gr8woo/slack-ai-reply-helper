import type { ReplyDraftRequest, SendReplyRequest, SentSlackReply, SlackReplyApi, SlackReplySettings, SlackReplySnapshot } from "../shared/slack";

declare global {
  interface Window {
    slackReply?: SlackReplyApi;
  }
}

const fallbackSettings: SlackReplySettings = {
  channels: [],
  rules: [
    { id: "mention", label: "나를 @멘션 한 메시지", enabled: true },
    { id: "dm", label: "나에게 온 DM", enabled: true },
    { id: "question", label: "물음표(?)로 끝나는 질문", enabled: false }
  ],
  keywords: ["확인부탁", "긴급"],
  defaultTone: "default",
  quietHours: "22:00 - 08:00",
  version: "v0.1.0",
  updateStatus: "done"
};

let fallbackSnapshot: SlackReplySnapshot = {
  pending: [],
  sent: [],
  settings: fallbackSettings,
  connected: false,
  connectionStatus: "missing_token",
  errorMessage: "Electron preload API가 연결되지 않았습니다. 데스크톱 앱으로 실행해 주세요."
};

const fallbackApi: SlackReplyApi = {
  async getSnapshot() {
    return fallbackSnapshot;
  },
  async generateDraft(_request: ReplyDraftRequest) {
    return "";
  },
  async sendReply(_request: SendReplyRequest) {
    throw new Error("Slack API가 연결되지 않았습니다.");
  },
  async undoSend(replyId: string) {
    fallbackSnapshot = {
      ...fallbackSnapshot,
      sent: fallbackSnapshot.sent.filter((item) => item.id !== replyId)
    };
    return fallbackSnapshot;
  },
  async updateSettings(settings: SlackReplySettings) {
    fallbackSnapshot = { ...fallbackSnapshot, settings };
    return settings;
  },
  async completeUpdate() {
    const settings = { ...fallbackSnapshot.settings, version: "v1.5.0", updateStatus: "done" as const };
    fallbackSnapshot = { ...fallbackSnapshot, settings };
    return settings;
  },
  async startOAuth() {
    return { ok: false, errorMessage: "Electron 데스크톱 앱에서만 OAuth 연결을 사용할 수 있습니다." };
  },
  async saveToken() {
    return { ok: false, errorMessage: "Electron 데스크톱 앱에서만 토큰 저장을 사용할 수 있습니다." };
  },
  async clearAuth() {
    return { ok: true };
  }
};

export const slackReplyApi = window.slackReply ?? fallbackApi;
