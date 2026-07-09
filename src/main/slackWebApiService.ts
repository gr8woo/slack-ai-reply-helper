import type {
  AiIntegrationStatus,
  PendingSlackMessage,
  Priority,
  ReasonTag,
  ReplyDraftRequest,
  ReplyTone,
  SendReplyRequest,
  SentSlackReply,
  SlackReplySettings,
  SlackReplySnapshot
} from "../shared/slack";
import type { AiDraftService } from "./aiDraftService";
import { SettingsStore } from "./settingsStore";
import { TokenStore } from "./tokenStore";

interface SlackApiResponse {
  ok: boolean;
  error?: string;
  response_metadata?: {
    next_cursor?: string;
  };
  [key: string]: unknown;
}

interface SlackConversation {
  id: string;
  name?: string;
  is_im?: boolean;
  is_mpim?: boolean;
  is_private?: boolean;
  is_archived?: boolean;
  user?: string;
}

interface SlackMessage {
  type?: string;
  subtype?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
}

interface SlackUser {
  id: string;
  name?: string;
  real_name?: string;
  profile?: {
    display_name?: string;
    real_name?: string;
    image_32?: string;
  };
}

const defaultSettings: SlackReplySettings = {
  channels: [],
  availableChannels: [],
  rules: [
    { id: "mention", label: "나를 @멘션 한 메시지", enabled: true },
    { id: "dm", label: "나에게 온 DM", enabled: true },
    { id: "question", label: "물음표(?)로 끝나는 질문", enabled: false }
  ],
  keywords: ["확인부탁", "긴급"],
  defaultTone: "default",
  quietHours: "22:00 - 08:00",
  version: "v0.1.0",
  updateStatus: "done",
  aiIntegration: {
    providerPreference: "auto"
  }
};

function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return "?";
  }
  return Array.from(trimmed)[0] ?? "?";
}

function colorFromId(id: string): string {
  const colors = ["#05372d", "#0b62d8", "#c91480", "#6941c6", "#1f8a5b", "#b5820a", "#4a5260"];
  const sum = Array.from(id).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[sum % colors.length] ?? "#05372d";
}

function ageLabel(ts: string): string {
  const timestamp = Number.parseFloat(ts) * 1000;
  const diffMs = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) {
    return "방금 전";
  }
  if (minutes < 60) {
    return `${minutes}분 전`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}시간 전`;
  }
  return `${Math.floor(hours / 24)}일 전`;
}

function isQuestion(text: string): boolean {
  return /[?？]\s*$/.test(text.trim()) || text.includes("가능할까요") || text.includes("될까요");
}

function normalizeText(text: string, users: Map<string, SlackUser>): string {
  return text
    .replace(/<@([A-Z0-9]+)>/g, (_match, userId: string) => {
      const user = users.get(userId);
      return `@${user?.profile?.display_name || user?.real_name || user?.name || userId}`;
    })
    .replace(/<#([A-Z0-9]+)\|([^>]+)>/g, "#$2")
    .replace(/<([^|>]+)\|([^>]+)>/g, "$2")
    .replace(/<([^>]+)>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export class SlackWebApiReplyService {
  private readonly settingsStore = new SettingsStore(defaultSettings);
  private settings: SlackReplySettings = this.settingsStore.load();
  private sent: SentSlackReply[] = [];
  private userId: string | null = null;
  private users = new Map<string, SlackUser>();
  private conversations = new Map<string, SlackConversation>();

  constructor(private readonly tokenStore: TokenStore, private readonly aiDraftService: AiDraftService) {}

  async getSnapshot(): Promise<SlackReplySnapshot> {
    if (!this.getToken()) {
      return this.disconnected("missing_token", "SLACK_USER_TOKEN 또는 SLACK_BOT_TOKEN이 설정되어 있지 않습니다.");
    }

    try {
      await this.ensureIdentity();
      const conversations = await this.fetchConversations();
      this.ensureSettingsChannels(conversations);
      const pending = await this.fetchPendingMessages();

      return {
        pending,
        sent: this.sent,
        settings: this.settings,
        connected: true,
        connectionStatus: "connected",
        slackClientId: this.tokenStore.getSlackClientId()
      };
    } catch (error) {
      return this.disconnected("error", error instanceof Error ? error.message : "Slack 연결 중 오류가 발생했습니다.");
    }
  }

  async generateDraft({ messageId, tone, variantIndex }: ReplyDraftRequest): Promise<string> {
    const snapshot = await this.getSnapshot();
    const message = snapshot.pending.find((item) => item.id === messageId);
    if (!message) {
      throw new Error("AI 초안을 만들 Slack 메시지를 찾지 못했습니다.");
    }

    const threadMessages = await this.fetchThreadMessages(message);
    return this.aiDraftService.generateReplyDraft(
      { message, tone, threadMessages, variantIndex },
      this.settings.aiIntegration.providerPreference
    );
  }

  async sendReply({ messageId, body }: SendReplyRequest): Promise<SentSlackReply> {
    const snapshot = await this.getSnapshot();
    const message = snapshot.pending.find((item) => item.id === messageId);

    if (!message?.channelId) {
      throw new Error("전송할 Slack 메시지를 찾을 수 없습니다.");
    }

    const result = await this.api<{ ts: string }>("chat.postMessage", {
      channel: message.channelId,
      text: body,
      thread_ts: message.threadTs
    });

    const reply: SentSlackReply = {
      id: `slack-${result.ts}`,
      messageId,
      channelId: message.channelId,
      slackTs: result.ts,
      channel: message.channel,
      senderName: message.sender.name,
      senderInitials: message.sender.initials,
      senderColor: message.sender.color,
      body,
      sentAtLabel: "방금 전"
    };

    this.sent = [reply, ...this.sent];
    return reply;
  }

  async undoSend(replyId: string): Promise<SlackReplySnapshot> {
    const reply = this.sent.find((item) => item.id === replyId);

    if (reply?.channelId && reply.slackTs) {
      await this.api("chat.delete", {
        channel: reply.channelId,
        ts: reply.slackTs
      });
    }

    this.sent = this.sent.filter((item) => item.id !== replyId);
    return this.getSnapshot();
  }

  updateSettings(settings: SlackReplySettings): SlackReplySettings {
    this.settings = settings;
    this.settingsStore.save(this.settings);
    return this.settings;
  }

  completeUpdate(): SlackReplySettings {
    this.settings = {
      ...this.settings,
      version: "v0.1.0",
      updateStatus: "done"
    };
    this.settingsStore.save(this.settings);
    return this.settings;
  }

  getAiIntegrationStatus(): Promise<AiIntegrationStatus> {
    return this.aiDraftService.getIntegrationStatus(this.settings.aiIntegration.providerPreference);
  }

  private disconnected(
    connectionStatus: "missing_token" | "error",
    errorMessage: string
  ): SlackReplySnapshot {
    return {
      pending: [],
      sent: this.sent,
      settings: this.settings,
      connected: false,
      connectionStatus,
      slackClientId: this.tokenStore.getSlackClientId(),
      errorMessage
    };
  }

  private async ensureIdentity(): Promise<void> {
    if (this.userId) {
      return;
    }

    const auth = await this.api<{ user_id?: string; user?: string }>("auth.test", {});
    this.userId = auth.user_id ?? auth.user ?? null;

    if (!this.userId) {
      throw new Error("Slack 사용자 ID를 확인하지 못했습니다.");
    }
  }

  private async fetchConversations(): Promise<SlackConversation[]> {
    const conversations: SlackConversation[] = [];
    let cursor: string | undefined;

    do {
      const response = await this.api<{ channels: SlackConversation[]; response_metadata?: { next_cursor?: string } }>(
        "conversations.list",
        {
          cursor,
          exclude_archived: "true",
          limit: "200",
          types: "public_channel,private_channel,im,mpim"
        }
      );

      conversations.push(...response.channels.filter((channel) => !channel.is_archived));
      cursor = response.response_metadata?.next_cursor || undefined;
    } while (cursor);

    conversations.forEach((conversation) => this.conversations.set(conversation.id, conversation));
    return conversations;
  }

  private ensureSettingsChannels(conversations: SlackConversation[]): void {
    const hadSavedChannels = this.settings.channels.length > 0;
    const availableChannels = conversations.map((conversation) => ({
      id: conversation.id,
      label: this.conversationLabel(conversation)
    }));

    const preferredIds = (process.env.SLACK_CHANNEL_IDS ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    const preferred = preferredIds.length > 0
      ? conversations.filter((conversation) => preferredIds.includes(conversation.id))
      : conversations.filter((conversation) => conversation.is_im || conversation.is_private).slice(0, 12);
    const selected = preferred.length > 0 ? preferred : conversations.slice(0, 12);
    const knownChannels = new Map(availableChannels.map((channel) => [channel.id, channel]));
    const existingChannels = this.settings.channels
      .filter((channel) => knownChannels.has(channel.id))
      .map((channel) => ({
        ...channel,
        label: knownChannels.get(channel.id)?.label ?? channel.label
      }));
    const selectedChannels = existingChannels.length > 0
      ? existingChannels
      : selected.map((conversation) => ({
        id: conversation.id,
        label: this.conversationLabel(conversation),
        enabled: true
      }));

    this.settings = {
      ...this.settings,
      availableChannels,
      channels: selectedChannels
    };

    if (!hadSavedChannels && selectedChannels.length > 0) {
      this.settingsStore.save(this.settings);
    }
  }

  private async fetchPendingMessages(): Promise<PendingSlackMessage[]> {
    const enabledChannels = this.settings.channels.filter((channel) => channel.enabled);
    const since24h = Math.floor(Date.now() / 1000) - 60 * 60 * 24;
    const pending: PendingSlackMessage[] = [];

    for (const channel of enabledChannels) {
      const conversation = this.conversations.get(channel.id);
      if (!conversation) {
        continue;
      }

      let history: { messages: SlackMessage[] };
      try {
        history = await this.api<{ messages: SlackMessage[] }>("conversations.history", {
          channel: channel.id,
          limit: "20",
          oldest: String(since24h)
        });
      } catch {
        continue;
      }

      const messages = history.messages
        .filter((message) => message.type === "message" && !message.subtype && message.user && message.user !== this.userId && message.text && message.ts)
        .slice(0, 8);

      for (const message of messages) {
        const item = await this.toPendingMessage(conversation, message);
        if (item) {
          pending.push(item);
        }
      }
    }

    return pending.sort((a, b) => Number.parseFloat(b.id.split(":")[1] ?? "0") - Number.parseFloat(a.id.split(":")[1] ?? "0")).slice(0, 30);
  }

  private async toPendingMessage(conversation: SlackConversation, message: SlackMessage): Promise<PendingSlackMessage | null> {
    if (!message.user || !message.text || !message.ts || !this.userId) {
      return null;
    }

    const rawText = message.text;
    const tags: ReasonTag[] = [];
    if (rawText.includes(`<@${this.userId}>`)) {
      tags.push("mention");
    }
    if (conversation.is_im) {
      tags.push("dm");
    }
    if (isQuestion(rawText)) {
      tags.push("question");
    }
    const urgentKeyword = this.settings.keywords.some((keyword) => rawText.includes(keyword));
    if (urgentKeyword) {
      tags.push("urgent");
    }

    const enabledRules = new Set(this.settings.rules.filter((rule) => rule.enabled).map((rule) => rule.id));
    const matchedEnabledRule =
      (enabledRules.has("mention") && tags.includes("mention")) ||
      (enabledRules.has("dm") && tags.includes("dm")) ||
      (enabledRules.has("question") && tags.includes("question")) ||
      urgentKeyword;

    if (!matchedEnabledRule) {
      return null;
    }

    const user = await this.fetchUser(message.user);
    const senderName = user.profile?.display_name || user.profile?.real_name || user.real_name || user.name || message.user;
    const normalizedText = normalizeText(rawText, this.users);
    const priority: Priority = tags.includes("urgent") || (tags.includes("mention") && tags.includes("question")) ? "urgent" : tags.includes("dm") ? "normal" : "low";

    return {
      id: `${conversation.id}:${message.ts}`,
      channelId: conversation.id,
      threadTs: message.thread_ts ?? message.ts,
      sender: {
        name: senderName,
        initials: initials(senderName),
        color: colorFromId(message.user)
      },
      channel: this.conversationLabel(conversation).replace(/\s/g, ""),
      channelLabel: this.conversationLabel(conversation),
      reasonTags: Array.from(new Set(tags)),
      priority,
      body: normalizedText,
      ageLabel: ageLabel(message.ts),
      slackUrl: `slack://channel?team=&id=${conversation.id}&message=${message.ts}`
    };
  }

  private async fetchThreadMessages(message: Pick<PendingSlackMessage, "channelId" | "threadTs" | "body">): Promise<string[]> {
    if (!message.channelId || !message.threadTs) {
      return message.body ? [message.body] : [];
    }

    try {
      const response = await this.api<{ messages: SlackMessage[] }>("conversations.replies", {
        channel: message.channelId,
        ts: message.threadTs,
        limit: "10"
      });
      const lines: string[] = [];

      for (const reply of response.messages) {
        const text = reply.text?.trim();
        if (!text) {
          continue;
        }
        const userName = reply.user ? await this.fetchDisplayName(reply.user) : "Slack";
        lines.push(`${userName}: ${normalizeText(text, this.users)}`);
      }

      return lines;
    } catch {
      return message.body ? [message.body] : [];
    }
  }

  private async fetchDisplayName(userId: string): Promise<string> {
    const user = await this.fetchUser(userId);
    return user.profile?.display_name || user.profile?.real_name || user.real_name || user.name || userId;
  }

  private async fetchUser(userId: string): Promise<SlackUser> {
    const cached = this.users.get(userId);
    if (cached) {
      return cached;
    }

    const response = await this.api<{ user: SlackUser }>("users.info", { user: userId });
    this.users.set(userId, response.user);
    return response.user;
  }

  private conversationLabel(conversation: SlackConversation): string {
    if (conversation.is_im) {
      return "DM";
    }
    if (conversation.is_mpim) {
      return "그룹 DM";
    }
    return `# ${conversation.name ?? conversation.id}`;
  }

  private async api<T extends object>(method: string, params: Record<string, string | undefined>): Promise<T> {
    const credentials = this.tokenStore.getAuthCredentials();
    if (!credentials?.token) {
      throw new Error("Slack token is missing.");
    }

    const form = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        form.set(key, value);
      }
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded"
    };

    if (credentials.token.startsWith("xoxc-")) {
      form.set("token", credentials.token);
      if (credentials.dCookie) {
        headers.Cookie = `d=${credentials.dCookie}`;
      }
    } else {
      headers.Authorization = `Bearer ${credentials.token}`;
    }

    const response = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers,
      body: form
    });

    if (!response.ok) {
      throw new Error(`Slack API HTTP ${response.status}: ${method}`);
    }

    const data = (await response.json()) as T & SlackApiResponse;
    if (!data.ok) {
      throw new Error(`Slack API ${method} failed: ${data.error ?? "unknown_error"}`);
    }

    return data;
  }

  private getToken(): string | undefined {
    return this.tokenStore.getToken();
  }
}
