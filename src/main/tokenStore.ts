import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";

interface StoredAuth {
  encryptedToken: string;
}

export class TokenStore {
  private readonly filePath = path.join(app.getPath("userData"), "slack-auth.json");

  getToken(): string | undefined {
    const envToken = process.env.SLACK_USER_TOKEN ?? process.env.SLACK_BOT_TOKEN;
    if (envToken) {
      return envToken;
    }

    if (!fs.existsSync(this.filePath)) {
      return undefined;
    }

    const stored = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as StoredAuth;
    const encrypted = Buffer.from(stored.encryptedToken, "base64");

    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("macOS safeStorage encryption is not available.");
    }

    return safeStorage.decryptString(encrypted);
  }

  saveToken(token: string): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("macOS safeStorage encryption is not available.");
    }

    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const encryptedToken = safeStorage.encryptString(token).toString("base64");
    fs.writeFileSync(this.filePath, JSON.stringify({ encryptedToken }, null, 2), { mode: 0o600 });
  }

  clear(): void {
    if (fs.existsSync(this.filePath)) {
      fs.unlinkSync(this.filePath);
    }
  }
}
