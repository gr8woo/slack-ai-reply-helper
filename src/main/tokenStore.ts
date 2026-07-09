import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";

export interface SlackAuthCredentials {
  token: string;
  dCookie?: string;
}

interface StoredAuth {
  encryptedToken?: string;
  encryptedSlackCookieD?: string;
  slackClientId?: string;
  authSource?: "oauth" | "manual" | "slack-desktop";
}

export class TokenStore {
  private readonly filePath = path.join(app.getPath("userData"), "slack-auth.json");

  getToken(): string | undefined {
    return this.getAuthCredentials()?.token;
  }

  getAuthCredentials(): SlackAuthCredentials | undefined {
    const envToken = process.env.SLACK_USER_TOKEN ?? process.env.SLACK_BOT_TOKEN;
    if (envToken) {
      return {
        token: envToken,
        dCookie: process.env.SLACK_D_COOKIE
      };
    }

    const stored = this.readStoredAuth();
    if (!stored.encryptedToken) {
      return undefined;
    }

    return {
      token: this.decrypt(stored.encryptedToken),
      dCookie: stored.encryptedSlackCookieD ? this.decrypt(stored.encryptedSlackCookieD) : undefined
    };
  }

  saveToken(token: string): void {
    const current = this.readStoredAuth();
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("macOS safeStorage encryption is not available.");
    }

    this.writeStoredAuth({
      ...current,
      encryptedToken: this.encrypt(token),
      encryptedSlackCookieD: undefined,
      authSource: "manual"
    });
  }

  saveDesktopAuth({ token, dCookie }: SlackAuthCredentials): void {
    const current = this.readStoredAuth();
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("macOS safeStorage encryption is not available.");
    }

    this.writeStoredAuth({
      ...current,
      encryptedToken: this.encrypt(token),
      encryptedSlackCookieD: dCookie ? this.encrypt(dCookie) : undefined,
      authSource: "slack-desktop"
    });
  }

  getSlackClientId(): string | undefined {
    return this.readStoredAuth().slackClientId ?? process.env.SLACK_CLIENT_ID;
  }

  saveSlackClientId(clientId: string): void {
    const trimmed = clientId.trim();
    if (!trimmed) {
      return;
    }

    const current = this.readStoredAuth();
    this.writeStoredAuth({ ...current, slackClientId: trimmed });
  }

  clear(): void {
    if (fs.existsSync(this.filePath)) {
      fs.unlinkSync(this.filePath);
    }
  }

  private readStoredAuth(): Partial<StoredAuth> {
    if (!fs.existsSync(this.filePath)) {
      return {};
    }

    return JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<StoredAuth>;
  }

  private writeStoredAuth(auth: Partial<StoredAuth>): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(auth, null, 2), { mode: 0o600 });
  }

  private encrypt(value: string): string {
    return safeStorage.encryptString(value).toString("base64");
  }

  private decrypt(value: string): string {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("macOS safeStorage encryption is not available.");
    }

    return safeStorage.decryptString(Buffer.from(value, "base64"));
  }
}
