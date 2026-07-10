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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { priorityLabels, reasonLabels, toneLabels } from "../shared/slack";
import type {
  AiIntegrationStatus,
  PendingSlackMessage,
  ReasonTag,
  ReplyTone,
  SlackChannelOption,
  SentSlackReply,
  SlackReplySettings,
  SlackReplySnapshot
} from "../shared/slack";
import { slackReplyApi } from "./api";

type View = "inbox" | "reply" | "sent" | "sentList" | "settings" | "empty";
type InboxFilter = "all" | "mention" | "dm" | "question";
type DraftPreviewState = {
  body?: string;
  error?: string;
  isLoading: boolean;
};

const filterLabels: Record<InboxFilter, string> = {
  all: "전체",
  mention: "멘션",
  dm: "DM",
  question: "질문"
};

const tones: ReplyTone[] = ["formal", "default", "friendly", "short"];
const slackRefreshIntervalMs = 30000;

function statusText(count: number): string {
  return count > 0 ? `Slack 연결됨 · ${count}개 채널 감시 중 · 30초마다 확인` : "백그라운드에서 채널 확인 중...";
}

function draftPreviewKey(messageId: string, tone: ReplyTone): string {
  return `${messageId}:${tone}`;
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
  const [draftPreviews, setDraftPreviews] = useState<Record<string, DraftPreviewState>>({});
  const [quickSendingId, setQuickSendingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [lastReply, setLastReply] = useState<SentSlackReply | null>(null);
  const [undoSeconds, setUndoSeconds] = useState(5);
  const viewRef = useRef<View>("inbox");
  const refreshMessageTimerRef = useRef<number | null>(null);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const applySnapshot = useCallback((
    nextSnapshot: SlackReplySnapshot,
    options: { forceEmpty?: boolean; forceShowInbox?: boolean; syncDefaultTone?: boolean } = {}
  ) => {
    setSnapshot(nextSnapshot);
    if (options.syncDefaultTone) {
      setTone(nextSnapshot.settings.defaultTone);
    }
    setSelectedId((currentId) => {
      if (viewRef.current === "reply" && currentId) {
        return currentId;
      }
      if (currentId && nextSnapshot.pending.some((message) => message.id === currentId)) {
        return currentId;
      }
      return nextSnapshot.pending[0]?.id ?? null;
    });
    setView((currentView) => {
      if (nextSnapshot.pending.length > 0 && (currentView === "empty" || options.forceShowInbox)) {
        return "inbox";
      }
      if (nextSnapshot.pending.length === 0 && options.forceEmpty && currentView === "inbox") {
        return "empty";
      }
      return currentView;
    });
  }, []);

  const refreshSnapshot = useCallback(async (
    options: { forceEmpty?: boolean; forceShowInbox?: boolean; showActivity?: boolean; syncDefaultTone?: boolean } = {}
  ) => {
    if (options.showActivity) {
      if (refreshMessageTimerRef.current) {
        window.clearTimeout(refreshMessageTimerRef.current);
      }
      setIsRefreshing(true);
      setRefreshMessage("Slack 확인 중...");
    }

    try {
      const nextSnapshot = await slackReplyApi.getSnapshot();
      applySnapshot(nextSnapshot, options);
      if (options.showActivity) {
        setRefreshMessage(nextSnapshot.connected ? "방금 확인했어요." : "연결 상태를 확인했어요.");
      }
    } catch {
      if (options.showActivity) {
        setRefreshMessage("새로고침에 실패했어요. 잠시 후 다시 시도해 주세요.");
      }
    } finally {
      if (options.showActivity) {
        setIsRefreshing(false);
        refreshMessageTimerRef.current = window.setTimeout(() => {
          setRefreshMessage(null);
          refreshMessageTimerRef.current = null;
        }, 2600);
      }
    }
  }, [applySnapshot]);

  useEffect(() => {
    return () => {
      if (refreshMessageTimerRef.current) {
        window.clearTimeout(refreshMessageTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    void refreshSnapshot({ forceEmpty: true, syncDefaultTone: true });
  }, [refreshSnapshot]);

  const pending = snapshot?.pending ?? [];
  const settings = snapshot?.settings;
  const selectedMessage = view === "reply"
    ? pending.find((message) => message.id === selectedId) ?? null
    : pending.find((message) => message.id === selectedId) ?? pending[0] ?? null;
  const enabledChannelCount = settings?.channels.filter((channel) => channel.enabled).length ?? 0;

  useEffect(() => {
    if (!snapshot?.connected || view === "reply") {
      return;
    }

    const timer = window.setInterval(() => {
      void refreshSnapshot();
    }, slackRefreshIntervalMs);

    return () => window.clearInterval(timer);
  }, [refreshSnapshot, snapshot?.connected, view]);

  const filteredMessages = useMemo(() => {
    if (filter === "all") {
      return pending;
    }

    return pending.filter((message) => message.reasonTags.includes(filter));
  }, [filter, pending]);

  useEffect(() => {
    if (!settings || view !== "inbox") {
      return;
    }

    let alive = true;
    const previewMessages = filteredMessages.slice(0, 5);

    previewMessages.forEach((message) => {
      const key = draftPreviewKey(message.id, settings.defaultTone);
      const current = draftPreviews[key];
      if (current?.body || current?.isLoading || current?.error) {
        return;
      }

      setDraftPreviews((items) => ({
        ...items,
        [key]: { isLoading: true }
      }));

      void slackReplyApi.generateDraft({ messageId: message.id, tone: settings.defaultTone, variantIndex: 0 })
        .then((nextDraft) => {
          if (!alive) {
            return;
          }
          setDraftPreviews((items) => ({
            ...items,
            [key]: { body: nextDraft, isLoading: false }
          }));
        })
        .catch((error) => {
          if (!alive) {
            return;
          }
          setDraftPreviews((items) => ({
            ...items,
            [key]: {
              error: error instanceof Error ? error.message : "AI 초안 생성에 실패했습니다.",
              isLoading: false
            }
          }));
        });
    });

    return () => {
      alive = false;
    };
  }, [draftPreviews, filteredMessages, settings, view]);

  useEffect(() => {
    if (!selectedMessage || view !== "reply") {
      return;
    }

    const previewKey = draftPreviewKey(selectedMessage.id, tone);
    const preview = draftPreviews[previewKey];
    if (variantIndex === 0 && preview?.body) {
      setDraft(preview.body);
      setDraftError(null);
      setIsDrafting(false);
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
          if (variantIndex === 0) {
            setDraftPreviews((items) => ({
              ...items,
              [previewKey]: { body: nextDraft, isLoading: false }
            }));
          }
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
  }, [draftPreviews, selectedMessage, tone, variantIndex, view]);

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

  function openReply(message: PendingSlackMessage, initialDraft?: string) {
    setSelectedId(message.id);
    setVariantIndex(0);
    setTone(settings?.defaultTone ?? "default");
    if (initialDraft && settings) {
      setDraftPreviews((items) => ({
        ...items,
        [draftPreviewKey(message.id, settings.defaultTone)]: { body: initialDraft, isLoading: false }
      }));
      setDraft(initialDraft);
    }
    setView("reply");
  }

  async function sendReply() {
    if (!selectedMessage || draft.trim().length === 0) {
      return;
    }

    const reply = await slackReplyApi.sendReply({ messageId: selectedMessage.id, body: draft.trim() });
    const nextSnapshot = await slackReplyApi.getSnapshot();
    applySnapshot(nextSnapshot);
    setLastReply(reply);
    setToast(`${reply.channel} 에 전송했어요`);
    window.setTimeout(() => setToast(null), 3200);
    setView("sent");
  }

  async function sendPreviewReply(message: PendingSlackMessage, body: string) {
    const trimmedBody = body.trim();
    if (!trimmedBody) {
      return;
    }

    setQuickSendingId(message.id);
    try {
      const reply = await slackReplyApi.sendReply({ messageId: message.id, body: trimmedBody });
      const nextSnapshot = await slackReplyApi.getSnapshot();
      applySnapshot(nextSnapshot);
      setLastReply(reply);
      setToast(`${reply.channel} 에 전송했어요`);
      window.setTimeout(() => setToast(null), 3200);
      setView("sent");
    } finally {
      setQuickSendingId(null);
    }
  }

  async function undoSend() {
    if (!lastReply) {
      return;
    }

    const nextSnapshot = await slackReplyApi.undoSend(lastReply.id);
    applySnapshot(nextSnapshot);
    setSelectedId(lastReply.messageId);
    setLastReply(null);
    setView("reply");
  }

  async function clearAuth() {
    if (!window.confirm("Slack 연결을 해제하고 저장된 토큰을 삭제할까요?")) {
      return;
    }

    await slackReplyApi.clearAuth();
    setLastReply(null);
    setToast(null);
    await refreshSnapshot({ forceEmpty: true, forceShowInbox: true, syncDefaultTone: true });
    setView("inbox");
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
          savedClientId={snapshot.slackClientId}
          isRefreshing={isRefreshing}
          status={snapshot.connectionStatus}
          onRetry={() => {
            void refreshSnapshot({ forceEmpty: true, forceShowInbox: true, showActivity: true, syncDefaultTone: true });
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
          onOpenSent={() => setView("sentList")}
          onOpenSettings={() => setView("settings")}
          onQuickSend={(message, body) => void sendPreviewReply(message, body)}
          previewTone={settings.defaultTone}
          previews={draftPreviews}
          quickSendingId={quickSendingId}
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
          onUndoToast={() => void undoSend()}
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
      {view === "sentList" && (
        <SentListView
          pendingCount={pending.length}
          replies={snapshot.sent}
          status={statusText(enabledChannelCount)}
          onBack={() => setView(pending.length > 0 ? "inbox" : "empty")}
          onOpenSettings={() => setView("settings")}
        />
      )}
      {view === "settings" && (
        <SettingsView
          settings={settings}
          onBack={() => setView(pending.length > 0 ? "inbox" : "empty")}
          onClearAuth={() => void clearAuth()}
          onCompleteUpdate={() => void completeUpdate()}
          onSettings={(nextSettings) => void updateSettings(nextSettings)}
        />
      )}
      {view === "empty" && (
        <EmptyView
          status={statusText(enabledChannelCount)}
          isRefreshing={isRefreshing}
          sentCount={snapshot.sent.length}
          onOpenSent={() => setView("sentList")}
          onRefresh={() => void refreshSnapshot({ forceEmpty: true, forceShowInbox: true, showActivity: true })}
          onSettings={() => setView("settings")}
        />
      )}
      {refreshMessage && (
        <div className={`refresh-toast ${isRefreshing ? "refreshing" : ""}`}>
          <RefreshCw className={isRefreshing ? "spin" : ""} size={15} />
          {refreshMessage}
        </div>
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
  isRefreshing,
  onRetry,
  savedClientId,
  status
}: {
  errorMessage?: string;
  isRefreshing: boolean;
  onRetry: () => void;
  savedClientId?: string;
  status: "connected" | "missing_token" | "error";
}) {
  const [clientId, setClientId] = useState(savedClientId ?? "");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<"oauth" | "token" | "desktop" | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (savedClientId && !clientId) {
      setClientId(savedClientId);
    }
  }, [clientId, savedClientId]);

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

  async function importDesktopAuth() {
    setBusy("desktop");
    setLocalError(null);
    try {
      const result = await slackReplyApi.importDesktopAuth();
      if (!result.ok) {
        setLocalError(result.errorMessage ?? "Slack 앱 세션 가져오기에 실패했습니다.");
        return;
      }
      onRetry();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Slack 앱 세션 가져오기에 실패했습니다.");
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
          ? "기본은 공식 OAuth이고, 필요하면 설치된 Slack 앱 세션을 로컬에서 가져와 암호화 저장할 수 있습니다."
          : "Slack API에서 메시지를 불러오지 못했습니다."}
      </p>
      {(localError || errorMessage) && <div className="connection-error">{localError ?? errorMessage}</div>}
      <div className="connection-steps">
        <strong>OAuth 설정 체크리스트</strong>
        <p className="connection-note">Slack 데스크톱 앱 환경설정이 아니라 <b>api.slack.com/apps</b>의 개발자 앱 설정입니다. 최초 1회 연결 후에는 Client ID와 토큰을 로컬에 저장합니다.</p>
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
        <button className="secondary-action wide" disabled={busy === "desktop"} onClick={() => void importDesktopAuth()}>
          {busy === "desktop" ? "Slack 앱 세션 확인 중..." : "설치된 Slack 앱에서 가져오기"}
        </button>
        <p className="connection-note small">
          로컬 `slack-browse` 설정을 가져오거나, 가능한 경우 Slack Desktop에서 세션을 추출해 암호화 저장합니다.
        </p>
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
      <button className="refresh-button retry" disabled={isRefreshing} onClick={onRetry}>
        <RefreshCw className={isRefreshing ? "spin" : ""} size={16} />
        {isRefreshing ? "확인 중..." : "다시 확인"}
      </button>
    </section>
  );
}

function InboxView({
  filter,
  messages,
  pendingCount,
  previewTone,
  previews,
  quickSendingId,
  sentCount,
  status,
  onFilter,
  onOpenReply,
  onOpenSent,
  onOpenSettings,
  onQuickSend
}: {
  filter: InboxFilter;
  messages: PendingSlackMessage[];
  pendingCount: number;
  previewTone: ReplyTone;
  previews: Record<string, DraftPreviewState>;
  quickSendingId: string | null;
  sentCount: number;
  status: string;
  onFilter: (filter: InboxFilter) => void;
  onOpenReply: (message: PendingSlackMessage, initialDraft?: string) => void;
  onOpenSent: () => void;
  onOpenSettings: () => void;
  onQuickSend: (message: PendingSlackMessage, body: string) => void;
}) {
  return (
    <>
      <section className="body inbox-body">
        <div className="tabs-row">
          <button className="tab active">대기중 <span>{pendingCount}</span></button>
          <button className="tab" onClick={onOpenSent}>전송됨 <span className="muted-count">{sentCount}</span></button>
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
            <MessageCard
              key={message.id}
              message={message}
              preview={previews[draftPreviewKey(message.id, previewTone)]}
              quickSending={quickSendingId === message.id}
              onEdit={(draftBody) => onOpenReply(message, draftBody)}
              onOpen={() => onOpenReply(message)}
              onQuickSend={(draftBody) => onQuickSend(message, draftBody)}
            />
          ))}
          {messages.length === 0 && <div className="no-results">해당하는 메시지가 없어요.</div>}
        </div>
      </section>
      <StatusBar text={status} />
    </>
  );
}

function MessageCard({
  message,
  onEdit,
  onOpen,
  onQuickSend,
  preview,
  quickSending
}: {
  message: PendingSlackMessage;
  onEdit: (draftBody?: string) => void;
  onOpen: () => void;
  onQuickSend: (draftBody: string) => void;
  preview?: DraftPreviewState;
  quickSending: boolean;
}) {
  const draftBody = preview?.body?.trim() ?? "";

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
      <div className="inline-draft">
        <div className="inline-draft-head">
          <Sparkles size={14} />
          <strong>AI 답장 초안</strong>
          {preview?.isLoading && <span>작성 중...</span>}
        </div>
        {preview?.body && <p>{preview.body}</p>}
        {preview?.error && <p className="inline-draft-error">{preview.error}</p>}
        {!preview?.body && !preview?.isLoading && !preview?.error && <p className="inline-draft-muted">곧 초안이 표시됩니다.</p>}
      </div>
      <div className="card-foot">
        <span>{message.ageLabel}</span>
        <div className="card-actions">
          <button
            disabled={!draftBody || quickSending}
            onClick={(event) => {
              event.stopPropagation();
              onQuickSend(draftBody);
            }}
          >
            <Send size={14} />
            {quickSending ? "전송 중..." : "바로 전송"}
          </button>
          <button
            onClick={(event) => {
              event.stopPropagation();
              onEdit(draftBody || undefined);
            }}
          >
            수정
          </button>
        </div>
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
  onUndoToast,
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
  onUndoToast: () => void;
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
          <button onClick={onUndoToast}>실행 취소</button>
        </div>
      )}
      <StatusBar text={status} />
    </>
  );
}

function SentListView({
  pendingCount,
  replies,
  status,
  onBack,
  onOpenSettings
}: {
  pendingCount: number;
  replies: SentSlackReply[];
  status: string;
  onBack: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <>
      <section className="body sent-list-body">
        <div className="tabs-row">
          <button className="tab" onClick={onBack}>대기중 <span className="muted-count">{pendingCount}</span></button>
          <button className="tab active">전송됨 <span>{replies.length}</span></button>
          <button className="icon-button" aria-label="설정" onClick={onOpenSettings}>
            <Settings size={16} />
          </button>
        </div>
        <div className="sent-list">
          {replies.map((reply) => (
            <article className="recap-card sent-list-card" key={reply.id}>
              <header>
                <Avatar sender={{ name: reply.senderName, initials: reply.senderInitials, color: reply.senderColor }} size="small" />
                <strong>{reply.channel} · {reply.senderName}</strong>
                <span>{reply.sentAtLabel}</span>
              </header>
              <p>{reply.body}</p>
            </article>
          ))}
          {replies.length === 0 && <div className="no-results">아직 전송한 답장이 없어요.</div>}
        </div>
      </section>
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

function aiProviderLabel(provider: "claude" | "codex"): string {
  return provider === "claude" ? "Claude Code 사용 중" : "Codex 사용 중";
}

function aiPreferenceLabel(provider: "auto" | "claude" | "codex"): string {
  if (provider === "auto") {
    return "자동";
  }
  return provider === "claude" ? "Claude" : "Codex";
}

function SettingsView({
  settings,
  onBack,
  onClearAuth,
  onCompleteUpdate,
  onSettings
}: {
  settings: SlackReplySettings;
  onBack: () => void;
  onClearAuth: () => void;
  onCompleteUpdate: () => void;
  onSettings: (settings: SlackReplySettings) => void;
}) {
  const [showChannelPicker, setShowChannelPicker] = useState(false);
  const [channelQuery, setChannelQuery] = useState("");
  const [remoteChannelCandidates, setRemoteChannelCandidates] = useState<SlackChannelOption[]>([]);
  const [isSearchingChannels, setIsSearchingChannels] = useState(false);
  const [channelSearchError, setChannelSearchError] = useState<string | null>(null);
  const [keywordDraft, setKeywordDraft] = useState("");
  const [showKeywordInput, setShowKeywordInput] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiIntegrationStatus | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void slackReplyApi.getAiIntegrationStatus().then((status) => {
      if (alive) {
        setAiStatus(status);
      }
    });
    return () => {
      alive = false;
    };
  }, [settings.aiIntegration.providerPreference]);

  useEffect(() => {
    const query = channelQuery.trim();
    if (!showChannelPicker || query.length < 2) {
      setRemoteChannelCandidates([]);
      setIsSearchingChannels(false);
      setChannelSearchError(null);
      return;
    }

    let alive = true;
    const timer = window.setTimeout(() => {
      setIsSearchingChannels(true);
      setChannelSearchError(null);
      void slackReplyApi.searchChannels(query)
        .then((channels) => {
          if (alive) {
            setRemoteChannelCandidates(channels);
          }
        })
        .catch((error) => {
          if (alive) {
            setChannelSearchError(error instanceof Error ? error.message : "Slack 채널 검색에 실패했습니다.");
          }
        })
        .finally(() => {
          if (alive) {
            setIsSearchingChannels(false);
          }
        });
    }, 320);

    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [channelQuery, showChannelPicker]);

  const selectedChannelIds = new Set(settings.channels.map((channel) => channel.id));
  const normalizedChannelQuery = channelQuery.trim().toLowerCase();
  const channelCandidateMap = new Map(
    [...settings.availableChannels, ...remoteChannelCandidates].map((channel) => [channel.id, channel])
  );
  const channelCandidates = Array.from(channelCandidateMap.values())
    .filter((channel) => !selectedChannelIds.has(channel.id))
    .filter((channel) => channel.label.toLowerCase().includes(normalizedChannelQuery));

  function toggleChannel(id: string) {
    onSettings({
      ...settings,
      channels: settings.channels.filter((channel) => channel.id !== id)
    });
  }

  function addChannel(channel: SlackChannelOption) {
    onSettings({
      ...settings,
      channels: [...settings.channels, { ...channel, enabled: true }]
    });
    setChannelQuery("");
    setShowChannelPicker(false);
  }

  function addKeyword() {
    const nextKeyword = keywordDraft.trim();
    if (!nextKeyword || settings.keywords.includes(nextKeyword)) {
      return;
    }

    onSettings({
      ...settings,
      keywords: [...settings.keywords, nextKeyword]
    });
    setKeywordDraft("");
    setShowKeywordInput(false);
  }

  function removeKeyword(keyword: string) {
    onSettings({
      ...settings,
      keywords: settings.keywords.filter((item) => item !== keyword)
    });
  }

  function editQuietHours() {
    const nextQuietHours = window.prompt("방해금지 시간을 입력하세요.", settings.quietHours);
    const trimmed = nextQuietHours?.trim();
    if (!trimmed) {
      return;
    }

    onSettings({
      ...settings,
      quietHours: trimmed
    });
  }

  function openExternal(url: string) {
    void slackReplyApi.openExternal(url);
  }

  async function testAiIntegration() {
    setAiBusy(true);
    try {
      setAiStatus(await slackReplyApi.testAiIntegration());
    } finally {
      setAiBusy(false);
    }
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
          <button className="add-channel" onClick={() => setShowChannelPicker((open) => !open)}>
            <Plus size={14} />
            {showChannelPicker ? "채널 추가 닫기" : "채널 추가"}
          </button>
          {showChannelPicker && (
            <div className="channel-picker">
              <input
                aria-label="채널 검색"
                placeholder="채널명 검색"
                value={channelQuery}
                onChange={(event) => setChannelQuery(event.target.value)}
              />
              <div className="channel-picker-list">
                {channelCandidates.slice(0, 24).map((channel) => (
                  <button key={channel.id} onClick={() => addChannel(channel)}>
                    <span>{channel.label}</span>
                    <Plus size={14} />
                  </button>
                ))}
                {isSearchingChannels && (
                  <div className="picker-empty searching">
                    <RefreshCw className="spin" size={14} />
                    Slack에서 더 찾는 중...
                  </div>
                )}
                {!isSearchingChannels && channelSearchError && <div className="picker-empty">{channelSearchError}</div>}
                {!isSearchingChannels && !channelSearchError && channelCandidates.length === 0 && (
                  <div className="picker-empty">추가할 채널이 없어요.</div>
                )}
              </div>
            </div>
          )}
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
            <button className="keyword" key={keyword} onClick={() => removeKeyword(keyword)}>
              {keyword}
              <X size={13} />
            </button>
          ))}
          {showKeywordInput && (
            <input
              className="keyword-input"
              placeholder="키워드"
              value={keywordDraft}
              onChange={(event) => setKeywordDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  addKeyword();
                }
                if (event.key === "Escape") {
                  setShowKeywordInput(false);
                  setKeywordDraft("");
                }
              }}
            />
          )}
          <button
            className="keyword add"
            onClick={() => {
              if (showKeywordInput) {
                addKeyword();
                return;
              }
              setShowKeywordInput(true);
            }}
          >
            추가
          </button>
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

      <SettingsSection description="로컬 CLI를 사용해 Slack 답장 초안을 생성합니다." title="AI 연동">
        <div className="ai-card">
          <div className="ai-status-row">
            <div>
              <strong>{aiStatus?.activeProvider ? aiProviderLabel(aiStatus.activeProvider) : "사용 가능한 AI 없음"}</strong>
              <span>
                Claude Code {aiStatus?.claudeAvailable ? "연결됨" : "없음"} · Codex {aiStatus?.codexAvailable ? "연결됨" : "없음"}
              </span>
            </div>
            <button className="secondary-action small" disabled={aiBusy} onClick={() => void testAiIntegration()}>
              {aiBusy ? "확인 중..." : "연동 테스트"}
            </button>
          </div>
          <div className="mini-segments ai-provider">
            {(["auto", "claude", "codex"] as const).map((provider) => (
              <button
                className={settings.aiIntegration.providerPreference === provider ? "active" : ""}
                key={provider}
                onClick={() =>
                  onSettings({
                    ...settings,
                    aiIntegration: { providerPreference: provider }
                  })
                }
              >
                {aiPreferenceLabel(provider)}
              </button>
            ))}
          </div>
          {aiStatus?.errorMessage && <div className="ai-error">{aiStatus.errorMessage}</div>}
        </div>
      </SettingsSection>

      <div className="inline-setting">
        <div>
          <strong>방해금지 시간</strong>
          <span>이 시간에는 알림을 묶어서 보여줍니다.</span>
        </div>
        <button className="quiet-hours" onClick={editQuietHours}>
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
        <button onClick={() => openExternal("https://github.com/gr8woo/slack-ai-reply-helper/releases")}>릴리즈 노트</button>
        <button onClick={() => openExternal("https://github.com/gr8woo/slack-ai-reply-helper#readme")}>도움말</button>
        <button className="danger-link" onClick={onClearAuth}>Slack 연결 해제</button>
      </div>
    </section>
  );
}

function EmptyView({
  isRefreshing,
  status,
  sentCount,
  onOpenSent,
  onRefresh,
  onSettings
}: {
  isRefreshing: boolean;
  status: string;
  sentCount: number;
  onOpenSent: () => void;
  onRefresh: () => void;
  onSettings: () => void;
}) {
  return (
    <>
      <section className="body empty-body">
        <div className="tabs-row empty-tabs">
          <button className="tab active">대기중</button>
          <button className="tab" onClick={onOpenSent}>전송됨 <span className="muted-count">{sentCount}</span></button>
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
        <button className="refresh-button" disabled={isRefreshing} onClick={onRefresh}>
          {isRefreshing ? <RefreshCw className="spin" size={16} /> : <RotateCcw size={16} />}
          {isRefreshing ? "확인 중..." : "지금 새로고침"}
        </button>
      </section>
      <StatusBar text={isRefreshing ? "Slack 확인 중..." : status} blinking />
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
