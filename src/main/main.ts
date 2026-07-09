import { app, BrowserWindow, ipcMain, nativeTheme } from "electron";
import path from "node:path";
import { LocalCliDraftService } from "./aiDraftService";
import { loadLocalEnv } from "./env";
import { SlackDesktopAuthService } from "./slackDesktopAuthService";
import { SlackOAuthService } from "./slackOAuthService";
import { SlackWebApiReplyService } from "./slackWebApiService";
import { TokenStore } from "./tokenStore";

loadLocalEnv();
let service: SlackWebApiReplyService;
let oauthService: SlackOAuthService;
let desktopAuthService: SlackDesktopAuthService;

app.setName("Slack 답장 도우미");
nativeTheme.themeSource = "light";

function createMainWindow(): BrowserWindow {
  const preloadPath = path.join(__dirname, "../preload/preload.js");
  const window = new BrowserWindow({
    width: 820,
    height: 650,
    minWidth: 440,
    minHeight: 540,
    title: "Slack 답장 도우미",
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: "#f6f7f9",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;

  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  return window;
}

app.whenReady().then(() => {
  const tokenStore = new TokenStore();
  service = new SlackWebApiReplyService(tokenStore, new LocalCliDraftService());
  oauthService = new SlackOAuthService(tokenStore);
  desktopAuthService = new SlackDesktopAuthService(tokenStore);

  ipcMain.handle("slackReply:getSnapshot", () => service.getSnapshot());
  ipcMain.handle("slackReply:generateDraft", (_event, request) => service.generateDraft(request));
  ipcMain.handle("slackReply:sendReply", (_event, request) => service.sendReply(request));
  ipcMain.handle("slackReply:undoSend", (_event, replyId: string) => service.undoSend(replyId));
  ipcMain.handle("slackReply:updateSettings", (_event, settings) => service.updateSettings(settings));
  ipcMain.handle("slackReply:completeUpdate", () => service.completeUpdate());
  ipcMain.handle("slackReply:getAiIntegrationStatus", () => service.getAiIntegrationStatus());
  ipcMain.handle("slackReply:testAiIntegration", () => service.getAiIntegrationStatus());
  ipcMain.handle("slackReply:startOAuth", (_event, request) => oauthService.startOAuth(request));
  ipcMain.handle("slackReply:saveToken", (_event, token: string) => oauthService.saveToken(token));
  ipcMain.handle("slackReply:importDesktopAuth", () => desktopAuthService.importFromSlackDesktop());
  ipcMain.handle("slackReply:clearAuth", () => oauthService.clearAuth());

  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
