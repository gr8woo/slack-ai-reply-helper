export type ReplyTone = "formal" | "default" | "friendly" | "short";

export type ReasonTag = "mention" | "dm" | "question" | "urgent";

export type Priority = "urgent" | "normal" | "low";

export interface SlackSender {
  name: string;
  initials: string;
  color: string;
}

export interface PendingSlackMessage {
  id: string;
  channelId?: string;
  threadTs?: string;
  sender: SlackSender;
  channel: string;
  channelLabel: string;
  reasonTags: ReasonTag[];
  priority: Priority;
  body: string;
  previousMessage?: string;
  ageLabel: string;
  slackUrl?: string;
}

export interface SentSlackReply {
  id: string;
  messageId: string;
  channelId?: string;
  slackTs?: string;
  channel: string;
  senderName: string;
  senderInitials: string;
  senderColor: string;
  body: string;
  sentAtLabel: string;
}

export interface SlackReplySettings {
  channels: Array<{
    id: string;
    label: string;
    enabled: boolean;
  }>;
  rules: Array<{
    id: string;
    label: string;
    enabled: boolean;
  }>;
  keywords: string[];
  defaultTone: ReplyTone;
  quietHours: string;
  version: string;
  updateStatus: "available" | "updating" | "done";
}

export interface ReplyDraftRequest {
  messageId: string;
  tone: ReplyTone;
  variantIndex: number;
}

export interface SendReplyRequest {
  messageId: string;
  body: string;
}

export interface SlackReplySnapshot {
  pending: PendingSlackMessage[];
  sent: SentSlackReply[];
  settings: SlackReplySettings;
  connected: boolean;
  connectionStatus: "connected" | "missing_token" | "error";
  slackClientId?: string;
  errorMessage?: string;
}

export interface SlackReplyApi {
  getSnapshot(): Promise<SlackReplySnapshot>;
  generateDraft(request: ReplyDraftRequest): Promise<string>;
  sendReply(request: SendReplyRequest): Promise<SentSlackReply>;
  undoSend(replyId: string): Promise<SlackReplySnapshot>;
  updateSettings(settings: SlackReplySettings): Promise<SlackReplySettings>;
  completeUpdate(): Promise<SlackReplySettings>;
  startOAuth(request: SlackOAuthStartRequest): Promise<SlackAuthResult>;
  saveToken(token: string): Promise<SlackAuthResult>;
  importDesktopAuth(): Promise<SlackAuthResult>;
  clearAuth(): Promise<SlackAuthResult>;
}

export interface SlackOAuthStartRequest {
  clientId: string;
  redirectUri?: string;
}

export interface SlackAuthResult {
  ok: boolean;
  message?: string;
  errorMessage?: string;
}

export const toneLabels: Record<ReplyTone, string> = {
  formal: "격식체",
  default: "기본",
  friendly: "친근",
  short: "짧게"
};

export const reasonLabels: Record<ReasonTag, string> = {
  mention: "@ 멘션",
  dm: "DM",
  question: "? 질문",
  urgent: "긴급"
};

export const priorityLabels: Record<Priority, string> = {
  urgent: "긴급",
  normal: "보통",
  low: "낮음"
};
