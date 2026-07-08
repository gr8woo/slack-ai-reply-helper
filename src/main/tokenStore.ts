import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";

interface StoredAuth {
  encryptedToken: string;
  slackClientId?: string;
}

export class TokenStore {
  private readonly filePath = path.join(app.getPath("userData"), "slack-auth.json");

  getToken(): string | undefined {
    const envToken = process.env.SLACK_USER_TOKEN ?? process.env.SLACK_BOT_TOKEN;
    if (envToken) {
      return envToken;
    }

    const stored = this.readStoredAuth();
    if (!stored.encryptedToken) {
      return undefined;
    }

    const encrypted = Buffer.from(stored.encryptedToken, "base64");

    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("macOS safeStorage encryption is not available.");
    }

    return safeStorage.decryptString(encrypted);
  }

  saveToken(token: string): void {
    const current = this.readStoredAuth();
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("macOS safeStorage encryption is not available.");
    }

    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const encryptedToken = safeStorage.encryptString(token).toString("base64");
    this.writeStoredAuth({ ...current, encryptedToken });
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
}
