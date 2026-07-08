# Slack AI Reply Helper

Slack에서 답장해야 할 멘션, DM, 질문을 모아 보고 AI 답장 초안을 편집한 뒤 전송하는 macOS 데스크톱 앱 프로토타입입니다.

## 개발 실행

```bash
npm install
npm run dev
```

## 현재 범위

- Electron + Vite + React 데스크톱 앱 골격
- 인박스, 답장 제안, 전송 완료, 설정, 빈 상태 화면
- 필터, 톤 변경, 다시 생성, 편집, 전송/취소, 업데이트 상태 인터랙션
- Slack Web API로 실제 멘션/DM/질문 후보 수집
- 선택된 Slack 메시지/스레드 맥락만 로컬 AI CLI에 전달해 답장 초안 생성
- `chat.postMessage` / `chat.delete` 전송 및 실행취소

## Slack 연결

앱 첫 화면에서 두 가지 방식 중 하나로 연결할 수 있습니다.

### 1. Slack OAuth 연결

Slack OAuth는 사용자가 토큰을 직접 복사하지 않고 Slack 승인 화면에서 앱에 권한을 주는 방식입니다. 이 앱은 데스크톱 앱이라 Slack 앱 설정에서 PKCE를 켜야 합니다. PKCE는 client secret을 앱에 넣지 않고도 OAuth를 안전하게 끝내기 위한 데스크톱/모바일용 보안 방식입니다.

Slack 앱 설정 순서:

> 주의: Slack 데스크톱 앱의 `환경설정 > 연결된 계정` 화면이 아닙니다. 아래 설정은 Slack 개발자 콘솔인 [Slack API Apps](https://api.slack.com/apps)에서 합니다.

1. [Slack API Apps](https://api.slack.com/apps)에서 앱을 만들거나 기존 앱을 엽니다.
2. 왼쪽 메뉴에서 `OAuth & Permissions`로 이동합니다.
3. `Redirect URLs` 섹션에서 `Add New Redirect URL`을 누릅니다.
4. 아래 값을 추가하고 `Save URLs`로 저장합니다.

   `http://localhost:48731/slack/oauth/callback`

5. 같은 `OAuth & Permissions` 화면에서 `User Token Scopes`에 아래 scopes를 추가합니다.
6. 같은 화면의 PKCE 설정에서 `Enable PKCE`를 켭니다. 보이지 않으면 `Settings > Basic Information` 또는 앱 설정의 OAuth/보안 섹션에서 `PKCE`를 찾습니다.
7. `Basic Information > App Credentials`의 `Client ID`를 복사합니다. `Client Secret`은 이 데스크톱 앱에 넣지 않습니다.
8. 이 앱 첫 화면에 `Client ID`를 붙여넣고 `Slack OAuth로 연결`을 누릅니다.

앱 첫 화면에 Slack Client ID를 입력하고 `Slack OAuth로 연결`을 누르면 브라우저에서 Slack 승인 화면이 열립니다. 승인 후 토큰은 Electron `safeStorage`로 암호화되어 로컬 앱 데이터에 저장됩니다.

필요 user scopes:

- `users:read`
- `channels:read`, `groups:read`, `im:read`, `mpim:read`
- `channels:history`, `groups:history`, `im:history`, `mpim:history`
- `chat:write`

주의:

- Redirect URL은 Slack 앱 설정과 앱이 사용하는 값이 정확히 같아야 합니다.
- PKCE를 켠 Slack 앱에서는 localhost redirect가 데스크톱 앱 OAuth로 동작합니다.
- 조직 정책상 user scopes 승인이 막혀 있으면 워크스페이스 관리자 승인이 필요할 수 있습니다.
- 현재 앱은 user token을 우선 사용합니다. 본인 DM/멘션을 보려면 bot token보다 user token이 적합합니다.

### 2. 토큰 직접 저장

이미 발급된 `xoxp-...` 또는 `xoxb-...` 토큰이 있으면 첫 화면의 token 입력칸에 붙여넣고 `암호화 저장`을 누릅니다.

### 개발용 환경 변수

`.env.example`을 참고해 `.env.local`에 값을 둘 수도 있습니다.

권장 토큰:

- 본인 DM과 멘션을 보려면 `SLACK_USER_TOKEN`이 가장 자연스럽습니다.
- 봇 토큰을 쓰면 봇이 접근 가능한 채널/DM만 읽을 수 있습니다.

현재 수집 규칙:

- 나를 멘션한 메시지
- 나에게 온 DM
- 물음표 또는 질문형 문장
- 설정 키워드(`확인부탁`, `긴급`)

## AI 초안 생성

이 앱은 별도 OpenAI/Anthropic API 키를 사용하지 않습니다. 로컬에 로그인된 CLI를 다음 순서로 사용합니다.

1. Claude Code CLI (`claude`)
2. Codex CLI (`codex exec`)

전달 범위:

- 사용자가 선택한 답장 대상 메시지
- 해당 메시지의 Slack 스레드 최근 맥락 최대 10개
- 채널명, 발신자명, 감지 사유, 선택한 톤

AI CLI는 Slack 토큰을 받지 않으며 Slack 전체를 직접 검색하지 않습니다. Slack 전송은 앱이 사용자 승인 후 `chat.postMessage`로 수행합니다.

## 다음 연결 지점

- Slack Events API 또는 Socket Mode로 실시간 큐 적재
- `conversations.replies`로 더 깊은 스레드 맥락 fetch
- 사내 AI 실행 계층으로 톤별 초안 생성
