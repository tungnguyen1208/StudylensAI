import React, { useEffect, useState } from 'react';
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
  ActivationStatus,
  ActivationToggle,
  DEFAULT_LEARNING_PREFERENCES,
  LearningPreferencesForm,
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
import { initializeFeatureRegistry, type RegisteredFeatures } from './feature-registry';

interface BackendHealthResponse {
  status: string;
  service: string;
  aiService?: {
    status: string;
    service: string;
  };
}

type BackendStatus = 'idle' | 'checking' | 'connected' | 'error';
type ThemeMode = 'light' | 'dark';
type SidePanelTab = 'study' | 'history' | 'settings';

const THEME_STORAGE_KEY = 'studylensTheme';
const assessmentHistoryApi = new AssessmentHistoryApi();

export const App: React.FC = () => {
  const [features, setFeatures] = useState<RegisteredFeatures | null>(null);
  const [backendStatus, setBackendStatus] = useState<BackendStatus>('idle');
  const [backendData, setBackendData] = useState<BackendHealthResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [quiz, setQuiz] = useState<QuizAvailable | null>(null);
  const [activationState, setActivationState] = useState<ActivationState>(initialActivationState);
  const [activationCommandStatus, setActivationCommandStatus] = useState<'idle' | 'sending' | 'error'>('idle');
  const [activationCommandError, setActivationCommandError] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeMode>('dark');
  const [activeTab, setActiveTab] = useState<SidePanelTab>('study');
  const [latestGrade, setLatestGrade] = useState<GradeView | null>(null);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntryReadModel[]>([]);
  const [historyStatus, setHistoryStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [operationStatuses, setOperationStatuses] = useState<Partial<Record<StudyLensOperation, OperationStatusPayload>>>({});
  const [learningPreferences, setLearningPreferences] = useState<LearningPreferences>(DEFAULT_LEARNING_PREFERENCES);
  const [preferencesStatus, setPreferencesStatus] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading');
  const [preferencesError, setPreferencesError] = useState<string | null>(null);

  useEffect(() => {
    setFeatures(initializeFeatureRegistry());
    void checkHealth();
  }, []);

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
    let mounted = true;
    void loadThemePreference().then((preference) => {
      if (mounted) setTheme(preference);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const onActivationMessage = (message: ExtensionMessage) => {
      setActivationState((state) => applyVideoActivationMessage(state, message));
    };
    const unsubscribers = [
      messageBus.subscribe('ACTIVATION_ENABLED', onActivationMessage),
      messageBus.subscribe('ACTIVATION_DISABLED', onActivationMessage),
      messageBus.subscribe('VIDEO_CONTEXT_CHANGED', onActivationMessage),
      messageBus.subscribe('VIDEO_CONTEXT_UNAVAILABLE', onActivationMessage),
      messageBus.subscribe('QUIZ_AVAILABLE', (message) => {
        const payload = message.payload as QuizAvailable;
        if (Array.isArray(payload?.questions) && payload.questions.length > 0) setQuiz(payload);
      }),
      messageBus.subscribe('OPERATION_STATUS_CHANGED', (message) => {
        if (!isOperationStatusMessage(message)) return;
        setOperationStatuses((statuses) => ({ ...statuses, [message.payload.operation]: message.payload }));
      }),
    ];
    void loadPersistentActivationState().then((enabled) => {
      if (enabled) setActivationState((state) => ({ ...state, status: 'active', errorCode: null }));
    });
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
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

  const loadAssessmentHistory = async () => {
    const videoId = quiz?.questions[0]?.source.youtubeVideoId;
    return assessmentHistoryApi.getHistory(videoId);
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
    try {
      const response = await chrome.runtime.sendMessage({ type: 'STUDYLENS_MANUAL_TOGGLE', requestedState }) as {
        ok?: boolean; code?: string; state?: { enabled?: boolean };
      };
      if (!response?.ok) throw new Error(response?.code ?? 'manualActivationUnavailable');
      setActivationState((state) => requestedState === 'on'
        ? { ...state, status: 'active', errorCode: null }
        : { ...state, status: 'off', errorCode: null });
      setActivationCommandStatus('idle');
    } catch (error: unknown) {
      setActivationCommandStatus('error');
      setActivationCommandError(error instanceof Error ? error.message : 'Không thể cập nhật trạng thái StudyLens.');
    }
  };

  const toggleTheme = () => {
    const nextTheme: ThemeMode = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    void saveThemePreference(nextTheme);
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
          <h1 className="app-title">StudyLens AI</h1>
          <p className="app-subtitle">Khung ứng dụng học tập (v0.2.0)</p>
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
            className={`panel-tab panel-tab--settings ${activeTab === 'settings' ? 'panel-tab--active' : ''}`}
            role="tab"
            aria-selected={activeTab === 'settings'}
            aria-controls="settings-panel"
            aria-label="Cài đặt"
            title="Cài đặt"
            onClick={() => setActiveTab('settings')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M9.67 3.31a1 1 0 0 1 .98-.8h2.7a1 1 0 0 1 .98.8l.4 1.88c.47.2.91.45 1.31.76l1.83-.6a1 1 0 0 1 1.18.43l1.35 2.34a1 1 0 0 1-.2 1.24l-1.43 1.3a6.8 6.8 0 0 1 0 1.52l1.43 1.3a1 1 0 0 1 .2 1.24l-1.35 2.34a1 1 0 0 1-1.18.43l-1.83-.6c-.4.31-.84.56-1.31.76l-.4 1.88a1 1 0 0 1-.98.8h-2.7a1 1 0 0 1-.98-.8l-.4-1.88a6.3 6.3 0 0 1-1.31-.76l-1.83.6a1 1 0 0 1-1.18-.43L4.3 15.72a1 1 0 0 1 .2-1.24l1.43-1.3a6.8 6.8 0 0 1 0-1.52L4.5 10.36a1 1 0 0 1-.2-1.24l1.35-2.34a1 1 0 0 1 1.18-.43l1.83.6c.4-.31.84-.56 1.31-.76l.4-1.88ZM12 9a3.42 3.42 0 1 0 0 6.84A3.42 3.42 0 0 0 12 9Z" />
            </svg>
          </button>
        </nav>
      </header>

      {activeTab === 'study' ? (
        <div id="study-panel" role="tabpanel" aria-labelledby="study-tab">
      <section className="panel-section" aria-labelledby="health-heading">
        <h2 id="health-heading" className="section-heading">Trạng thái hệ thống</h2>
        <div className="health-row">
          <span className="health-label">ASP.NET Core Backend</span>
          <span className={`health-badge health-badge--${backendStatus}`}>{healthStatusLabel(backendStatus)}</span>
        </div>

        {backendData && (
          <div className="health-service">
            <div>Dịch vụ: {backendData.service}</div>
            {backendData.aiService && (
              <div>FastAPI AI: {backendData.aiService.status} ({backendData.aiService.service})</div>
            )}
          </div>
        )}

        {errorMessage && <div className="health-error">Lỗi: {errorMessage}</div>}

        <button
          type="button"
          className="primary-button"
          onClick={() => void checkHealth()}
          disabled={backendStatus === 'checking'}
        >
          {backendStatus === 'checking' ? 'Đang kiểm tra...' : 'Kiểm tra Backend'}
        </button>
      </section>

      <section className="panel-section" aria-labelledby="activation-heading">
        <h2 id="activation-heading" className="section-heading">Điều khiển StudyLens</h2>
        {activationState.context ? (
          <p className="section-copy">Video: {activationState.context.title}</p>
        ) : (
          <p className="section-copy section-copy--warning">Bật StudyLens khi bạn đang mở một trang xem video YouTube.</p>
        )}
        <ActivationStatus state={activationState} />
        <ActivationToggle
          active={activationState.status === 'active'}
          disabled={activationCommandStatus === 'sending'}
          onRequest={requestManualActivation}
        />
        {activationCommandError && <p role="alert" className="health-error">Lỗi: {activationCommandError}</p>}
      </section>

      <section className="panel-section" aria-labelledby="study-flow-heading">
        <h2 id="study-flow-heading" className="section-heading">Luồng học tập</h2>
        <p className="flow-copy">Bật thủ công → phiên học và bộ đếm → phân đoạn transcript → Backend → AI → bài kiểm tra.</p>
        {!quiz && <p className="section-copy" role="status">Bật StudyLens, xem đủ một chu kỳ và bài kiểm tra sẽ xuất hiện tại đây.</p>}
        {quiz && (
          <div className="quiz-panel">
            <div className="quiz-panel__title">Bài kiểm tra {quiz.quizId.slice(0, 8)} — dữ liệu công khai</div>
            <AssessmentPanel
              quiz={quiz}
              submitAnswer={submitAssessmentAnswer}
              loadHistory={loadAssessmentHistory}
              onOperationStatus={recordOperationStatus}
              onGrade={handleGradeReceived}
              showGrade={false}
              showHistory={false}
            />
          </div>
        )}
      </section>

      <section className="panel-section" aria-labelledby="operations-heading">
        <h2 id="operations-heading" className="section-heading">Trạng thái xử lý</h2>
        <OperationStatusList statuses={operationStatuses} onRetry={retryContentOperation} />
      </section>

      <section className="panel-section" aria-labelledby="modules-heading">
        <h2 id="modules-heading" className="section-heading">Các mô-đun hệ thống</h2>
        {features && (
          <div className="module-list">
            <ModuleCard className="module-card__title--dev1" title="Dev 1: Kích hoạt & thu nhận nội dung" module={features.videoActivation} />
            <ModuleCard className="module-card__title--dev2" title="Dev 2: Phiên học & bài kiểm tra" module={features.sessionQuiz} />
            <ModuleCard className="module-card__title--dev3" title="Dev 3: Đánh giá & lịch sử" module={features.assessmentHistory} />
          </div>
        )}
      </section>
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
          <section className="panel-section" aria-labelledby="appearance-heading">
            <h2 id="appearance-heading" className="section-heading">Giao diện</h2>
            <p className="section-copy">Chọn chế độ hiển thị phù hợp với môi trường học tập của bạn.</p>
            <button
              type="button"
              className="theme-toggle"
              aria-pressed={theme === 'light'}
              onClick={toggleTheme}
            >
              Chuyển sang chế độ {theme === 'dark' ? 'sáng' : 'tối'}
            </button>
          </section>

          <section className="panel-section" aria-labelledby="preferences-heading">
            <h2 id="preferences-heading" className="section-heading">Tùy chọn học tập</h2>
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
        </div>
      )}
    </main>
  );
};

function ModuleCard({ className, title, module }: {
  className: string;
  title: string;
  module: { name: string; version: string };
}) {
  return (
    <div className="module-card">
      <div className={`module-card__title ${className}`}>{title}</div>
      <div className="module-card__meta">Mô-đun: {module.name} (v{module.version})</div>
    </div>
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
    transcriptUpload: 'Transcript', sessionStart: 'Phiên học', segmentCreate: 'Phân đoạn',
    quizGenerate: 'Bài kiểm tra', answerSubmit: 'Câu trả lời', historyLoad: 'Lịch sử',
  }[operation];
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

async function loadThemePreference(): Promise<ThemeMode> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return 'dark';
  try {
    const stored = await chrome.storage.local.get(THEME_STORAGE_KEY) as Record<string, unknown>;
    return stored[THEME_STORAGE_KEY] === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

async function saveThemePreference(theme: ThemeMode): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  try {
    await chrome.storage.local.set({ [THEME_STORAGE_KEY]: theme });
  } catch {
    // A visual preference must never block activation or the rest of the panel.
  }
}
