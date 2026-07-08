import { shell } from "electron";
import crypto from "node:crypto";
import http from "node:http";
import { URL } from "node:url";
import { TokenStore } from "./tokenStore";
import type { SlackAuthResult, SlackOAuthStartRequest } from "../shared/slack";

interface SlackOAuthAccessResponse {
  ok: boolean;
  error?: string;
  access_token?: string;
  authed_user?: {
    access_token?: string;
  };
}

const defaultUserScopes = [
  "users:read",
  "channels:read",
  "groups:read",
  "im:read",
  "mpim:read",
  "channels:history",
  "groups:history",
  "im:history",
  "mpim:history",
  "chat:write"
];

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function createVerifier(): string {
  return base64Url(crypto.randomBytes(48));
}

function createChallenge(verifier: string): string {
  return base64Url(crypto.createHash("sha256").update(verifier).digest());
}

function localRedirectUri(): string {
  return process.env.SLACK_REDIRECT_URI ?? "http://localhost:48731/slack/oauth/callback";
}

export class SlackOAuthService {
  constructor(private readonly tokenStore: TokenStore) {}

  async startOAuth({ clientId, redirectUri = localRedirectUri() }: SlackOAuthStartRequest): Promise<SlackAuthResult> {
    const trimmedClientId = clientId.trim() || process.env.SLACK_CLIENT_ID;
    if (!trimmedClientId) {
      return { ok: false, errorMessage: "Slack Client ID가 필요합니다." };
    }

    const verifier = createVerifier();
    const challenge = createChallenge(verifier);
    const state = crypto.randomUUID();
    const redirect = new URL(redirectUri);

    if (redirect.hostname !== "localhost" && redirect.hostname !== "127.0.0.1") {
      return { ok: false, errorMessage: "현재 앱 내 OAuth는 localhost redirect URI만 지원합니다." };
    }

    const callbackPromise = this.waitForCallback(redirect, state);
    const authorizeUrl = new URL("https://slack.com/oauth/v2/authorize");
    authorizeUrl.searchParams.set("client_id", trimmedClientId);
    authorizeUrl.searchParams.set("user_scope", defaultUserScopes.join(","));
    authorizeUrl.searchParams.set("redirect_uri", redirect.toString());
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("code_challenge", challenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");

    await shell.openExternal(authorizeUrl.toString());
    const code = await callbackPromise;
    const token = await this.exchangeCode({
      clientId: trimmedClientId,
      code,
      codeVerifier: verifier,
      redirectUri: redirect.toString()
    });

    this.tokenStore.saveToken(token);
    return { ok: true };
  }

  saveToken(token: string): SlackAuthResult {
    const trimmed = token.trim();
    if (!trimmed.startsWith("xox")) {
      return { ok: false, errorMessage: "Slack 토큰 형식이 아닙니다." };
    }

    this.tokenStore.saveToken(trimmed);
    return { ok: true };
  }

  clearAuth(): SlackAuthResult {
    this.tokenStore.clear();
    return { ok: true };
  }

  private waitForCallback(redirect: URL, expectedState: string): Promise<string> {
    const port = Number(redirect.port || 80);
    const pathname = redirect.pathname;

    return new Promise((resolve, reject) => {
      const server = http.createServer((request, response) => {
        const requestUrl = new URL(request.url ?? "/", redirect.origin);

        if (requestUrl.pathname !== pathname) {
          response.writeHead(404);
          response.end("Not found");
          return;
        }

        const error = requestUrl.searchParams.get("error");
        const code = requestUrl.searchParams.get("code");
        const state = requestUrl.searchParams.get("state");

        if (error) {
          response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          response.end(`<h1>Slack 연결 실패</h1><p>${error}</p>`);
          server.close();
          reject(new Error(error));
          return;
        }

        if (!code || state !== expectedState) {
          response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          response.end("<h1>Slack 연결 실패</h1><p>OAuth state가 일치하지 않습니다.</p>");
          server.close();
          reject(new Error("OAuth state mismatch."));
          return;
        }

        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end("<h1>Slack 연결 완료</h1><p>이 창은 닫아도 됩니다.</p>");
        server.close();
        resolve(code);
      });

      server.on("error", reject);
      server.listen(port, redirect.hostname);
    });
  }

  private async exchangeCode({
    clientId,
    code,
    codeVerifier,
    redirectUri
  }: {
    clientId: string;
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<string> {
    const form = new URLSearchParams({
      client_id: clientId,
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri
    });

    const response = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: form
    });

    const data = (await response.json()) as SlackOAuthAccessResponse;
    if (!response.ok || !data.ok) {
      throw new Error(`Slack OAuth failed: ${data.error ?? response.status}`);
    }

    const userToken = data.authed_user?.access_token ?? data.access_token;
    if (!userToken) {
      throw new Error("Slack OAuth 응답에 access token이 없습니다.");
    }

    return userToken;
  }
}
