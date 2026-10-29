import React, { useEffect, useRef, useState } from 'react';
import {
  AssessmentHistoryApi,
  AssessmentPanel,
  GradeResult,
  HistoryLoadPanel,
  INITIAL_HISTORY_LOAD_STATE,
  type GradeView,
  type LocalAnswerSubmission,
  type QuestionSourceRef,
  type QuizAttemptView,
  type QuizAvailable,
  historyLoadFailed,
  historyLoadStarted,
  historyLoadSucceeded,
  isValidEvidenceTarget,
  youtubeEvidenceUrl,
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
  shouldApplyActiveTabMessage,
  type ActivationState,
  type LearningPreferences,
} from '../features/video-activation';
import { httpClient } from '../shared/http/http-client';
import { messageBus } from '../shared/messaging/message-bus';
import type { ExtensionMessage } from '../shared/messaging/message-types';
import { isOperationStatusMessage, type OperationStatusPayload, type StudyLensOperation } from '../shared/messaging/operation-status';
import { formatElapsedWait, resolveProcessingStage } from './processing-stage';
import { accountBridge, type AccountStatus } from '../features/account/account-worker-bridge';

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
  const [historyState, setHistoryState] = useState(INITIAL_HISTORY_LOAD_STATE);
  const [operationStatuses, setOperationStatuses] = useState<Partial<Record<StudyLensOperation, OperationStatusPayload>>>({});
  const [learningPreferences, setLearningPreferences] = useState<LearningPreferences>(DEFAULT_LEARNING_PREFERENCES);
  const [preferencesStatus, setPreferencesStatus] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading');
  const [preferencesError, setPreferencesError] = useState<string | null>(null);
  const [accountStatus, setAccountStatus] = useState<AccountStatus>({ authenticated: false });
  const [accountBusy, setAccountBusy] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authUsername, setAuthUsername] = useState('');
  const [authDisplayName, setAuthDisplayName] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authPasswordConfirmation, setAuthPasswordConfirmation] = useState('');
  const [showAuthPassword, setShowAuthPassword] = useState(false);
  const [accountFormError, setAccountFormError] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirmation, setNewPasswordConfirmation] = useState('');
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
    void refreshAccount();
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

  const transcriptDetails = learningPackage?.transcript.status === 'ready'
    ? { cues: learningPackage.transcript.cues }
    : localTranscript?.status === 'available'
      ? { cues: localTranscript.cues }
      : null;
  const transcriptStatusText = learningPackage?.transcript.status === 'ready'
    ? learningPackage.transcript.cues.length > 0
      ? `Đã lưu từ ${learningPackage.transcript.source === 'geminiVideo' ? 'Gemini video' : 'phụ đề YouTube'}.`
      : 'Chưa có đoạn transcript được lưu.'
    : localTranscript?.status === 'available'
      ? 'Đã đọc phụ đề YouTube; đang đồng bộ với Backend.'
      : activationState.status !== 'active'
        ? 'Chưa có transcript.'
        : learningPackage?.transcript.status === 'failed' || learningPackage?.transcript.status === 'unavailable'
          ? 'Không thể lấy transcript cho video này.'
          : 'Đang lấy transcript…';

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
      if (!shouldApplyActiveTabMessage(activeContext, message)) return;
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
      if (type === 'STUDYLENS_ACCOUNT_CHANGED') {
        resetVideoScopedPanelState();
        setHistoryState(INITIAL_HISTORY_LOAD_STATE);
        void refreshAccount();
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const checkHealth = async () => {
    setBackendStatus('checking');
    setBackendError(null);
    try {
      await httpClient.get<BackendHealthResponse>('api/health');
      setBackendStatus('connected');
    } catch (error: unknown) {
      setBackendStatus('error');
      setBackendError(messageOf(error, 'Không thể kết nối tới StudyLens API.'));
    }
  };

  const refreshAccount = async () => {
    setAccountStatus(await accountBridge.status());
  };

  const submitAuthentication = async (event: React.FormEvent) => {
    event.preventDefault();
    setAccountFormError(null);
    if (authMode === 'register' && authPassword !== authPasswordConfirmation) {
      setAccountFormError('Mật khẩu xác nhận không khớp.');
      return;
    }
    setAccountBusy(true);
    try {
      const next = authMode === 'login'
        ? await accountBridge.signIn(authUsername, authPassword)
        : await accountBridge.register(authUsername, authPassword, authDisplayName);
      setAccountStatus(next);
      if (next.error) setAccountFormError(next.error);
      if (next.authenticated) {
        setAuthPassword('');
        setAuthPasswordConfirmation('');
        void refreshActiveYoutubeContext();
      }
    } finally {
      setAccountBusy(false);
    }
  };

  const submitPasswordChange = async (event: React.FormEvent) => {
    event.preventDefault();
    setAccountFormError(null);
    if (newPassword !== newPasswordConfirmation) {
      setAccountFormError('Mật khẩu mới xác nhận không khớp.');
      return;
    }
    setAccountBusy(true);
    try {
      const next = await accountBridge.changePassword(currentPassword, newPassword);
      setAccountStatus(next);
      if (next.error) setAccountFormError(next.error);
      else {
        setCurrentPassword(''); setNewPassword(''); setNewPasswordConfirmation('');
        setActiveTab('study');
      }
    } finally {
      setAccountBusy(false);
    }
  };

  const signOut = async () => {
    setAccountBusy(true);
    try {
      setAccountStatus(await accountBridge.signOut());
      resetVideoScopedPanelState();
      setHistoryState(INITIAL_HISTORY_LOAD_STATE);
    } finally {
      setAccountBusy(false);
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
    if (!context || !isValidEvidenceTarget(context.youtubeVideoId, timestampMs)) return;
    setSeekError(null);
    const result = await seekActivePlayer(context.youtubeVideoId, timestampMs);
    if (!result.ok) setSeekError(`Không thể tua video đến mốc đã chọn (${result.code ?? 'seekFailed'}).`);
  };

  const reviewEvidence = async (youtubeVideoId: string, timestampMs: number) => {
    if (!isValidEvidenceTarget(youtubeVideoId, timestampMs)) {
      setSeekError('Không thể mở video tại mốc đã lưu.');
      return;
    }
    const activeContext = activationState.context;
    if (activeContext?.youtubeVideoId === youtubeVideoId) {
      await seekToTranscriptCue(timestampMs);
      return;
    }

    const url = youtubeEvidenceUrl(youtubeVideoId, timestampMs);
    if (!url || typeof chrome === 'undefined' || !chrome.tabs?.create) {
      setSeekError('Không thể mở video tại mốc đã lưu.');
      return;
    }
    setSeekError(null);
    try {
      await chrome.tabs.create({ url });
    } catch {
      setSeekError('Không thể mở video tại mốc đã lưu.');
    }
  };

  const refreshHistoryTab = async () => {
    setHistoryState(historyLoadStarted);
    try {
      setHistoryState(historyLoadSucceeded(await assessmentHistoryApi.getHistory()));
    } catch (error: unknown) {
      const message = messageOf(error, 'Không thể tải lịch sử học tập.');
      setHistoryState((state) => historyLoadFailed(state, message));
    }
  };

  const retryOperation = async (operation: StudyLensOperation | ProcessingOperation) => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
    const response = await chrome.runtime.sendMessage({ type: 'STUDYLENS_RETRY_OPERATION', operation }) as { ok?: boolean; code?: string } | undefined;
    if (!response?.ok) setLearningPackageError(response?.code ?? 'retryFailed');
    else void refreshLearningPackage();
  };

  const requestManualActivation = async (requestedState: 'on' | 'off') => {
    if (requestedState === 'on' && !accountStatus.authenticated) {
      setActivationCommandStatus('error');
      setActivationCommandError('Hãy đăng nhập StudyLens trước khi bắt đầu phiên học.');
      return;
    }
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

      {!accountStatus.authenticated ? (
        <section className="panel-section account-gate" aria-labelledby="account-heading">
          <h2 id="account-heading" className="section-heading">{authMode === 'login' ? 'Đăng nhập để học' : 'Tạo tài khoản StudyLens'}</h2>
          <p className="section-copy">Lịch sử, quiz và quota được tách riêng theo tài khoản.</p>
          <div className="auth-mode-switch" role="tablist" aria-label="Chọn thao tác tài khoản">
            <button type="button" role="tab" aria-selected={authMode === 'login'} className={authMode === 'login' ? 'auth-mode-switch__active' : ''} onClick={() => { setAuthMode('login'); setAccountFormError(null); }}>Đăng nhập</button>
            <button type="button" role="tab" aria-selected={authMode === 'register'} className={authMode === 'register' ? 'auth-mode-switch__active' : ''} onClick={() => { setAuthMode('register'); setAccountFormError(null); }}>Đăng ký</button>
          </div>
          <form className="account-form" onSubmit={(event) => void submitAuthentication(event)}>
            <label>Tên đăng nhập<input required minLength={3} maxLength={32} pattern="[A-Za-z0-9._-]+" autoComplete="username" value={authUsername} onChange={(event) => setAuthUsername(event.target.value)} /></label>
            {authMode === 'register' ? <label>Tên hiển thị<input required minLength={1} maxLength={200} autoComplete="name" value={authDisplayName} onChange={(event) => setAuthDisplayName(event.target.value)} /></label> : null}
            <label>Mật khẩu<input required minLength={authMode === 'register' ? 15 : 1} maxLength={128} type={showAuthPassword ? 'text' : 'password'} autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} /></label>
            {authMode === 'register' ? <label>Xác nhận mật khẩu<input required minLength={15} maxLength={128} type={showAuthPassword ? 'text' : 'password'} autoComplete="new-password" value={authPasswordConfirmation} onChange={(event) => setAuthPasswordConfirmation(event.target.value)} /></label> : null}
            <label className="account-form__checkbox"><input type="checkbox" checked={showAuthPassword} onChange={(event) => setShowAuthPassword(event.target.checked)} /> Hiện mật khẩu</label>
            <p className="account-form__hint">Tên đăng nhập dùng 3–32 ký tự chữ, số, dấu chấm, gạch dưới hoặc gạch ngang. Mật khẩu đăng ký cần ít nhất 15 ký tự.</p>
            {accountFormError || accountStatus.error ? <p className="health-error" role="alert">{accountFormError ?? accountStatus.error}</p> : null}
            <button type="submit" className="primary-button" disabled={accountBusy}>{accountBusy ? 'Đang xử lý…' : authMode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'}</button>
          </form>
        </section>
      ) : null}

      {!accountStatus.authenticated ? null : activeTab === 'study' ? (
        <div id="study-panel" role="tabpanel">
          <section className="learning-hero">
            <div className="learning-hero__play" aria-hidden="true"><span /></div>
            <div className="learning-hero__content">
              <h2>Bài giảng: {activationState.context?.title ?? 'Chọn video để học'}</h2>
              {!activationState.context ? <p>Mở một video YouTube để bắt đầu.</p> : null}
            </div>
          </section>

          {activationState.status !== 'active' ? (
            <section className="panel-section activation-prompt" aria-labelledby="activation-heading">
              <div><h2 id="activation-heading" className="section-heading">Trạng thái xử lý</h2><p className="study-cycle__stage">StudyLens đang tắt</p></div>
              <button type="button" className="primary-button" disabled={activationCommandStatus === 'sending'} onClick={() => void requestManualActivation('on')}>Bật StudyLens</button>
              {activationCommandError ? <p className="health-error" role="alert">{activationCommandError}</p> : null}
            </section>
          ) : activationState.context && (!quiz || learningPackageError) ? (
            <ProcessingProgressCard activationState={activationState} learningPackage={learningPackage} statuses={operationStatuses} loadingError={learningPackageError} onRetry={retryOperation} onRefresh={() => void refreshLearningPackage()} />
          ) : null}

          {backendStatus === 'error' ? (
            <section className="panel-section connection-alert" role="alert">
              <p>Không thể kết nối StudyLens. Vui lòng kiểm tra kết nối và thử lại.</p>
              <button type="button" className="secondary-button" onClick={() => void checkHealth()}>Thử lại</button>
              {backendError ? <span className="visually-hidden">{backendError}</span> : null}
            </section>
          ) : null}

          <section className="panel-section" aria-labelledby="transcript-preview-heading">
            <TranscriptPreview details={transcriptDetails} currentTimeMs={playerTimeMs} statusText={transcriptStatusText} onSeek={(timestampMs) => void seekToTranscriptCue(timestampMs)} />
            {seekError ? <p className="health-error" role="alert">{seekError}</p> : null}
          </section>

          <section className="panel-section processing-overview" aria-labelledby="processing-overview-heading">
            <h2 id="processing-overview-heading" className="section-heading">Trạng thái xử lý</h2>
            <ProcessingStages active={activationState.status === 'active'} learningPackage={learningPackage} />
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
                  <AssessmentPanel key={quiz.quizId} quiz={quiz} submitAttempt={submitAssessmentAttempt} onOperationStatus={(status) => setOperationStatuses((current) => ({ ...current, [status.operation]: status }))} onAttempt={handleAttempt} onSeekEvidence={(source: QuestionSourceRef) => void reviewEvidence(source.youtubeVideoId, source.startMs)} />
                </>
              )}
            </section>
          ) : null}
        </div>
      ) : activeTab === 'history' ? (
        <div id="history-panel" role="tabpanel" className="history-view">
          <section className="panel-section"><h2 className="section-heading">Kết quả gần nhất</h2>{latestGrade ? <GradeResult grade={latestGrade} /> : <p className="section-copy">Chưa có kết quả chấm điểm.</p>}</section>
          <section className="panel-section">
            <div className="section-heading-row"><h2 className="section-heading">Lịch sử học tập</h2><button type="button" className="secondary-button" onClick={() => void refreshHistoryTab()} disabled={historyState.status === 'loading'}>{historyState.status === 'loading' ? 'Đang tải…' : 'Làm mới'}</button></div>
            <HistoryLoadPanel state={historyState} onRetry={() => void refreshHistoryTab()} onReviewEvidence={(videoId, timestampMs) => void reviewEvidence(videoId, timestampMs)} />
            {seekError ? <p className="health-error" role="alert">{seekError}</p> : null}
          </section>
        </div>
      ) : (
        <div id="settings-panel" role="tabpanel" className="settings-view">
          {accountStatus.authenticated && accountStatus.account ? (
            <section className="panel-section account-settings" aria-labelledby="account-settings-heading">
              <div className="section-heading-row"><div><h2 id="account-settings-heading" className="section-heading">Tài khoản</h2><p className="account-settings__name">{accountStatus.account.displayName}</p></div><button type="button" className="secondary-button" disabled={accountBusy} onClick={() => void signOut()}>Đăng xuất</button></div>
              {accountStatus.quota?.length ? <div className="quota-summary"><h3>Lượt còn hôm nay</h3><dl>{accountStatus.quota.map((item) => <div key={item.resourceType}><dt>{quotaLabel(item.resourceType)}</dt><dd>{item.remaining}/{item.limit}</dd></div>)}</dl></div> : null}
              <details className="account-security">
                <summary>Đổi mật khẩu</summary>
                <form className="account-form" onSubmit={(event) => void submitPasswordChange(event)}>
                  <label>Mật khẩu hiện tại<input required maxLength={128} type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
                  <label>Mật khẩu mới<input required minLength={15} maxLength={128} type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
                  <label>Xác nhận mật khẩu mới<input required minLength={15} maxLength={128} type="password" autoComplete="new-password" value={newPasswordConfirmation} onChange={(event) => setNewPasswordConfirmation(event.target.value)} /></label>
                  {accountFormError ? <p className="health-error" role="alert">{accountFormError}</p> : null}
                  <button type="submit" className="secondary-button" disabled={accountBusy}>Đổi mật khẩu</button>
                  <p className="account-form__hint">Quên mật khẩu? Liên hệ người quản trị.</p>
                </form>
              </details>
            </section>
          ) : null}
          <section className="panel-section learning-toggle-card" aria-labelledby="learning-settings-heading">
            <div className="setting-toggle-row"><h2 id="learning-settings-heading" className="section-heading">Học cùng StudyLens</h2><ActivationToggle active={activationState.status === 'active'} disabled={activationCommandStatus === 'sending'} onRequest={requestManualActivation} /></div>
            {activationCommandError ? <p className="health-error" role="alert">{activationCommandError}</p> : null}
            {activationCommandNotice ? <p className="section-copy section-copy--warning">{activationCommandNotice}</p> : null}
          </section>
          <section className="panel-section learning-preferences-card"><h2 className="section-heading">Tùy chọn bài kiểm tra</h2>{preferencesStatus === 'loading' ? <p className="section-copy">Đang tải…</p> : <LearningPreferencesForm preferences={learningPreferences} saving={preferencesStatus === 'saving'} error={preferencesError} onSave={saveLearningPreferences} />}</section>
        </div>
      )}
    </main>
  );
};

function ProcessingProgressCard({ activationState, learningPackage, statuses, loadingError, onRetry, onRefresh }: {
  activationState: ActivationState;
  learningPackage: LearningPackage | null;
  statuses: Partial<Record<StudyLensOperation, OperationStatusPayload>>;
  loadingError: string | null;
  onRetry: (operation: StudyLensOperation | ProcessingOperation) => Promise<void>;
  onRefresh: () => void;
}) {
  const stage = resolveProcessingStage(activationState, learningPackage);
  const [stageStartedAt, setStageStartedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const changedAt = Date.now();
    setStageStartedAt(changedAt);
    setNow(changedAt);
  }, [stage.code]);

  useEffect(() => {
    if (!stage.waiting) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [stage.waiting, stage.code]);

  return (
    <section className="panel-section study-cycle" aria-labelledby="study-cycle-heading">
      <div className="section-heading-row"><h2 id="study-cycle-heading" className="section-heading">Tiến trình học</h2>{stage.waiting ? <strong>{formatElapsedWait(now - stageStartedAt)}</strong> : null}</div>
      <p className={`study-cycle__stage study-cycle__stage--${stage.code}`} role="status" aria-live="polite">{stage.label}</p>
      <p className="section-copy">{stage.summary}</p>
      {learningPackage?.error ? (
        <div className="operation-status operation-status--failed" role="alert">
          <strong>{operationLabel(learningPackage.error.operation)}</strong>
          <span>{learningPackage.error.code === 'providerRateLimited'
            ? 'Dịch vụ tạo câu hỏi đang quá tải. Vui lòng thử lại sau.'
            : learningPackage.error.message}</span>
          {learningPackage.error.retryable ? <button type="button" className="operation-status__retry" onClick={() => void onRetry(learningPackage.error!.operation)}>Thử lại</button> : null}
        </div>
      ) : null}
      <OperationStatusList statuses={statuses} excludeOperation={learningPackage?.error?.operation} onRetry={onRetry} />
      {loadingError ? <div className="connection-alert" role="alert"><p>Không thể cập nhật tiến trình học.</p><button type="button" className="secondary-button" onClick={onRefresh}>Thử lại</button></div> : null}
    </section>
  );
}

function ProcessingStages({ active, learningPackage }: { active: boolean; learningPackage: LearningPackage | null }) {
  const transcriptReady = learningPackage?.transcript.status === 'ready';
  const quizReady = learningPackage?.quizStatus === 'ready';
  const transcriptActive = active && !transcriptReady;
  const quizActive = transcriptReady && !quizReady && learningPackage?.quizStatus !== 'failed';
  return (
    <div className="processing-stages" aria-label="Các bước tạo bài kiểm tra">
      <span className={transcriptReady ? 'processing-stage processing-stage--done' : transcriptActive ? 'processing-stage processing-stage--active' : 'processing-stage'}>{transcriptReady ? '✓ Transcript đã sẵn sàng' : transcriptActive ? '1 · Đang xử lý transcript' : '1 · Transcript'}</span>
      <span className={quizReady ? 'processing-stage processing-stage--done' : quizActive ? 'processing-stage processing-stage--active' : 'processing-stage'}>{quizReady ? '✓ Quiz đã sẵn sàng' : quizActive ? '2 · Đang tạo quiz' : '2 · Quiz'}</span>
    </div>
  );
}

function OperationStatusList({ statuses, excludeOperation, onRetry }: { statuses: Partial<Record<StudyLensOperation, OperationStatusPayload>>; excludeOperation?: StudyLensOperation | ProcessingOperation; onRetry: (operation: StudyLensOperation | ProcessingOperation) => Promise<void> }) {
  const values = (Object.values(statuses).filter(Boolean) as OperationStatusPayload[])
    .filter((status) => status.state === 'failed' && status.operation !== excludeOperation);
  if (values.length === 0) return null;
  return <div className="operation-status-list">{values.map((status) => <div className="operation-status operation-status--failed" key={status.operation} role="alert"><strong>{operationLabel(status.operation)}</strong><span>{status.message}</span>{status.retryable && status.operation !== 'answerSubmit' ? <button type="button" className="operation-status__retry" onClick={() => void onRetry(status.operation)}>Thử lại</button> : null}</div>)}</div>;
}

function operationLabel(operation: StudyLensOperation | ProcessingOperation): string {
  return { transcriptUpload: 'Gửi transcript', transcriptGenerate: 'Tạo transcript dự phòng', sessionStart: 'Tạo phiên học', quizGenerate: 'Tạo quiz', answerSubmit: 'Nộp bài', historyLoad: 'Lịch sử' }[operation];
}

function quotaLabel(resourceType: string): string {
  return { quizGenerate: 'Bài kiểm tra', transcriptGenerate: 'Video không phụ đề', shortAnswerGrade: 'Câu tự luận' }[resourceType] ?? resourceType;
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
