import { contextBridge, ipcRenderer } from "electron";
import type {
  ReplyDraftRequest,
  SendReplyRequest,
  SentSlackReply,
  SlackAuthResult,
  AiIntegrationStatus,
  SlackChannelOption,
  SlackOAuthStartRequest,
  SlackReplyApi,
  SlackReplySettings,
  SlackReplySnapshot
} from "../shared/slack";

const api: SlackReplyApi = {
  getSnapshot: () => ipcRenderer.invoke("slackReply:getSnapshot") as Promise<SlackReplySnapshot>,
  generateDraft: (request: ReplyDraftRequest) =>
    ipcRenderer.invoke("slackReply:generateDraft", request) as Promise<string>,
  sendReply: (request: SendReplyRequest) =>
    ipcRenderer.invoke("slackReply:sendReply", request) as Promise<SentSlackReply>,
  undoSend: (replyId: string) => ipcRenderer.invoke("slackReply:undoSend", replyId) as Promise<SlackReplySnapshot>,
  updateSettings: (settings: SlackReplySettings) =>
    ipcRenderer.invoke("slackReply:updateSettings", settings) as Promise<SlackReplySettings>,
  completeUpdate: () => ipcRenderer.invoke("slackReply:completeUpdate") as Promise<SlackReplySettings>,
  getAiIntegrationStatus: () =>
    ipcRenderer.invoke("slackReply:getAiIntegrationStatus") as Promise<AiIntegrationStatus>,
  testAiIntegration: () => ipcRenderer.invoke("slackReply:testAiIntegration") as Promise<AiIntegrationStatus>,
  searchChannels: (query: string) =>
    ipcRenderer.invoke("slackReply:searchChannels", query) as Promise<SlackChannelOption[]>,
  startOAuth: (request: SlackOAuthStartRequest) =>
    ipcRenderer.invoke("slackReply:startOAuth", request) as Promise<SlackAuthResult>,
  saveToken: (token: string) => ipcRenderer.invoke("slackReply:saveToken", token) as Promise<SlackAuthResult>,
  importDesktopAuth: () => ipcRenderer.invoke("slackReply:importDesktopAuth") as Promise<SlackAuthResult>,
  clearAuth: () => ipcRenderer.invoke("slackReply:clearAuth") as Promise<SlackAuthResult>,
  openExternal: (url: string) => ipcRenderer.invoke("slackReply:openExternal", url) as Promise<void>
};

contextBridge.exposeInMainWorld("slackReply", api);
