import {
  Check,
  ChevronLeft,
  Clock,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Settings,
  Sparkles,
  Undo2,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { priorityLabels, reasonLabels, toneLabels } from "../shared/slack";
import type {
  PendingSlackMessage,
  ReasonTag,
  ReplyTone,
  SentSlackReply,
  SlackReplySettings,
  SlackReplySnapshot
} from "../shared/slack";
import { slackReplyApi } from "./api";

type View = "inbox" | "reply" | "sent" | "settings" | "empty";
type InboxFilter = "all" | "mention" | "dm" | "question";

const filterLabels: Record<InboxFilter, string> = {
  all: "전체",
  mention: "멘션",
  dm: "DM",
  question: "질문"
};

const tones: ReplyTone[] = ["formal", "default", "friendly", "short"];

function statusText(count: number): string {
  return count > 0 ? `Slack 연결됨 · ${count}개 채널 감시 중` : "백그라운드에서 3개 채널 감시 중...";
}

export function App() {
  const [snapshot, setSnapshot] = useState<SlackReplySnapshot | null>(null);
  const [view, setView] = useState<View>("inbox");
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tone, setTone] = useState<ReplyTone>("default");
  const [variantIndex, setVariantIndex] = useState(0);
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [isDrafting, setIsDrafting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [lastReply, setLastReply] = useState<SentSlackReply | null>(null);
  const [undoSeconds, setUndoSeconds] = useState(5);

  useEffect(() => {
    void slackReplyApi.getSnapshot().then((nextSnapshot) => {
      setSnapshot(nextSnapshot);
      setTone(nextSnapshot.settings.defaultTone);
      setSelectedId(nextSnapshot.pending[0]?.id ?? null);
      if (nextSnapshot.pending.length === 0) {
        setView("empty");
      }
    });
  }, []);

  const pending = snapshot?.pending ?? [];
  const settings = snapshot?.settings;
  const selectedMessage = pending.find((message) => message.id === selectedId) ?? pending[0] ?? null;
  const enabledChannelCount = settings?.channels.filter((channel) => channel.enabled).length ?? 0;

  const filteredMessages = useMemo(() => {
    if (filter === "all") {
      return pending;
    }

    return pending.filter((message) => message.reasonTags.includes(filter));
  }, [filter, pending]);

  useEffect(() => {
    if (!selectedMessage || view !== "reply") {
      return;
    }

    let alive = true;
    setIsDrafting(true);
    setDraftError(null);
    setDraft("");
    void slackReplyApi.generateDraft({ messageId: selectedMessage.id, tone, variantIndex })
      .then((nextDraft) => {
        if (alive) {
          setDraft(nextDraft);
        }
      })
      .catch((error) => {
        if (alive) {
          setDraftError(error instanceof Error ? error.message : "AI 초안 생성에 실패했습니다.");
        }
      })
      .finally(() => {
        if (alive) {
          setIsDrafting(false);
        }
      });

    return () => {
      alive = false;
    };
  }, [selectedMessage, tone, variantIndex, view]);

  useEffect(() => {
    if (!draftError || view !== "reply") {
      return;
    }

    const fallback = selectedMessage ? `${selectedMessage.sender.name}님, 확인했습니다. 정리해서 답변드릴게요.` : "";
    if (fallback) {
      setDraft(fallback);
    }
  }, [draftError, selectedMessage, view]);

  useEffect(() => {
    if (view !== "sent" || !lastReply) {
      return;
    }

    setUndoSeconds(5);
    const timer = window.setInterval(() => {
      setUndoSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [lastReply, view]);

  function openReply(message: PendingSlackMessage) {
    setSelectedId(message.id);
    setVariantIndex(0);
    setTone(settings?.defaultTone ?? "default");
    setView("reply");
  }

  async function sendReply() {
    if (!selectedMessage || draft.trim().length === 0) {
      return;
    }

    const reply = await slackReplyApi.sendReply({ messageId: selectedMessage.id, body: draft.trim() });
    const nextSnapshot = await slackReplyApi.getSnapshot();
    setSnapshot(nextSnapshot);
    setLastReply(reply);
    setToast(`${reply.channel} 에 전송했어요`);
    window.setTimeout(() => setToast(null), 3200);
    setView("sent");
  }

  async function undoSend() {
    if (!lastReply) {
      return;
    }

    const nextSnapshot = await slackReplyApi.undoSend(lastReply.id);
    setSnapshot(nextSnapshot);
    setSelectedId(lastReply.messageId);
    setLastReply(null);
    setView("reply");
  }

  function goNext() {
    const next = snapshot?.pending[0] ?? null;
    if (!next) {
      setView("empty");
      return;
    }

    openReply(next);
  }

  async function updateSettings(nextSettings: SlackReplySettings) {
    const updated = await slackReplyApi.updateSettings(nextSettings);
    if (snapshot) {
      setSnapshot({ ...snapshot, settings: updated });
    }
  }

  async function completeUpdate() {
    if (!settings || !snapshot) {
      return;
    }

    await updateSettings({ ...settings, updateStatus: "updating" });
    window.setTimeout(async () => {
      const updated = await slackReplyApi.completeUpdate();
      setSnapshot((current) => (current ? { ...current, settings: updated } : current));
    }, 1900);
  }

  if (!snapshot || !settings) {
    return (
      <AppShell width="compact">
        <div className="loading">Slack 답장 도우미를 준비하고 있어요.</div>
      </AppShell>
    );
  }

  if (!snapshot.connected) {
    return (
      <AppShell width="compact">
        <ConnectionView
          errorMessage={snapshot.errorMessage}
          status={snapshot.connectionStatus}
          onRetry={() => {
            void slackReplyApi.getSnapshot().then((nextSnapshot) => {
              setSnapshot(nextSnapshot);
              setSelectedId(nextSnapshot.pending[0]?.id ?? null);
              setView(nextSnapshot.pending.length === 0 ? "empty" : "inbox");
            });
          }}
        />
      </AppShell>
    );
  }

  return (
    <AppShell width={view === "reply" ? "wide" : view === "settings" ? "medium" : "compact"}>
      {view === "inbox" && (
        <InboxView
          filter={filter}
          messages={filteredMessages}
          pendingCount={pending.length}
          sentCount={snapshot.sent.length}
          status={statusText(enabledChannelCount)}
          onFilter={setFilter}
          onOpenReply={openReply}
          onOpenSettings={() => setView("settings")}
        />
      )}
      {view === "reply" && selectedMessage && (
        <ReplyView
          draft={draft}
          draftError={draftError}
          isDrafting={isDrafting}
          message={selectedMessage}
          messageIndex={pending.findIndex((message) => message.id === selectedMessage.id) + 1}
          pendingCount={pending.length}
          status={statusText(enabledChannelCount)}
          tone={tone}
          toast={toast}
          onBack={() => setView(pending.length > 0 ? "inbox" : "empty")}
          onDraftChange={setDraft}
          onRegenerate={() => setVariantIndex((index) => index + 1)}
          onSend={() => void sendReply()}
          onHold={() => setView("inbox")}
          onTone={setTone}
        />
      )}
      {view === "sent" && lastReply && (
        <SentView
          pendingCount={pending.length}
          reply={lastReply}
          seconds={undoSeconds}
          onNext={goNext}
          onUndo={() => void undoSend()}
        />
      )}
      {view === "settings" && (
        <SettingsView
          settings={settings}
          onBack={() => setView(pending.length > 0 ? "inbox" : "empty")}
          onCompleteUpdate={() => void completeUpdate()}
          onSettings={(nextSettings) => void updateSettings(nextSettings)}
        />
      )}
      {view === "empty" && (
        <EmptyView
          status={statusText(enabledChannelCount)}
          onRefresh={() => setView(pending.length > 0 ? "inbox" : "empty")}
          onSettings={() => setView("settings")}
        />
      )}
    </AppShell>
  );
}

function AppShell({ children, width }: { children: React.ReactNode; width: "compact" | "medium" | "wide" }) {
  return (
    <main className={`app-shell app-shell-${width}`}>
      <header className="titlebar">
        <div className="window-title">Slack 답장 도우미</div>
      </header>
      {children}
    </main>
  );
}

function ConnectionView({
  errorMessage,
  onRetry,
  status
}: {
  errorMessage?: string;
  onRetry: () => void;
  status: "connected" | "missing_token" | "error";
}) {
  const [clientId, setClientId] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<"oauth" | "token" | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  async function connectOAuth() {
    setBusy("oauth");
    setLocalError(null);
    try {
      const result = await slackReplyApi.startOAuth({ clientId });
      if (!result.ok) {
        setLocalError(result.errorMessage ?? "Slack OAuth 연결에 실패했습니다.");
        return;
      }
      onRetry();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Slack OAuth 연결에 실패했습니다.");
    } finally {
      setBusy(null);
    }
  }

  async function saveToken() {
    setBusy("token");
    setLocalError(null);
    try {
      const result = await slackReplyApi.saveToken(token);
      if (!result.ok) {
        setLocalError(result.errorMessage ?? "토큰 저장에 실패했습니다.");
        return;
      }
      setToken("");
      onRetry();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "토큰 저장에 실패했습니다.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="body connection-body">
      <div className="connection-icon">S</div>
      <h1>Slack 연결이 필요해요</h1>
      <p>
        {status === "missing_token"
          ? "실제 Slack 메시지를 읽으려면 Slack Web API 토큰을 환경 변수로 설정해야 합니다."
          : "Slack API에서 메시지를 불러오지 못했습니다."}
      </p>
      {(localError || errorMessage) && <div className="connection-error">{localError ?? errorMessage}</div>}
      <div className="connection-steps">
        <strong>OAuth 설정 체크리스트</strong>
        <p className="connection-note">Slack 데스크톱 앱 환경설정이 아니라 <b>api.slack.com/apps</b>의 개발자 앱 설정입니다.</p>
        <ol>
          <li><b>api.slack.com/apps</b>에서 앱 생성 또는 선택</li>
          <li><b>OAuth &amp; Permissions</b>에서 Redirect URL 추가</li>
          <li><code>http://localhost:48731/slack/oauth/callback</code></li>
          <li><b>OAuth &amp; Permissions</b>의 PKCE 설정 활성화</li>
          <li><b>Basic Information</b>의 Client ID 입력</li>
        </ol>
      </div>
      <div className="connection-form">
        <label>
          Slack Client ID
          <input
            placeholder="1234567890.1234567890123"
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
          />
        </label>
        <button className="primary-action compact" disabled={busy === "oauth"} onClick={() => void connectOAuth()}>
          {busy === "oauth" ? "Slack 승인 대기 중..." : "Slack OAuth로 연결"}
        </button>
      </div>
      <div className="connection-divider">또는</div>
      <div className="connection-form">
        <label>
          Slack token
          <input
            placeholder="xoxp-... 또는 xoxb-..."
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
        </label>
        <button className="secondary-action wide" disabled={busy === "token"} onClick={() => void saveToken()}>
          암호화 저장
        </button>
      </div>
      <button className="refresh-button retry" onClick={onRetry}>
        <RefreshCw size={16} />
        다시 확인
      </button>
    </section>
  );
}

function InboxView({
  filter,
  messages,
  pendingCount,
  sentCount,
  status,
  onFilter,
  onOpenReply,
  onOpenSettings
}: {
  filter: InboxFilter;
  messages: PendingSlackMessage[];
  pendingCount: number;
  sentCount: number;
  status: string;
  onFilter: (filter: InboxFilter) => void;
  onOpenReply: (message: PendingSlackMessage) => void;
  onOpenSettings: () => void;
}) {
  return (
    <>
      <section className="body inbox-body">
        <div className="tabs-row">
          <button className="tab active">대기중 <span>{pendingCount}</span></button>
          <button className="tab">전송됨 <span className="muted-count">{sentCount}</span></button>
          <button className="icon-button" aria-label="설정" onClick={onOpenSettings}>
            <Settings size={16} />
          </button>
        </div>

        <div className="filter-row">
          {(Object.keys(filterLabels) as InboxFilter[]).map((key) => (
            <button className={`filter-chip ${filter === key ? "active" : ""}`} key={key} onClick={() => onFilter(key)}>
              {filterLabels[key]}
            </button>
          ))}
        </div>

        <div className="message-list">
          {messages.map((message) => (
            <MessageCard key={message.id} message={message} onOpen={() => onOpenReply(message)} />
          ))}
          {messages.length === 0 && <div className="no-results">해당하는 메시지가 없어요.</div>}
        </div>
      </section>
      <StatusBar text={status} />
    </>
  );
}

function MessageCard({ message, onOpen }: { message: PendingSlackMessage; onOpen: () => void }) {
  return (
    <article className={`message-card priority-${message.priority}`} onClick={onOpen}>
      <div className="card-head">
        <Avatar sender={message.sender} />
        <div className="message-meta">
          <strong>{message.sender.name}</strong>
          <span>{message.channelLabel}</span>
        </div>
        <div className={`priority-label priority-label-${message.priority}`}>
          <span />
          {priorityLabels[message.priority]}
        </div>
      </div>
      <TagRow tags={message.reasonTags.filter((tag) => tag !== "urgent")} />
      <p className="message-body">"{message.body}"</p>
      <div className="card-foot">
        <span>{message.ageLabel}</span>
        <button>답장 제안 보기</button>
      </div>
    </article>
  );
}

function ReplyView({
  draft,
  draftError,
  isDrafting,
  message,
  messageIndex,
  pendingCount,
  status,
  tone,
  toast,
  onBack,
  onDraftChange,
  onHold,
  onRegenerate,
  onSend,
  onTone
}: {
  draft: string;
  draftError: string | null;
  isDrafting: boolean;
  message: PendingSlackMessage;
  messageIndex: number;
  pendingCount: number;
  status: string;
  tone: ReplyTone;
  toast: string | null;
  onBack: () => void;
  onDraftChange: (draft: string) => void;
  onHold: () => void;
  onRegenerate: () => void;
  onSend: () => void;
  onTone: (tone: ReplyTone) => void;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (editorRef.current && editorRef.current.textContent !== draft) {
      editorRef.current.textContent = draft;
    }
  }, [draft]);

  return (
    <>
      <section className="body reply-body">
        <div className="reply-top">
          <button className="back-button" onClick={onBack}>
            <ChevronLeft size={17} />
            대기중
          </button>
          <span className="reply-counter">{pendingCount}건 중 {messageIndex}번째</span>
        </div>

        <article className="context-card">
          <div className="context-head">
            <Avatar sender={message.sender} size="large" />
            <div className="message-meta">
              <strong>{message.sender.name}</strong>
              <span>{message.channelLabel} · {message.ageLabel}</span>
            </div>
            <TagRow tags={message.reasonTags} />
          </div>
          <div className="thread-context">
            <div className="overline">스레드 맥락</div>
            {message.previousMessage && <p className="previous-message"><span>{message.sender.initials}</span>{message.previousMessage}</p>}
            <p className="target-message">
              <Avatar sender={message.sender} size="small" />
              {message.body}
            </p>
          </div>
        </article>

        <div className="draft-head">
          <div>
            <Sparkles size={15} />
            <strong>{isDrafting ? "AI가 답장을 작성 중" : "AI가 제안한 답장"}</strong>
            <span>{isDrafting ? "Slack 맥락 전달 중" : "편집 가능"}</span>
          </div>
          <button onClick={onRegenerate}>
            <RefreshCw size={15} />
            다시 생성
          </button>
        </div>

        <div
          aria-label="답장 초안"
          className="draft-editor"
          contentEditable
          data-placeholder="답장을 입력하세요..."
          ref={editorRef}
          role="textbox"
          suppressContentEditableWarning
          onInput={(event) => onDraftChange(event.currentTarget.textContent ?? "")}
        />
        {draftError && <div className="draft-error">{draftError}</div>}

        <div className="tone-row">
          <span>톤</span>
          {tones.map((item) => (
            <button className={`tone-chip ${tone === item ? "active" : ""}`} key={item} onClick={() => onTone(item)}>
              {toneLabels[item]}
            </button>
          ))}
        </div>

        <div className="actions-row">
          <button className="primary-action" disabled={isDrafting || draft.trim().length === 0} onClick={onSend}>
            <Send size={17} />
            Slack에 전송
            <kbd>⌘↵</kbd>
          </button>
          <button className="secondary-action" onClick={onHold}>보류</button>
        </div>
      </section>
      {toast && (
        <div className="toast">
          <Check size={15} />
          {toast}
          <button>실행 취소</button>
        </div>
      )}
      <StatusBar text={status} />
    </>
  );
}

function SentView({
  pendingCount,
  reply,
  seconds,
  onNext,
  onUndo
}: {
  pendingCount: number;
  reply: SentSlackReply;
  seconds: number;
  onNext: () => void;
  onUndo: () => void;
}) {
  return (
    <section className="body sent-body">
      <div className="success-mark">
        <Check size={34} />
      </div>
      <h1>전송 완료!</h1>
      <p>답장이 Slack에 전달되었어요.</p>

      <article className="recap-card">
        <header>
          <Avatar sender={{ name: reply.senderName, initials: reply.senderInitials, color: reply.senderColor }} size="small" />
          <strong>{reply.channel} · {reply.senderName}</strong>
        </header>
        <p>{reply.body}</p>
      </article>

      {seconds > 0 && (
        <div className="undo-area">
          <button onClick={onUndo}>
            <Undo2 size={15} />
            전송 취소
          </button>
          <span>· {seconds}초 후 확정</span>
          <div className="undo-progress" />
        </div>
      )}

      <button className="next-button" onClick={onNext}>다음 메시지로</button>
      <div className="remaining">답장 대기 <strong>{pendingCount}건</strong> 남음</div>
    </section>
  );
}

function SettingsView({
  settings,
  onBack,
  onCompleteUpdate,
  onSettings
}: {
  settings: SlackReplySettings;
  onBack: () => void;
  onCompleteUpdate: () => void;
  onSettings: (settings: SlackReplySettings) => void;
}) {
  function toggleChannel(id: string) {
    onSettings({
      ...settings,
      channels: settings.channels.map((channel) =>
        channel.id === id ? { ...channel, enabled: !channel.enabled } : channel
      )
    });
  }

  function toggleRule(id: string) {
    onSettings({
      ...settings,
      rules: settings.rules.map((rule) => (rule.id === id ? { ...rule, enabled: !rule.enabled } : rule))
    });
  }

  return (
    <section className="body settings-body">
      <button className="back-button settings-back" onClick={onBack}>
        <ChevronLeft size={17} />
        설정
      </button>

      <SettingsSection description="선택한 채널의 메시지만 감지합니다." title="감시할 채널">
        <div className="settings-card">
          {settings.channels.map((channel) => (
            <div className="settings-row" key={channel.id}>
              <span>{channel.label}</span>
              <button
                aria-pressed={channel.enabled}
                className={`switch ${channel.enabled ? "on" : ""}`}
                onClick={() => toggleChannel(channel.id)}
              >
                <span />
              </button>
            </div>
          ))}
          <button className="add-channel">
            <Plus size={14} />
            채널 추가
          </button>
        </div>
      </SettingsSection>

      <SettingsSection description="조건에 해당하는 메시지를 답장 대기로 모읍니다." title="감지 규칙">
        <div className="check-list">
          {settings.rules.map((rule) => (
            <button className="check-row" key={rule.id} onClick={() => toggleRule(rule.id)}>
              <span className={`checkbox ${rule.enabled ? "checked" : ""}`}>{rule.enabled && <Check size={15} />}</span>
              {rule.label}
            </button>
          ))}
        </div>
        <div className="keyword-box">
          {settings.keywords.map((keyword) => (
            <span className="keyword" key={keyword}>
              {keyword}
              <X size={13} />
            </span>
          ))}
          <button className="keyword add">추가</button>
        </div>
      </SettingsSection>

      <div className="inline-setting">
        <div>
          <strong>기본 톤</strong>
          <span>새 초안에 먼저 적용할 톤입니다.</span>
        </div>
        <div className="mini-segments">
          {tones.map((tone) => (
            <button
              className={settings.defaultTone === tone ? "active" : ""}
              key={tone}
              onClick={() => onSettings({ ...settings, defaultTone: tone })}
            >
              {toneLabels[tone]}
            </button>
          ))}
        </div>
      </div>

      <div className="inline-setting">
        <div>
          <strong>방해금지 시간</strong>
          <span>이 시간에는 알림을 묶어서 보여줍니다.</span>
        </div>
        <button className="quiet-hours">
          <Clock size={14} />
          {settings.quietHours}
        </button>
      </div>

      <section className={`software-card ${settings.updateStatus === "available" ? "available" : ""}`}>
        <div className="app-icon">S</div>
        <div>
          <strong>Slack 답장 도우미</strong>
          <span>{settings.version}</span>
          <small>{settings.updateStatus === "done" ? "최신 버전" : "업데이트 가능"}</small>
        </div>
        <button className="update-button" disabled={settings.updateStatus !== "available"} onClick={onCompleteUpdate}>
          {settings.updateStatus === "updating" && <RefreshCw className="spin" size={15} />}
          {settings.updateStatus === "updating" ? "업데이트 중..." : settings.updateStatus === "done" ? "최신 버전" : "지금 업데이트"}
        </button>
      </section>

      <div className="settings-links">
        <button>릴리즈 노트</button>
        <button>도움말</button>
        <button>Slack 연결 해제</button>
      </div>
    </section>
  );
}

function EmptyView({ status, onRefresh, onSettings }: { status: string; onRefresh: () => void; onSettings: () => void }) {
  return (
    <>
      <section className="body empty-body">
        <div className="tabs-row empty-tabs">
          <button className="tab active">대기중</button>
          <button className="tab">전송됨</button>
          <button className="icon-button" aria-label="설정" onClick={onSettings}>
            <Settings size={16} />
          </button>
        </div>
        <div className="radar" aria-hidden="true">
          <span className="radar-ring one" />
          <span className="radar-ring two" />
          <span className="radar-core">
            <Check size={23} />
          </span>
        </div>
        <h1>모두 답장했어요</h1>
        <p>지금 답장해야 할 메시지가 없어요.<br />새 메시지가 감지되면 여기에 표시됩니다.</p>
        <button className="refresh-button" onClick={onRefresh}>
          <RotateCcw size={16} />
          지금 새로고침
        </button>
      </section>
      <StatusBar text={status} blinking />
    </>
  );
}

function SettingsSection({ children, description, title }: { children: React.ReactNode; description: string; title: string }) {
  return (
    <section className="settings-section">
      <h2>{title}</h2>
      <p>{description}</p>
      {children}
    </section>
  );
}

function TagRow({ tags }: { tags: ReasonTag[] }) {
  return (
    <div className="tag-row">
      {tags.map((tag) => (
        <span className={`reason-tag reason-${tag}`} key={tag}>
          {reasonLabels[tag]}
        </span>
      ))}
    </div>
  );
}

function Avatar({
  sender,
  size = "default"
}: {
  sender: { initials: string; color: string; name: string };
  size?: "small" | "default" | "large";
}) {
  return (
    <span className={`avatar avatar-${size}`} style={{ backgroundColor: sender.color }} aria-label={sender.name}>
      {sender.initials}
    </span>
  );
}

function StatusBar({ blinking = false, text }: { blinking?: boolean; text: string }) {
  return (
    <footer className="status-bar">
      <span className={blinking ? "blink" : ""} />
      {text}
    </footer>
  );
}
