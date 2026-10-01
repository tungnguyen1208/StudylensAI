import React, { useEffect, useRef, useState } from 'react';
import {
  AssessmentHistoryApi,
  AssessmentPanel,
  GradeResult,
  HistoryPage,
  type GradeView,
  type HistoryEntryReadModel,
  type LocalAnswerSubmission,
  type QuizAttemptView,
  type QuizAvailable,
} from '../features/assessment-history';
import type { LearningPackage, ProcessingOperation } from '../features/session-quiz/models/session-quiz-contracts';
import {
  ActivationToggle,
  DEFAULT_LEARNING_PREFERENCES,
  LearningPreferencesForm,
  TranscriptPreview,
  applyVideoActivationMessage,
  initialActivationState,
  isLearningPreferences,
  type ActivationState,
  type LearningPreferences,
} from '../features/video-activation';
import { httpClient } from '../shared/http/http-client';
import { messageBus } from '../shared/messaging/message-bus';
import type { ExtensionMessage } from '../shared/messaging/message-types';
import { isOperationStatusMessage, type OperationStatusPayload, type StudyLensOperation } from '../shared/messaging/operation-status';

interface BackendHealthResponse {
  status: string;
  service: string;
  aiService?: { status: string; service: string };
}

type BackendStatus = 'idle' | 'checking' | 'connected' | 'error';
type SidePanelTab = 'study' | 'history' | 'settings';
type ActiveYoutubeContext = NonNullable<ActivationState['context']>;
type LocalTranscript = {
  status: 'available' | 'unavailable' | 'insufficient';
  language: string;
  cues: Array<{ startMs: number; endMs: number; text: string }>;
};

const assessmentHistoryApi = new AssessmentHistoryApi();

export const App: React.FC = () => {
  const [backendStatus, setBackendStatus] = useState<BackendStatus>('idle');
  const [backendData, setBackendData] = useState<BackendHealthResponse | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [activationState, setActivationState] = useState<ActivationState>(initialActivationState);
  const [activationCommandStatus, setActivationCommandStatus] = useState<'idle' | 'sending' | 'error'>('idle');
  const [activationCommandError, setActivationCommandError] = useState<string | null>(null);
  const [activationCommandNotice, setActivationCommandNotice] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SidePanelTab>('study');
  const [learningPackage, setLearningPackage] = useState<LearningPackage | null>(null);
  const [learningPackageError, setLearningPackageError] = useState<string | null>(null);
  const [localTranscript, setLocalTranscript] = useState<LocalTranscript | null>(null);
  const [quiz, setQuiz] = useState<QuizAvailable | null>(null);
  const [quizStarted, setQuizStarted] = useState(false);
  const [playerTimeMs, setPlayerTimeMs] = useState<number | null>(null);
  const [seekError, setSeekError] = useState<string | null>(null);
  const [latestGrade, setLatestGrade] = useState<GradeView | null>(null);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntryReadModel[]>([]);
  const [historyStatus, setHistoryStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [operationStatuses, setOperationStatuses] = useState<Partial<Record<StudyLensOperation, OperationStatusPayload>>>({});
  const [learningPreferences, setLearningPreferences] = useState<LearningPreferences>(DEFAULT_LEARNING_PREFERENCES);
  const [preferencesStatus, setPreferencesStatus] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading');
  const [preferencesError, setPreferencesError] = useState<string | null>(null);
  const activeVideoContextRef = useRef<ActiveYoutubeContext | null>(null);
  const videoStateVersionRef = useRef(0);
  const contextRequestSerialRef = useRef(0);

  const resetVideoScopedPanelState = () => {
    videoStateVersionRef.current += 1;
    setLearningPackage(null);
    setLearningPackageError(null);
    setLocalTranscript(null);
    setQuiz(null);
    setQuizStarted(false);
    setPlayerTimeMs(null);
    setSeekError(null);
    setLatestGrade(null);
    setOperationStatuses({});
  };

  const presentVideoContext = (context: ActiveYoutubeContext) => {
    const previous = activeVideoContextRef.current;
    const changed = previous?.tabId !== context.tabId || previous.youtubeVideoId !== context.youtubeVideoId;
    activeVideoContextRef.current = context;
    if (changed) resetVideoScopedPanelState();
    setActivationState((state) => ({ ...state, context }));
  };

  const refreshActiveYoutubeContext = async () => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
    const requestSerial = ++contextRequestSerialRef.current;
    const expectedVersion = videoStateVersionRef.current;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'STUDYLENS_GET_ACTIVE_YOUTUBE_CONTEXT' }) as {
        ok?: unknown; context?: unknown; localTranscript?: unknown;
      } | undefined;
      if (requestSerial !== contextRequestSerialRef.current || expectedVersion !== videoStateVersionRef.current ||
        response?.ok !== true || !isActiveYoutubeContext(response.context)) return;
      presentVideoContext(response.context);
      if (isLocalTranscript(response.localTranscript)) setLocalTranscript(response.localTranscript);
    } catch {
      // A missing content script must not close or break the Side Panel.
    }
  };

  const refreshLearningPackage = async () => {
    const expected = activeVideoContextRef.current;
    if (!expected) return;
    const expectedVersion = videoStateVersionRef.current;
    try {
      const next = await getActiveLearningPackage();
      const current = activeVideoContextRef.current;
      if (!next || !current || expectedVersion !== videoStateVersionRef.current || current.tabId !== expected.tabId ||
        current.youtubeVideoId !== expected.youtubeVideoId || next.session.youtubeVideoId !== current.youtubeVideoId) return;
      setLearningPackage(next);
      setLearningPackageError(null);
      if (next.quizStatus === 'ready' && next.quiz) {
        setQuiz(next.quiz);
      } else {
        setQuiz(null);
        setQuizStarted(false);
      }
    } catch (error: unknown) {
      if (activeVideoContextRef.current?.youtubeVideoId === expected.youtubeVideoId) {
        setLearningPackageError(error instanceof Error ? error.message : 'Không thể tải trạng thái phiên học.');
      }
    }
  };

  useEffect(() => {
    void checkHealth();
    void refreshActiveYoutubeContext();
    const contextTimer = window.setInterval(() => void refreshActiveYoutubeContext(), 1_000);
    return () => window.clearInterval(contextTimer);
  }, []);

  useEffect(() => {
    const context = activationState.context;
    if (!context || activationState.status !== 'active') {
      setLearningPackage(null);
      return;
    }
    let disposed = false;
    const refresh = async () => {
      if (!disposed) await refreshLearningPackage();
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [activationState.context?.tabId, activationState.context?.youtubeVideoId, activationState.status]);

  const transcriptDetails = learningPackage?.transcript.status === 'ready' && learningPackage.transcript.cues.length > 0
    ? { cues: learningPackage.transcript.cues }
    : localTranscript?.status === 'available'
      ? { cues: localTranscript.cues }
      : null;

  useEffect(() => {
    const context = activationState.context;
    if (!context || !transcriptDetails) {
      setPlayerTimeMs(null);
      return;
    }
    let disposed = false;
    const refresh = async () => {
      const result = await getActivePlayerTime();
      if (!disposed && result?.youtubeVideoId === context.youtubeVideoId) setPlayerTimeMs(result.currentTimeMs);
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 750);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [activationState.context?.youtubeVideoId, Boolean(transcriptDetails)]);

  useEffect(() => {
    let mounted = true;
    void getLearningPreferences().then(
      (preferences) => { if (mounted) { setLearningPreferences(preferences); setPreferencesStatus('ready'); } },
      (error: unknown) => { if (mounted) { setPreferencesStatus('error'); setPreferencesError(messageOf(error, 'Không thể tải tùy chọn học tập.')); } },
    );
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const onActivationMessage = (message: ExtensionMessage) => {
      const activeContext = activeVideoContextRef.current;
      if (activeContext && message.tabId !== activeContext.tabId) return;
      const context = contextFromVideoActivationMessage(message);
      if (context) presentVideoContext(context);
      if (message.type === 'VIDEO_CONTEXT_UNAVAILABLE') {
        activeVideoContextRef.current = null;
        resetVideoScopedPanelState();
      }
      setActivationState((state) => applyVideoActivationMessage(state, message));
    };
    const unsubscribers = [
      messageBus.subscribe('ACTIVATION_ENABLED', onActivationMessage),
      messageBus.subscribe('ACTIVATION_DISABLED', onActivationMessage),
      messageBus.subscribe('VIDEO_CONTEXT_CHANGED', onActivationMessage),
      messageBus.subscribe('VIDEO_CONTEXT_UNAVAILABLE', onActivationMessage),
      messageBus.subscribe('OPERATION_STATUS_CHANGED', (message) => {
        if (!isOperationStatusMessage(message) || !belongsToActiveVideo(message, activeVideoContextRef.current)) return;
        setOperationStatuses((statuses) => ({ ...statuses, [message.payload.operation]: message.payload }));
      }),
    ];
    void loadPersistentActivationState().then((enabled) => {
      if (enabled) setActivationState((state) => ({ ...state, status: 'active', errorCode: null }));
    });
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, []);

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return;
    const listener = (message: unknown) => {
      const type = (message as { type?: unknown })?.type;
      if (type === 'STUDYLENS_ACTIVE_TAB_CHANGED' || type === 'STUDYLENS_ACTIVE_YOUTUBE_CONTEXT_CHANGED') {
        void refreshActiveYoutubeContext();
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const checkHealth = async () => {
    setBackendStatus('checking');
    setBackendError(null);
    try {
      setBackendData(await httpClient.get<BackendHealthResponse>('api/health'));
      setBackendStatus('connected');
    } catch (error: unknown) {
      setBackendStatus('error');
      setBackendError(messageOf(error, 'Không thể kết nối tới StudyLens API.'));
    }
  };

  const submitAssessmentAttempt = async (submissions: LocalAnswerSubmission[], clientAttemptId: string): Promise<QuizAttemptView> => {
    if (!quiz) throw new Error('quizUnavailable');
    return assessmentHistoryApi.submitAttempt(quiz, submissions, clientAttemptId);
  };

  const handleAttempt = (attempt: QuizAttemptView) => {
    const first = attempt.results[0];
    if (first) {
      setLatestGrade({
        answerAttemptId: attempt.quizAttemptId,
        questionId: first.questionId,
        outcome: first.outcome,
        score: first.score,
        referenceAnswer: first.referenceAnswer,
        explanation: first.explanation,
        source: first.source,
        gradedAtUtc: attempt.submittedAtUtc,
      });
    }
    void refreshHistoryTab();
  };

  const seekToTranscriptCue = async (timestampMs: number) => {
    const context = activationState.context;
    if (!context) return;
    setSeekError(null);
    const result = await seekActivePlayer(context.youtubeVideoId, timestampMs);
    if (!result.ok) setSeekError(`Không thể tua video đến mốc đã chọn (${result.code ?? 'seekFailed'}).`);
  };

  const refreshHistoryTab = async () => {
    setHistoryStatus('loading');
    setHistoryError(null);
    try {
      setHistoryEntries(await assessmentHistoryApi.getHistory());
      setHistoryStatus('ready');
    } catch (error: unknown) {
      setHistoryStatus('error');
      setHistoryError(messageOf(error, 'Không thể tải lịch sử học tập.'));
    }
  };

  const retryOperation = async (operation: StudyLensOperation | ProcessingOperation) => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
    const response = await chrome.runtime.sendMessage({ type: 'STUDYLENS_RETRY_OPERATION', operation }) as { ok?: boolean; code?: string } | undefined;
    if (!response?.ok) setLearningPackageError(response?.code ?? 'retryFailed');
    else void refreshLearningPackage();
  };

  const requestManualActivation = async (requestedState: 'on' | 'off') => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      setActivationCommandStatus('error');
      setActivationCommandError('Không thể kết nối tới Extension Runtime.');
      return;
    }
    setActivationCommandStatus('sending');
    setActivationCommandError(null);
    setActivationCommandNotice(null);
    try {
      const response = await chrome.runtime.sendMessage({ type: 'STUDYLENS_MANUAL_TOGGLE', requestedState }) as {
        ok?: boolean; code?: string; pendingPageCapture?: boolean;
      } | undefined;
      if (!response?.ok) throw new Error(response?.code ?? 'manualActivationUnavailable');
      setActivationState((state) => ({ ...state, status: requestedState === 'on' ? 'active' : 'off', errorCode: null }));
      if (requestedState === 'off') resetVideoScopedPanelState();
      if (requestedState === 'on' && response.pendingPageCapture) {
        setActivationCommandNotice('StudyLens đã bật. Hãy mở hoặc tải lại trang YouTube /watch để bắt đầu.');
      }
      void refreshActiveYoutubeContext();
      setActivationCommandStatus('idle');
    } catch (error: unknown) {
      setActivationCommandStatus('error');
      setActivationCommandError(messageOf(error, 'Không thể cập nhật trạng thái StudyLens.'));
    }
  };

  const saveLearningPreferences = async (preferences: LearningPreferences) => {
    setPreferencesStatus('saving');
    setPreferencesError(null);
    try {
      setLearningPreferences(await persistLearningPreferences(preferences));
      setPreferencesStatus('ready');
    } catch (error: unknown) {
      setPreferencesStatus('error');
      setPreferencesError(messageOf(error, 'Không thể lưu tùy chọn học tập.'));
    }
  };

  const transcriptStatusText = learningPackage?.transcript.status === 'ready'
    ? `Backend đã xác thực · nguồn ${learningPackage.transcript.source === 'geminiVideo' ? 'Gemini video' : 'YouTube captions'}.`
    : localTranscript?.status === 'available'
      ? 'Bản xem trước từ YouTube; StudyLens đang thu thập hoặc Backend đang xác thực transcript đầy đủ.'
      : transcriptStatusLabel(learningPackage?.transcript.status);

  return (
    <main className="studylens-app">
      <header className="app-header">
        <div><h1 className="app-title">StudyLens</h1><p className="app-subtitle">Tập trung vào nội dung video</p></div>
        <nav className="panel-tabs" aria-label="Điều hướng StudyLens" role="tablist">
          {(['study', 'history', 'settings'] as const).map((tab) => (
            <button key={tab} type="button" className={`panel-tab ${activeTab === tab ? 'panel-tab--active' : ''}`} role="tab" aria-selected={activeTab === tab} onClick={() => { setActiveTab(tab); if (tab === 'history') void refreshHistoryTab(); }}>
              {{ study: 'Học tập', history: 'Lịch sử', settings: 'Cài đặt' }[tab]}
            </button>
          ))}
        </nav>
      </header>

      {activeTab === 'study' ? (
        <div id="study-panel" role="tabpanel">
          <section className="learning-hero">
            <div className="learning-hero__play" aria-hidden="true"><span /></div>
            <div className="learning-hero__content">
              <h2>Bài giảng: {activationState.context?.title ?? 'Chưa mở video YouTube hợp lệ'}</h2>
              <p>{learningPackage ? `YouTube · Phiên ${sessionStatusLabel(learningPackage.session.status)}` : 'Mở trang YouTube /watch để bắt đầu.'}</p>
            </div>
          </section>

          <ProcessingProgressCard activationState={activationState} learningPackage={learningPackage} />

          <section className="panel-section" aria-labelledby="transcript-preview-heading">
            <TranscriptPreview
              details={transcriptDetails}
              loading={activationState.status === 'active' && !transcriptDetails && !learningPackageError}
              error={learningPackageError}
              currentTimeMs={playerTimeMs}
              statusText={transcriptStatusText}
              onRefresh={() => { void refreshActiveYoutubeContext(); void refreshLearningPackage(); }}
              onSeek={(timestampMs) => void seekToTranscriptCue(timestampMs)}
            />
            {seekError ? <p className="health-error" role="alert">{seekError}</p> : null}
          </section>

          <section className="panel-section" aria-labelledby="operations-heading">
            <h2 id="operations-heading" className="section-heading">Trạng thái xử lý</h2>
            <ProcessingStages learningPackage={learningPackage} />
            <p className="section-copy">{learningStateSummary(activationState, learningPackage)}</p>
            {learningPackage?.error ? (
              <div className="operation-status operation-status--failed">
                <strong>{operationLabel(learningPackage.error.operation)}</strong>
                <span>{learningPackage.error.code === 'providerRateLimited'
                  ? 'Gemini đã chạm giới hạn yêu cầu. Hãy thử lại sau khi quota được làm mới.'
                  : learningPackage.error.message}</span>
                <small>Mã: {learningPackage.error.code}</small>
                {learningPackage.error.retryable ? <button type="button" className="operation-status__retry" onClick={() => void retryOperation(learningPackage.error!.operation)}>{learningPackage.error.code === 'providerRateLimited' ? 'Thử lại sau' : 'Thử lại bước này'}</button> : null}
              </div>
            ) : null}
            <OperationStatusList statuses={operationStatuses} onRetry={retryOperation} />
          </section>

          {quiz ? (
            <section className="quiz-ready-card" aria-labelledby="quiz-ready-heading">
              {!quizStarted ? (
                <>
                  <div className="quiz-ready-card__badge">ĐÃ SẴN SÀNG</div>
                  <h2 id="quiz-ready-heading">Quiz toàn video đã sẵn sàng</h2>
                  <p>{quiz.questions.length} câu hỏi được tạo từ transcript toàn video đã xác thực.</p>
                  <button type="button" className="primary-button" onClick={() => setQuizStarted(true)}>Bắt đầu làm quiz</button>
                </>
              ) : (
                <>
                  <div className="section-heading-row"><h2 id="quiz-ready-heading" className="section-heading">Bài kiểm tra</h2><button type="button" className="secondary-button" onClick={() => setQuizStarted(false)}>Thu gọn</button></div>
                  <AssessmentPanel quiz={quiz} submitAttempt={submitAssessmentAttempt} onOperationStatus={(status) => setOperationStatuses((current) => ({ ...current, [status.operation]: status }))} onAttempt={handleAttempt} onSeekEvidence={(timestampMs) => void seekToTranscriptCue(timestampMs)} />
                </>
              )}
            </section>
          ) : null}
        </div>
      ) : activeTab === 'history' ? (
        <div id="history-panel" role="tabpanel" className="history-view">
          <section className="panel-section"><h2 className="section-heading">Kết quả gần nhất</h2>{latestGrade ? <GradeResult grade={latestGrade} /> : <p className="section-copy">Chưa có kết quả chấm điểm.</p>}</section>
          <section className="panel-section">
            <div className="section-heading-row"><h2 className="section-heading">Lịch sử học tập</h2><button type="button" className="secondary-button" onClick={() => void refreshHistoryTab()} disabled={historyStatus === 'loading'}>{historyStatus === 'loading' ? 'Đang tải…' : 'Làm mới'}</button></div>
            {historyError ? <p className="health-error" role="alert">{historyError}</p> : <HistoryPage entries={historyEntries} />}
          </section>
        </div>
      ) : (
        <div id="settings-panel" role="tabpanel" className="settings-view">
          <header className="settings-intro"><h2>Cài đặt học tập</h2><p>Điều chỉnh một lần, áp dụng cho các phiên video tiếp theo.</p></header>
          <section className="panel-section">
            <div className="setting-toggle-row"><div><h2 className="section-heading">StudyLens đang {activationState.status === 'active' ? 'bật' : 'tắt'}</h2><p className="section-copy">Giữ trạng thái này khi chuyển video hoặc khởi động lại trình duyệt.</p></div><ActivationToggle active={activationState.status === 'active'} disabled={activationCommandStatus === 'sending'} onRequest={requestManualActivation} /></div>
            {activationCommandError ? <p className="health-error" role="alert">{activationCommandError}</p> : null}
            {activationCommandNotice ? <p className="section-copy section-copy--warning">{activationCommandNotice}</p> : null}
          </section>
          <section className="panel-section"><h2 className="section-heading">Cấu hình quiz toàn video</h2>{preferencesStatus === 'loading' ? <p className="section-copy">Đang tải…</p> : <LearningPreferencesForm preferences={learningPreferences} saving={preferencesStatus === 'saving'} error={preferencesError} onSave={saveLearningPreferences} />}</section>
          <section className="panel-section"><h2 className="section-heading">Nguồn transcript</h2><p className="section-copy"><strong>YouTube captions</strong> · captionTracks → Timedtext JSON3/XML → DOM fallback.</p><p className="learning-preferences__hint">Nếu phụ đề không khả dụng, Backend mới yêu cầu AI Service xử lý video công khai. Extension không chứa khóa Gemini.</p></section>
          <section className="panel-section">
            <div className="section-heading-row"><h2 className="section-heading">Kết nối & chẩn đoán</h2><span className={`health-badge health-badge--${backendStatus}`}>{healthStatusLabel(backendStatus)}</span></div>
            <div className="health-service"><div>Backend: {backendData?.service ?? 'Chưa kiểm tra'}</div>{backendData?.aiService ? <div>AI: {backendData.aiService.status}</div> : null}<div>Video: {activationState.context?.youtubeVideoId ?? 'chưa có'}</div></div>
            {backendError ? <p className="health-error" role="alert">{backendError}</p> : null}
            <button type="button" className="secondary-button" onClick={() => void checkHealth()} disabled={backendStatus === 'checking'}>{backendStatus === 'checking' ? 'Đang kiểm tra…' : 'Kiểm tra Backend'}</button>
          </section>
        </div>
      )}
    </main>
  );
};

function ProcessingProgressCard({ activationState, learningPackage }: { activationState: ActivationState; learningPackage: LearningPackage | null }) {
  const progress = processingPercent(activationState, learningPackage);
  return (
    <section className="panel-section study-cycle">
      <div className="section-heading-row"><h2 className="section-heading">Tiến độ xử lý</h2><strong>{progress}%</strong></div>
      <div className="study-cycle__track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></div>
      <p className="section-copy">{learningStateSummary(activationState, learningPackage)}</p>
    </section>
  );
}

function ProcessingStages({ learningPackage }: { learningPackage: LearningPackage | null }) {
  const transcriptReady = learningPackage?.transcript.status === 'ready';
  const quizReady = learningPackage?.quizStatus === 'ready';
  return (
    <div className="processing-stages" aria-label="Tiến trình tạo quiz">
      <span className={transcriptReady ? 'processing-stage processing-stage--done' : 'processing-stage processing-stage--active'}>{transcriptReady ? '✓ Transcript đã sẵn sàng' : '1 · Đang xử lý transcript'}</span>
      <span className={quizReady ? 'processing-stage processing-stage--done' : learningPackage?.quizStatus === 'generating' || learningPackage?.quizStatus === 'queued' ? 'processing-stage processing-stage--active' : 'processing-stage'}>{quizReady ? '✓ Quiz đã sẵn sàng' : '2 · Tạo quiz →'}</span>
    </div>
  );
}

function OperationStatusList({ statuses, onRetry }: { statuses: Partial<Record<StudyLensOperation, OperationStatusPayload>>; onRetry: (operation: StudyLensOperation) => Promise<void> }) {
  const values = Object.values(statuses).filter(Boolean) as OperationStatusPayload[];
  if (values.length === 0) return null;
  return <div className="operation-status-list">{values.map((status) => <div className={`operation-status operation-status--${status.state}`} key={status.operation}><strong>{operationLabel(status.operation)}</strong><span>{status.message}</span>{status.code ? <small>Mã: {status.code}{status.traceId ? ` · Trace: ${status.traceId}` : ''}</small> : null}{status.state === 'failed' && status.retryable ? <button type="button" className="operation-status__retry" onClick={() => void onRetry(status.operation)}>Thử lại</button> : null}</div>)}</div>;
}

function operationLabel(operation: StudyLensOperation | ProcessingOperation): string {
  return { transcriptUpload: 'Gửi transcript', transcriptGenerate: 'Tạo transcript dự phòng', sessionStart: 'Tạo phiên học', quizGenerate: 'Tạo quiz', answerSubmit: 'Nộp bài', historyLoad: 'Lịch sử' }[operation];
}

function processingPercent(state: ActivationState, value: LearningPackage | null): number {
  if (state.status !== 'active' || !state.context) return 0;
  if (!value) return 15;
  if (value.quizStatus === 'ready') return 100;
  if (value.quizStatus === 'generating' || value.quizStatus === 'queued') return 75;
  if (value.transcript.status === 'ready') return 55;
  if (value.transcript.status === 'generating' || value.transcript.status === 'validating') return 35;
  return 20;
}

function learningStateSummary(state: ActivationState, value: LearningPackage | null): string {
  if (!state.context) return 'Chưa mở video YouTube hợp lệ.';
  if (state.status !== 'active') return 'StudyLens đang tắt. Bật lại trong Cài đặt để bắt đầu.';
  if (!value) return 'Đang tạo phiên học và thu thập transcript toàn video.';
  if (value.transcript.status === 'generating') return 'AI Service đang tạo transcript dự phòng từ video công khai.';
  if (value.transcript.status === 'unavailable') return 'Transcript không khả dụng cho video này.';
  if (value.transcript.status === 'failed') return 'Bước tạo transcript đã thất bại. Có thể thử lại đúng bước.';
  if (value.quizStatus === 'queued') return 'Transcript đã xác thực; yêu cầu tạo quiz đang chờ xử lý.';
  if (value.quizStatus === 'generating') return 'AI Service đang tạo câu hỏi từ transcript toàn video.';
  if (value.quizStatus === 'failed') return 'Bước tạo quiz đã thất bại. Có thể thử lại đúng bước.';
  if (value.quizStatus === 'ready') return 'Quiz toàn video đã sẵn sàng.';
  return 'Backend đang xác thực transcript.';
}

function transcriptStatusLabel(status: LearningPackage['transcript']['status'] | undefined): string | undefined {
  return { waiting: 'Đang chờ transcript.', validating: 'Backend đang xác thực transcript.', generating: 'Đang tạo transcript dự phòng.', ready: 'Transcript đã sẵn sàng.', unavailable: 'Transcript không khả dụng.', failed: 'Tạo transcript thất bại.' }[status ?? 'waiting'];
}

function sessionStatusLabel(status: LearningPackage['session']['status']): string {
  return { active: 'đang hoạt động', completed: 'đã hoàn tất', closed: 'đã đóng', failed: 'bị lỗi' }[status];
}

function isActiveYoutubeContext(value: unknown): value is ActiveYoutubeContext {
  const context = value as Partial<ActiveYoutubeContext>;
  return Boolean(context) && Number.isInteger(context.tabId) && typeof context.youtubeVideoId === 'string' && /^[A-Za-z0-9_-]{11}$/.test(context.youtubeVideoId) && typeof context.title === 'string' && context.title.trim().length > 0;
}

function isLocalTranscript(value: unknown): value is LocalTranscript {
  const transcript = value as Partial<LocalTranscript>;
  return Boolean(transcript) && (transcript.status === 'available' || transcript.status === 'unavailable' || transcript.status === 'insufficient') && typeof transcript.language === 'string' && Array.isArray(transcript.cues);
}

function contextFromVideoActivationMessage(message: ExtensionMessage): ActiveYoutubeContext | null {
  if (message.type !== 'ACTIVATION_ENABLED' && message.type !== 'VIDEO_CONTEXT_CHANGED') return null;
  const title = (message.payload as { videoTitle?: unknown } | undefined)?.videoTitle;
  return { tabId: message.tabId, youtubeVideoId: message.youtubeVideoId, title: typeof title === 'string' && title.trim() ? title : 'YouTube video' };
}

function belongsToActiveVideo(message: ExtensionMessage, context: ActiveYoutubeContext | null): boolean {
  return context !== null && message.tabId === context.tabId && message.youtubeVideoId === context.youtubeVideoId;
}

function healthStatusLabel(status: BackendStatus): string {
  return { idle: 'CHƯA KIỂM TRA', checking: 'ĐANG KIỂM TRA', connected: 'ĐÃ KẾT NỐI', error: 'LỖI' }[status];
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function loadPersistentActivationState(): Promise<boolean> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'STUDYLENS_GET_ACTIVATION_STATE' }) as { enabled?: boolean } | undefined;
    return response?.enabled === true;
  } catch { return false; }
}

async function getActiveLearningPackage(): Promise<LearningPackage | null> {
  const response = await chrome.runtime.sendMessage({ type: 'STUDYLENS_GET_ACTIVE_LEARNING_PACKAGE' }) as { ok?: unknown; learningPackage?: unknown; code?: unknown } | undefined;
  if (response?.ok !== true) {
    if (response?.code === 'sessionRuntimeUnavailable') return null;
    throw new Error(typeof response?.code === 'string' ? response.code : 'learningPackageUnavailable');
  }
  return isLearningPackage(response.learningPackage) ? response.learningPackage : null;
}

function isLearningPackage(value: unknown): value is LearningPackage {
  const item = value as Partial<LearningPackage>;
  return Boolean(item) && Boolean(item.session) && typeof item.session?.sessionId === 'string' && typeof item.session?.youtubeVideoId === 'string' && Boolean(item.transcript) && typeof item.transcript?.status === 'string' && Array.isArray(item.transcript?.cues) && typeof item.quizStatus === 'string';
}

async function getActivePlayerTime(): Promise<{ youtubeVideoId: string; currentTimeMs: number } | null> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'STUDYLENS_GET_ACTIVE_PLAYER_TIME' }) as { ok?: unknown; youtubeVideoId?: unknown; currentTimeMs?: unknown } | undefined;
    return response?.ok === true && typeof response.youtubeVideoId === 'string' && typeof response.currentTimeMs === 'number'
      ? { youtubeVideoId: response.youtubeVideoId, currentTimeMs: response.currentTimeMs }
      : null;
  } catch { return null; }
}

async function seekActivePlayer(youtubeVideoId: string, timestampMs: number): Promise<{ ok: boolean; code?: string }> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'STUDYLENS_SEEK_ACTIVE_PLAYER', youtubeVideoId, timestampMs }) as { ok?: unknown; code?: unknown } | undefined;
    return response?.ok === true ? { ok: true } : { ok: false, code: typeof response?.code === 'string' ? response.code : 'seekFailed' };
  } catch { return { ok: false, code: 'seekFailed' }; }
}

async function getLearningPreferences(): Promise<LearningPreferences> {
  const response = await chrome.runtime.sendMessage({ type: 'STUDYLENS_GET_LEARNING_PREFERENCES' }) as { ok?: boolean; preferences?: unknown; code?: string } | undefined;
  if (response?.ok && isLearningPreferences(response.preferences)) return { ...response.preferences };
  throw new Error(response?.code ?? 'learningPreferencesUnavailable');
}

async function persistLearningPreferences(preferences: LearningPreferences): Promise<LearningPreferences> {
  const response = await chrome.runtime.sendMessage({ type: 'STUDYLENS_SAVE_LEARNING_PREFERENCES', preferences }) as { ok?: boolean; preferences?: unknown; code?: string } | undefined;
  if (response?.ok && isLearningPreferences(response.preferences)) return { ...response.preferences };
  throw new Error(response?.code ?? 'learningPreferencesUnavailable');
}
