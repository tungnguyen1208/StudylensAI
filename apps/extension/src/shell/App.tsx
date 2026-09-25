import React, { useEffect, useRef, useState } from 'react';
import {
  AssessmentPanel,
  AssessmentHistoryApi,
  GradeResult,
  HistoryPage,
  type GradeView,
  type HistoryEntryReadModel,
  type LocalAnswerSubmission,
  type QuizAvailable,
} from '../features/assessment-history';
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
  type TranscriptCaptureDetails,
} from '../features/video-activation';
import type { TranscriptCaptureRef } from '../shared/contracts/activation-handoff';
import { VideoActivationApi } from '../features/video-activation/api/video-activation-api';
import { httpClient } from '../shared/http/http-client';
import { messageBus } from '../shared/messaging/message-bus';
import type { ExtensionMessage } from '../shared/messaging/message-types';
import { isOperationStatusMessage, type OperationStatusPayload, type StudyLensOperation } from '../shared/messaging/operation-status';

interface BackendHealthResponse {
  status: string;
  service: string;
  aiService?: {
    status: string;
    service: string;
  };
}

type BackendStatus = 'idle' | 'checking' | 'connected' | 'error';
type SidePanelTab = 'study' | 'history' | 'settings';
type ActiveYoutubeContext = NonNullable<ActivationState['context']>;
type SessionProgress = {
  status: 'idle' | 'starting' | 'active' | 'completing' | 'completed' | 'error';
  activeStudyMs: number;
  segmentStatus: 'idle' | 'creating' | 'created' | 'retryable' | 'blocked';
  segmentError?: string;
  sessionId?: string;
  youtubeVideoId?: string;
};

const assessmentHistoryApi = new AssessmentHistoryApi();
const videoActivationApi = new VideoActivationApi();

export const App: React.FC = () => {
  const [backendStatus, setBackendStatus] = useState<BackendStatus>('idle');
  const [backendData, setBackendData] = useState<BackendHealthResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [quiz, setQuiz] = useState<QuizAvailable | null>(null);
  const [activationState, setActivationState] = useState<ActivationState>(initialActivationState);
  const [activationCommandStatus, setActivationCommandStatus] = useState<'idle' | 'sending' | 'error'>('idle');
  const [activationCommandError, setActivationCommandError] = useState<string | null>(null);
  const [activationCommandNotice, setActivationCommandNotice] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SidePanelTab>('study');
  const [latestGrade, setLatestGrade] = useState<GradeView | null>(null);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntryReadModel[]>([]);
  const [historyStatus, setHistoryStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [operationStatuses, setOperationStatuses] = useState<Partial<Record<StudyLensOperation, OperationStatusPayload>>>({});
  const [learningPreferences, setLearningPreferences] = useState<LearningPreferences>(DEFAULT_LEARNING_PREFERENCES);
  const [preferencesStatus, setPreferencesStatus] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading');
  const [preferencesError, setPreferencesError] = useState<string | null>(null);
  const [transcriptPreview, setTranscriptPreview] = useState<TranscriptCaptureDetails | null>(null);
  const [transcriptPreviewLoading, setTranscriptPreviewLoading] = useState(false);
  const [transcriptPreviewError, setTranscriptPreviewError] = useState<string | null>(null);
  const [playerTimeMs, setPlayerTimeMs] = useState<number | null>(null);
  const [sessionProgress, setSessionProgress] = useState<SessionProgress | null>(null);
  const [quizStarted, setQuizStarted] = useState(false);
  const [seekError, setSeekError] = useState<string | null>(null);
  const activeVideoContextRef = useRef<ActiveYoutubeContext | null>(null);
  const transcriptCaptureIdRef = useRef<string | null>(null);

  const resetVideoScopedPanelState = () => {
    setQuiz(null);
    setLatestGrade(null);
    setOperationStatuses({});
    setTranscriptPreview(null);
    setTranscriptPreviewError(null);
    setTranscriptPreviewLoading(false);
    setPlayerTimeMs(null);
    setSessionProgress(null);
    setQuizStarted(false);
    setSeekError(null);
    setActivationCommandError(null);
    setActivationCommandNotice(null);
  };

  const presentVideoContext = (context: ActiveYoutubeContext) => {
    const previous = activeVideoContextRef.current;
    const hasChanged = previous?.tabId !== context.tabId || previous.youtubeVideoId !== context.youtubeVideoId;
    activeVideoContextRef.current = context;
    if (hasChanged) resetVideoScopedPanelState();
    setActivationState((state) => ({
      ...state,
      context,
      transcriptCapture: hasChanged ? null : state.transcriptCapture,
    }));
  };

  const refreshActiveYoutubeContext = async () => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'STUDYLENS_GET_ACTIVE_YOUTUBE_CONTEXT' }) as {
        ok?: unknown; context?: unknown; transcriptCapture?: unknown;
      } | undefined;
      const context = response?.context;
      if (response?.ok !== true || !isActiveYoutubeContext(context)) return;
      presentVideoContext(context);
      const capture = response.transcriptCapture;
      if (isTranscriptCaptureForContext(capture, context.youtubeVideoId)) {
        setActivationState((state) => state.context?.tabId === context.tabId &&
          state.context.youtubeVideoId === context.youtubeVideoId
          ? { ...state, transcriptCapture: capture }
          : state);
      }
    } catch {
      // The Side Panel remains usable while no ready YouTube tab is selected.
    }
  };

  useEffect(() => {
    void checkHealth();
    void refreshActiveYoutubeContext();
  }, []);

  const transcriptCaptureId = activationState.transcriptCapture?.transcriptCaptureId ?? null;

  useEffect(() => {
    transcriptCaptureIdRef.current = transcriptCaptureId;
  }, [transcriptCaptureId]);

  useEffect(() => {
    const context = activationState.context;
    if (!transcriptCaptureId || !context) {
      setPlayerTimeMs(null);
      return;
    }

    let disposed = false;
    const refreshPlayerTime = async () => {
      const result = await getActivePlayerTime();
      if (!disposed && result?.youtubeVideoId === context.youtubeVideoId) {
        setPlayerTimeMs(result.currentTimeMs);
      }
    };
    void refreshPlayerTime();
    const intervalId = window.setInterval(() => void refreshPlayerTime(), 750);
    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [transcriptCaptureId, activationState.context?.tabId, activationState.context?.youtubeVideoId]);

  useEffect(() => {
    const context = activationState.context;
    if (!context || activationState.status !== 'active') {
      setSessionProgress(null);
      return;
    }
    let disposed = false;
    const refreshProgress = async () => {
      const progress = await getActiveSessionProgress();
      if (!disposed && progress?.youtubeVideoId === context.youtubeVideoId) setSessionProgress(progress);
    };
    void refreshProgress();
    const intervalId = window.setInterval(() => void refreshProgress(), 1_000);
    return () => { disposed = true; window.clearInterval(intervalId); };
  }, [activationState.context?.tabId, activationState.context?.youtubeVideoId, activationState.status]);

  useEffect(() => {
    const videoId = activationState.context?.youtubeVideoId;
    if (!videoId) return;
    let disposed = false;
    void loadPersistedPanelQuiz(videoId).then((persistedQuiz) => {
      if (!disposed && persistedQuiz) {
        setQuiz(persistedQuiz);
        setQuizStarted(false);
      }
    });
    return () => { disposed = true; };
  }, [activationState.context?.youtubeVideoId]);

  const refreshTranscriptPreview = async () => {
    const requestedCaptureId = transcriptCaptureId;
    if (!requestedCaptureId) return;
    setTranscriptPreviewLoading(true);
    setTranscriptPreviewError(null);
    try {
      const details = await videoActivationApi.getTranscriptCaptureDetails(requestedCaptureId);
      const activeContext = activeVideoContextRef.current;
      if (
        transcriptCaptureIdRef.current === requestedCaptureId &&
        activeContext?.youtubeVideoId === details.capture.youtubeVideoId
      ) {
        setTranscriptPreview(details);
      }
    } catch (error: unknown) {
      if (transcriptCaptureIdRef.current !== requestedCaptureId) return;
      setTranscriptPreviewError(error instanceof Error ? error.message : 'Không thể tải transcript từ Backend.');
    } finally {
      if (transcriptCaptureIdRef.current === requestedCaptureId) setTranscriptPreviewLoading(false);
    }
  };

  useEffect(() => {
    if (!transcriptCaptureId) {
      setTranscriptPreview(null);
      setTranscriptPreviewError(null);
      return;
    }
    void refreshTranscriptPreview();
    const intervalId = window.setInterval(() => void refreshTranscriptPreview(), 5_000);
    return () => window.clearInterval(intervalId);
  }, [transcriptCaptureId]);

  useEffect(() => {
    let mounted = true;
    void getLearningPreferences().then(
      (preferences) => {
        if (!mounted) return;
        setLearningPreferences(preferences);
        setPreferencesStatus('ready');
      },
      (error: unknown) => {
        if (!mounted) return;
        setPreferencesStatus('error');
        setPreferencesError(error instanceof Error ? error.message : 'Không thể tải tùy chọn học tập.');
      },
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
      messageBus.subscribe('QUIZ_AVAILABLE', (message) => {
        if (!belongsToActiveVideo(message, activeVideoContextRef.current)) return;
        const payload = message.payload as QuizAvailable;
        if (Array.isArray(payload?.questions) && payload.questions.length > 0) {
          setQuiz(payload);
          setQuizStarted(false);
        }
      }),
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
    const onRuntimeMessage = (message: unknown) => {
      const type = (message as { type?: unknown })?.type;
      if (type === 'STUDYLENS_ACTIVE_TAB_CHANGED' || type === 'STUDYLENS_ACTIVE_YOUTUBE_CONTEXT_CHANGED') {
        void refreshActiveYoutubeContext();
      }
    };
    chrome.runtime.onMessage.addListener(onRuntimeMessage);
    return () => chrome.runtime.onMessage.removeListener(onRuntimeMessage);
  }, []);

  const checkHealth = async () => {
    setBackendStatus('checking');
    setErrorMessage(null);
    try {
      const result = await httpClient.get<BackendHealthResponse>('api/health');
      setBackendData(result);
      setBackendStatus('connected');
    } catch (err: unknown) {
      setBackendStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Không thể kết nối tới StudyLens API.');
    }
  };

  const submitAssessmentAnswer = async (submission: LocalAnswerSubmission, clientAttemptId: string): Promise<GradeView> => {
    if (!quiz) throw new Error('quizQuestionUnavailable');
    return assessmentHistoryApi.submitAnswer(quiz, submission, clientAttemptId);
  };

  const seekToTranscriptCue = async (timestampMs: number): Promise<void> => {
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
      setHistoryError(error instanceof Error ? error.message : 'Không thể tải lịch sử học tập.');
    }
  };

  const handleGradeReceived = (grade: GradeView) => {
    setLatestGrade(grade);
    setActiveTab('history');
    void refreshHistoryTab();
  };

  const recordOperationStatus = (status: OperationStatusPayload) => {
    setOperationStatuses((statuses) => ({ ...statuses, [status.operation]: status }));
  };

  const retryContentOperation = async (operation: StudyLensOperation) => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
    await chrome.runtime.sendMessage({ type: 'STUDYLENS_RETRY_OPERATION', operation });
  };

  const requestManualActivation = async (requestedState: 'on' | 'off') => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      setActivationCommandStatus('error');
      setActivationCommandError('Không thể kết nối tới Chrome hoặc Edge Extension Runtime.');
      return;
    }
    setActivationCommandStatus('sending');
    setActivationCommandError(null);
    setActivationCommandNotice(null);
    try {
      const response = await chrome.runtime.sendMessage({ type: 'STUDYLENS_MANUAL_TOGGLE', requestedState }) as {
        ok?: boolean; code?: string; pendingPageCapture?: boolean; state?: { enabled?: boolean };
      };
      if (!response?.ok) throw new Error(response?.code ?? 'manualActivationUnavailable');
      if (requestedState === 'on') {
        const contentScriptUnavailable = response.pendingPageCapture && response.code === 'contentScriptUnavailable';
        setActivationState((state) => ({
          ...state,
          status: 'active',
          errorCode: contentScriptUnavailable ? 'contentScriptUnavailable' : null,
        }));
        if (contentScriptUnavailable) {
          setActivationCommandNotice('StudyLens đã được bật. Hãy tải lại tab YouTube này để Extension khởi chạy và đọc transcript.');
        }
        void refreshActiveYoutubeContext();
      } else {
        setActivationState((state) => ({ ...state, status: 'off', errorCode: null }));
      }
      setActivationCommandStatus('idle');
    } catch (error: unknown) {
      setActivationCommandStatus('error');
      setActivationCommandError(error instanceof Error ? error.message : 'Không thể cập nhật trạng thái StudyLens.');
    }
  };

  const saveLearningPreferences = async (preferences: LearningPreferences): Promise<void> => {
    setPreferencesStatus('saving');
    setPreferencesError(null);
    try {
      const saved = await persistLearningPreferences(preferences);
      setLearningPreferences(saved);
      setPreferencesStatus('ready');
    } catch (error: unknown) {
      setPreferencesStatus('error');
      setPreferencesError(error instanceof Error ? error.message : 'Không thể lưu tùy chọn học tập.');
    }
  };

  return (
    <main className="studylens-app">
      <header className="app-header">
        <div>
          <h1 className="app-title">StudyLens</h1>
          <p className="app-subtitle">Tập trung vào nội dung video</p>
        </div>
        <nav className="panel-tabs" aria-label="Điều hướng StudyLens" role="tablist">
          <button
            id="study-tab"
            type="button"
            className={`panel-tab ${activeTab === 'study' ? 'panel-tab--active' : ''}`}
            role="tab"
            aria-selected={activeTab === 'study'}
            aria-controls="study-panel"
            onClick={() => setActiveTab('study')}
          >
            Học tập
          </button>
          <button
            id="history-tab"
            type="button"
            className={`panel-tab ${activeTab === 'history' ? 'panel-tab--active' : ''}`}
            role="tab"
            aria-selected={activeTab === 'history'}
            aria-controls="history-panel"
            onClick={() => {
              setActiveTab('history');
              void refreshHistoryTab();
            }}
          >
            Lịch sử
          </button>
          <button
            id="settings-tab"
            type="button"
            className={`panel-tab ${activeTab === 'settings' ? 'panel-tab--active' : ''}`}
            role="tab"
            aria-selected={activeTab === 'settings'}
            aria-controls="settings-panel"
            onClick={() => setActiveTab('settings')}
          >
            Cài đặt
          </button>
        </nav>
      </header>

      {activeTab === 'study' ? (
        <div id="study-panel" role="tabpanel" aria-labelledby="study-tab">
          <section className="learning-hero" aria-labelledby="learning-now-heading">
            <div className="learning-hero__play" aria-hidden="true"><span /></div>
            <div className="learning-hero__content">
              <h2 id="learning-now-heading">Bài giảng: {activationState.context?.title ?? 'Chưa mở video YouTube hợp lệ'}</h2>
              <p>{activationState.context ? `YouTube · ${sessionProgress?.status === 'active' ? 'Phiên học đang hoạt động' : 'Đang chờ transcript hợp lệ'}` : 'Mở trang YouTube /watch để bắt đầu.'}</p>
            </div>
          </section>

          <StudyCycleCard
            preferences={learningPreferences}
            progress={sessionProgress}
            activationState={activationState}
          />

          <section className="panel-section" aria-labelledby="transcript-preview-heading">
            <TranscriptPreview
              details={transcriptPreview}
              loading={transcriptPreviewLoading}
              error={transcriptPreviewError}
              currentTimeMs={playerTimeMs}
              onRefresh={() => void refreshTranscriptPreview()}
              onSeek={(timestampMs) => void seekToTranscriptCue(timestampMs)}
            />
            {seekError ? <p className="health-error" role="alert">{seekError}</p> : null}
          </section>

          <section className="panel-section" aria-labelledby="operations-heading">
            <h2 id="operations-heading" className="section-heading">Trạng thái xử lý</h2>
            <ProcessingStages activationState={activationState} quiz={quiz} operationStatuses={operationStatuses} />
            <p className="section-copy">{learningStateSummary(activationState, operationStatuses, quiz)}</p>
            <OperationStatusList statuses={operationStatuses} onRetry={retryContentOperation} />
          </section>

          {quiz ? (
            <section className="quiz-ready-card" aria-labelledby="quiz-ready-heading">
              {!quizStarted ? (
                <>
                  <div className="quiz-ready-card__badge">ĐÃ SẴN SÀNG</div>
                  <h2 id="quiz-ready-heading">Quiz đã sẵn sàng</h2>
                  <p>{quiz.questions.length} câu hỏi thật đã được Backend tạo từ segment transcript đã đóng băng.</p>
                  <button type="button" className="primary-button" onClick={() => setQuizStarted(true)}>Bắt đầu làm bài</button>
                </>
              ) : (
                <>
                  <div className="section-heading-row">
                    <div><div className="quiz-ready-card__badge">ĐANG LÀM BÀI</div><h2 id="quiz-ready-heading" className="section-heading">Bài kiểm tra</h2></div>
                    <button type="button" className="secondary-button" onClick={() => setQuizStarted(false)}>Quay lại</button>
                  </div>
                  <AssessmentPanel quiz={quiz} submitAnswer={submitAssessmentAnswer} onOperationStatus={recordOperationStatus} onGrade={handleGradeReceived} />
                </>
              )}
            </section>
          ) : null}

        </div>
      ) : activeTab === 'history' ? (
        <div id="history-panel" role="tabpanel" aria-labelledby="history-tab" className="history-view">
          <section className="panel-section" aria-labelledby="latest-grade-heading">
            <h2 id="latest-grade-heading" className="section-heading">Kết quả gần nhất</h2>
            {latestGrade ? (
              <GradeResult grade={latestGrade} />
            ) : (
              <p className="section-copy" role="status">Chưa có kết quả chấm điểm. Kết quả sẽ xuất hiện sau khi bạn nộp đáp án.</p>
            )}
          </section>

          <section className="panel-section" aria-labelledby="history-heading">
            <div className="section-heading-row">
              <h2 id="history-heading" className="section-heading">Lịch sử học tập</h2>
              <button type="button" className="secondary-button" disabled={historyStatus === 'loading'} onClick={() => void refreshHistoryTab()}>
                {historyStatus === 'loading' ? 'Đang tải...' : 'Làm mới'}
              </button>
            </div>
            {historyError && <p className="health-error" role="alert">Lỗi: {historyError}</p>}
            {historyStatus === 'loading' && historyEntries.length === 0 ? (
              <p className="section-copy" role="status">Đang tải lịch sử học tập...</p>
            ) : (
              <HistoryPage entries={historyEntries} />
            )}
          </section>
        </div>
      ) : (
        <div id="settings-panel" role="tabpanel" aria-labelledby="settings-tab" className="settings-view">
          <header className="settings-intro">
            <h2>Cài đặt học tập</h2>
            <p>Điều chỉnh một lần, áp dụng cho mọi video.</p>
          </header>
          <section className="panel-section" aria-labelledby="activation-heading">
            <div className="setting-toggle-row">
              <div><h2 id="activation-heading" className="section-heading">StudyLens đang {activationState.status === 'active' ? 'bật' : 'tắt'}</h2><p className="section-copy">Giữ trạng thái này khi chuyển video hoặc khởi động lại trình duyệt.</p></div>
              <ActivationToggle active={activationState.status === 'active'} disabled={activationCommandStatus === 'sending'} onRequest={requestManualActivation} />
            </div>
            {activationCommandError && <p role="alert" className="health-error">Lỗi: {activationCommandError}</p>}
            {activationCommandNotice && <p role="status" className="section-copy section-copy--warning">{activationCommandNotice}</p>}
          </section>

          <section className="panel-section" aria-labelledby="preferences-heading">
            <h2 id="preferences-heading" className="section-heading">Cấu hình quiz</h2>
            {preferencesStatus === 'loading' ? (
              <p className="section-copy" role="status">Đang tải tùy chọn học tập...</p>
            ) : (
              <LearningPreferencesForm
                preferences={learningPreferences}
                saving={preferencesStatus === 'saving'}
                error={preferencesError}
                onSave={saveLearningPreferences}
              />
            )}
          </section>

          <section className="panel-section" aria-labelledby="transcript-source-heading">
            <h2 id="transcript-source-heading" className="section-heading">Nguồn transcript</h2>
            <p className="section-copy"><strong>YouTube captions</strong> · `captionTracks` → Timedtext JSON3/XML → DOM fallback khi cần.</p>
            <p className="learning-preferences__hint">Nguồn runtime được cố định bởi contract 0.4.0; Extension không gửi audio hoặc gọi AI Service trực tiếp.</p>
          </section>

          <section className="panel-section" aria-labelledby="health-heading">
            <div className="section-heading-row"><h2 id="health-heading" className="section-heading">Kết nối & chẩn đoán</h2><span className={`health-badge health-badge--${backendStatus}`}>{healthStatusLabel(backendStatus)}</span></div>
            <div className="health-service">
              <div>Backend: {backendData?.service ?? 'Chưa kiểm tra'}</div>
              {backendData?.aiService ? <div>AI Service: {backendData.aiService.status} ({backendData.aiService.service})</div> : null}
              {activationState.context ? <div>Video: {activationState.context.youtubeVideoId}</div> : <div>Video: chưa có trang xem hợp lệ</div>}
            </div>
            {errorMessage && <p className="health-error" role="alert">Lỗi Backend: {errorMessage}</p>}
            <button type="button" className="secondary-button" onClick={() => void checkHealth()} disabled={backendStatus === 'checking'}>{backendStatus === 'checking' ? 'Đang kiểm tra...' : 'Kiểm tra Backend'}</button>
          </section>
        </div>
      )}
    </main>
  );
};

function StudyCycleCard({ preferences, progress, activationState }: {
  preferences: LearningPreferences;
  progress: SessionProgress | null;
  activationState: ActivationState;
}) {
  const intervalMs = preferences.quizIntervalMinutes * 60_000;
  const activeStudyMs = progress?.activeStudyMs ?? 0;
  const percent = Math.min(100, Math.round((activeStudyMs / intervalMs) * 100));
  const caption = activationState.status !== 'active'
    ? 'Bật StudyLens trong Cài đặt để bắt đầu một phiên học.'
    : activationState.transcriptCapture?.status === 'unavailable'
      ? 'Video này không có transcript YouTube phù hợp; chưa thể tạo quiz.'
      : activationState.transcriptCapture?.status === 'insufficient'
        ? 'Transcript chưa đủ điều kiện xác thực từ Backend.'
        : progress?.status === 'active'
          ? `Đang tích lũy thời gian học thực tế cho chu kỳ ${preferences.quizIntervalMinutes} phút.`
          : 'Đang chờ transcript hợp lệ và Backend tạo phiên học.';
  return (
    <section className="panel-section study-cycle" aria-labelledby="study-cycle-heading">
      <div className="section-heading-row"><h2 id="study-cycle-heading" className="section-heading">Tiến độ chu kỳ học</h2><strong>{formatDuration(activeStudyMs)} / {preferences.quizIntervalMinutes}:00</strong></div>
      <div className="study-cycle__track" role="progressbar" aria-label="Tiến độ chu kỳ học" aria-valuemin={0} aria-valuemax={intervalMs} aria-valuenow={Math.min(activeStudyMs, intervalMs)}><span style={{ width: `${percent}%` }} /></div>
      <p className="section-copy">{caption}</p>
      {progress?.segmentStatus === 'creating' ? <p className="study-cycle__stage">Backend đang đóng băng segment transcript…</p> : null}
      {progress?.segmentError ? <p className="health-error" role="alert">Phân đoạn: {progress.segmentError}</p> : null}
    </section>
  );
}

function OperationStatusList({ statuses, onRetry }: {
  statuses: Partial<Record<StudyLensOperation, OperationStatusPayload>>;
  onRetry: (operation: StudyLensOperation) => Promise<void>;
}) {
  const values = Object.values(statuses);
  if (values.length === 0) return <p className="section-copy">Chưa có thao tác cần theo dõi.</p>;
  return (
    <div className="operation-status-list">
      {values.map((status) => status && (
        <div className={`operation-status operation-status--${status.state}`} key={status.operation}>
          <strong>{operationLabel(status.operation)}</strong>
          <span>{status.message}</span>
          {status.code && <small>Mã: {status.code}{status.traceId ? ` · Trace: ${status.traceId}` : ''}</small>}
          {status.state === 'failed' && status.retryable && ['transcriptUpload', 'sessionStart', 'segmentCreate', 'quizGenerate'].includes(status.operation) && (
            <button type="button" className="operation-status__retry" onClick={() => void onRetry(status.operation)}>Thử lại</button>
          )}
        </div>
      ))}
    </div>
  );
}

function operationLabel(operation: StudyLensOperation): string {
  return {
    transcriptUpload: 'Phụ đề YouTube', sessionStart: 'Phiên học', segmentCreate: 'Phân đoạn',
    quizGenerate: 'Bài kiểm tra', answerSubmit: 'Câu trả lời', historyLoad: 'Lịch sử',
  }[operation];
}

function ProcessingStages({ activationState, quiz, operationStatuses }: {
  activationState: ActivationState;
  quiz: QuizAvailable | null;
  operationStatuses: Partial<Record<StudyLensOperation, OperationStatusPayload>>;
}) {
  const captureReady = activationState.transcriptCapture?.status === 'available';
  const collecting = activationState.status === 'active' && !captureReady;
  const generating = operationStatuses.quizGenerate?.state === 'pending' || operationStatuses.segmentCreate?.state === 'pending';
  return (
    <div className="processing-stages" aria-label="Tiến trình tạo quiz">
      <span className={collecting ? 'processing-stage processing-stage--active' : captureReady ? 'processing-stage processing-stage--done' : 'processing-stage'}>
        {captureReady ? '✓ Đã thu thập phụ đề' : '1 · Thu thập phụ đề'}
      </span>
      <span className={quiz ? 'processing-stage processing-stage--done' : generating ? 'processing-stage processing-stage--active' : 'processing-stage'}>
        {quiz ? '✓ Đã tạo câu hỏi' : '2 · Tạo câu hỏi →'}
      </span>
    </div>
  );
}
function learningStateSummary(
  state: ActivationState,
  statuses: Partial<Record<StudyLensOperation, OperationStatusPayload>>,
  quiz: QuizAvailable | null,
): string {
  if (!state.context) return 'Chưa mở video YouTube hợp lệ.';
  if (state.status !== 'active') return 'StudyLens đang tắt. Bạn có thể bật lại trong Cài đặt.';
  if (state.transcriptCapture?.status === 'unavailable') return 'Transcript không khả dụng cho video này; StudyLens vẫn giữ trạng thái ON.';
  if (state.transcriptCapture?.status === 'insufficient') return 'Transcript chưa đủ nội dung theo điều kiện Backend; chưa tạo phiên học.';
  if (statuses.quizGenerate?.state === 'pending') return 'AI Service đang tạo câu hỏi từ segment đã được Backend đóng băng.';
  if (quiz) return 'Quiz đã sẵn sàng từ dữ liệu Backend thật.';
  if (statuses.transcriptUpload?.state === 'pending') return 'Đang gửi và xác thực transcript tại Backend.';
  if (!state.transcriptCapture) return 'Đang thu thập transcript YouTube có timestamp.';
  return 'Transcript đã sẵn sàng; StudyLens đang chờ đủ thời gian học thực tế để tạo segment.';
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function isActiveYoutubeContext(value: unknown): value is ActiveYoutubeContext {
  const context = value as Partial<ActiveYoutubeContext>;
  return Boolean(context) && Number.isInteger(context.tabId) &&
    typeof context.youtubeVideoId === 'string' && /^[A-Za-z0-9_-]{11}$/.test(context.youtubeVideoId) &&
    typeof context.title === 'string' && context.title.trim().length > 0;
}

function contextFromVideoActivationMessage(message: ExtensionMessage): ActiveYoutubeContext | null {
  if (message.type !== 'ACTIVATION_ENABLED' && message.type !== 'VIDEO_CONTEXT_CHANGED') return null;
  const title = (message.payload as { videoTitle?: unknown } | undefined)?.videoTitle;
  return {
    tabId: message.tabId,
    youtubeVideoId: message.youtubeVideoId,
    title: typeof title === 'string' && title.trim() ? title : 'YouTube video',
  };
}

function belongsToActiveVideo(message: ExtensionMessage, context: ActiveYoutubeContext | null): boolean {
  return context !== null && message.tabId === context.tabId && message.youtubeVideoId === context.youtubeVideoId;
}

function healthStatusLabel(status: BackendStatus): string {
  return {
    idle: 'CHƯA KIỂM TRA',
    checking: 'ĐANG KIỂM TRA',
    connected: 'ĐÃ KẾT NỐI',
    error: 'LỖI',
  }[status];
}

async function loadPersistentActivationState(): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return false;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'STUDYLENS_GET_ACTIVATION_STATE' }) as { enabled?: boolean };
    return response?.enabled === true;
  } catch {
    return false;
  }
}

async function getActivePlayerTime(): Promise<{ youtubeVideoId: string; currentTimeMs: number } | null> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return null;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'STUDYLENS_GET_ACTIVE_PLAYER_TIME' }) as {
      ok?: unknown; youtubeVideoId?: unknown; currentTimeMs?: unknown;
    } | undefined;
    return response?.ok === true && typeof response.youtubeVideoId === 'string' &&
      /^[A-Za-z0-9_-]{11}$/.test(response.youtubeVideoId) &&
      typeof response.currentTimeMs === 'number' && Number.isFinite(response.currentTimeMs)
      ? { youtubeVideoId: response.youtubeVideoId, currentTimeMs: response.currentTimeMs }
      : null;
  } catch {
    return null;
  }
}

function isTranscriptCaptureForContext(value: unknown, youtubeVideoId: string): value is TranscriptCaptureRef & { status: 'available' } {
  const capture = value as Partial<TranscriptCaptureRef>;
  return Boolean(capture) && typeof capture.transcriptCaptureId === 'string' && capture.transcriptCaptureId.length > 0 &&
    capture.youtubeVideoId === youtubeVideoId && typeof capture.language === 'string' && capture.language.length > 0 &&
    capture.source === 'youtubeCaption' && capture.status === 'available' &&
    typeof capture.availableCueCount === 'number' && Number.isInteger(capture.availableCueCount) && capture.availableCueCount > 0 &&
    typeof capture.version === 'number' && Number.isInteger(capture.version) && capture.version >= 1;
}

async function getActiveSessionProgress(): Promise<SessionProgress | null> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return null;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'STUDYLENS_GET_ACTIVE_SESSION_PROGRESS' }) as { ok?: unknown; state?: unknown } | undefined;
    return response?.ok === true && isSessionProgress(response.state) ? response.state : null;
  } catch {
    return null;
  }
}

async function seekActivePlayer(youtubeVideoId: string, timestampMs: number): Promise<{ ok: boolean; code?: string }> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return { ok: false, code: 'extensionRuntimeUnavailable' };
  try {
    const response = await chrome.runtime.sendMessage({ type: 'STUDYLENS_SEEK_ACTIVE_PLAYER', youtubeVideoId, timestampMs }) as { ok?: unknown; code?: unknown } | undefined;
    return response?.ok === true ? { ok: true } : { ok: false, code: typeof response?.code === 'string' ? response.code : 'seekFailed' };
  } catch {
    return { ok: false, code: 'seekFailed' };
  }
}

async function loadPersistedPanelQuiz(youtubeVideoId: string): Promise<QuizAvailable | null> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return null;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'STUDYLENS_GET_PERSISTED_PANEL_QUIZ' }) as { ok?: unknown; quiz?: unknown; youtubeVideoId?: unknown } | undefined;
    return response?.ok === true && response.youtubeVideoId === youtubeVideoId && isQuizAvailable(response.quiz) ? response.quiz : null;
  } catch {
    return null;
  }
}

function isSessionProgress(value: unknown): value is SessionProgress {
  const state = value as Partial<SessionProgress>;
  return Boolean(state) && typeof state.activeStudyMs === 'number' && Number.isFinite(state.activeStudyMs) &&
    (state.status === 'idle' || state.status === 'starting' || state.status === 'active' || state.status === 'completing' || state.status === 'completed' || state.status === 'error') &&
    (state.segmentStatus === 'idle' || state.segmentStatus === 'creating' || state.segmentStatus === 'created' || state.segmentStatus === 'retryable' || state.segmentStatus === 'blocked');
}

function isQuizAvailable(value: unknown): value is QuizAvailable {
  const quiz = value as Partial<QuizAvailable>;
  return Boolean(quiz) && typeof quiz.quizId === 'string' && typeof quiz.sessionId === 'string' &&
    typeof quiz.segmentId === 'string' && typeof quiz.createdAtUtc === 'string' && Array.isArray(quiz.questions) && quiz.questions.length > 0;
}

async function getLearningPreferences(): Promise<LearningPreferences> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return { ...DEFAULT_LEARNING_PREFERENCES };
  const response = await chrome.runtime.sendMessage({ type: 'STUDYLENS_GET_LEARNING_PREFERENCES' }) as {
    ok?: boolean;
    preferences?: unknown;
    code?: string;
  } | undefined;
  if (response?.ok && isLearningPreferences(response.preferences)) return { ...response.preferences };
  throw new Error(response?.code ?? 'learningPreferencesUnavailable');
}
async function persistLearningPreferences(preferences: LearningPreferences): Promise<LearningPreferences> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) throw new Error('extensionRuntimeUnavailable');
  const response = await chrome.runtime.sendMessage({
    type: 'STUDYLENS_SAVE_LEARNING_PREFERENCES',
    preferences,
  }) as { ok?: boolean; preferences?: unknown; code?: string } | undefined;
  if (response?.ok && isLearningPreferences(response.preferences)) return { ...response.preferences };
  throw new Error(response?.code ?? 'learningPreferencesUnavailable');
}
