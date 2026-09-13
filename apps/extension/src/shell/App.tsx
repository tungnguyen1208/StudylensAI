import React, { useState, useEffect } from 'react';
import { httpClient } from '../shared/http/http-client';
import { initializeFeatureRegistry, RegisteredFeatures } from './feature-registry';
import {
  ActivationStatus,
  ActivationToggle,
  applyVideoActivationMessage,
  initialActivationState,
  type ActivationState,
} from '../features/video-activation';
import { messageBus } from '../shared/messaging/message-bus';
import type { ExtensionMessage } from '../shared/messaging/message-types';
interface BackendHealthResponse {
  status: string;
  service: string;
  aiService?: {
    status: string;
    service: string;
  };
}

export const App: React.FC = () => {
  const [features, setFeatures] = useState<RegisteredFeatures | null>(null);
  const [backendStatus, setBackendStatus] = useState<'idle' | 'checking' | 'connected' | 'error'>('idle');
  const [backendData, setBackendData] = useState<BackendHealthResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activationState, setActivationState] = useState<ActivationState>(initialActivationState);
  const [activationCommandStatus, setActivationCommandStatus] = useState<'idle' | 'sending' | 'error'>('idle');
  const [activationCommandError, setActivationCommandError] = useState<string | null>(null);
  useEffect(() => {
    const registered = initializeFeatureRegistry();
    setFeatures(registered);
    checkHealth();
  }, []);

  useEffect(() => {
    const onActivationMessage = (message: ExtensionMessage) => {
      setActivationState((state) => applyVideoActivationMessage(state, message));
    };
    const unsubscribers = [
      messageBus.subscribe('VIDEO_CONTEXT_CHANGED', onActivationMessage),
      messageBus.subscribe('ACTIVATION_DECIDED', onActivationMessage),
      messageBus.subscribe('ACTIVATION_STOPPED', onActivationMessage),
    ];
    void loadActiveYoutubeContext(onActivationMessage);
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, []);
  const checkHealth = async () => {
    setBackendStatus('checking');
    setErrorMessage(null);
    try {
      // Call Backend health proxy endpoint
      const result = await httpClient.get<BackendHealthResponse>('api/health');
      setBackendData(result);
      setBackendStatus('connected');
    } catch (err: unknown) {
      setBackendStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Failed to connect to StudyLens API');
    }
  };

  const requestManualActivation = async (requestedState: 'on' | 'off') => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      setActivationCommandStatus('error');
      setActivationCommandError('Chrome/Edge extension runtime is unavailable.');
      return;
    }
    setActivationCommandStatus('sending');
    setActivationCommandError(null);
    try {
      const response = await chrome.runtime.sendMessage({ type: 'STUDYLENS_MANUAL_TOGGLE', requestedState }) as { ok?: boolean; code?: string };
      if (!response?.ok) throw new Error(response?.code ?? 'manualActivationUnavailable');
      setActivationCommandStatus('idle');
    } catch (error: unknown) {
      setActivationCommandStatus('error');
      setActivationCommandError(error instanceof Error ? error.message : 'Unable to update StudyLens.');
    }
  };
  return (
    <div style={{ padding: '20px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <header style={{ borderBottom: '1px solid #334155', paddingBottom: '12px', marginBottom: '16px' }}>
        <h1 style={{ fontSize: '20px', margin: 0, color: '#38bdf8' }}>StudyLens AI</h1>
        <p style={{ fontSize: '12px', color: '#94a3b8', margin: '4px 0 0 0' }}>
          Walking Skeleton Framework (v0.1.0)
        </p>
      </header>

      <section style={{ marginBottom: '20px', background: '#1e293b', padding: '14px', borderRadius: '8px' }}>
        <h2 style={{ fontSize: '14px', margin: '0 0 10px 0', color: '#f1f5f9' }}>System Health</h2>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <span style={{ fontSize: '13px', color: '#cbd5e1' }}>ASP.NET Core Backend:</span>
          <span
            style={{
              padding: '2px 8px',
              borderRadius: '4px',
              fontSize: '11px',
              fontWeight: 'bold',
              backgroundColor:
                backendStatus === 'connected' ? '#065f46' : backendStatus === 'checking' ? '#854d0e' : '#881337',
              color:
                backendStatus === 'connected' ? '#34d399' : backendStatus === 'checking' ? '#fde047' : '#fda4af',
            }}
          >
            {backendStatus.toUpperCase()}
          </span>
        </div>

        {backendData && (
          <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '6px' }}>
            <div>Service: {backendData.service}</div>
            {backendData.aiService && (
              <div>FastAPI AI: {backendData.aiService.status} ({backendData.aiService.service})</div>
            )}
          </div>
        )}

        {errorMessage && (
          <div style={{ fontSize: '12px', color: '#f87171', marginTop: '8px' }}>
            Error: {errorMessage}
          </div>
        )}

        <button
          onClick={checkHealth}
          disabled={backendStatus === 'checking'}
          style={{
            marginTop: '12px',
            width: '100%',
            padding: '8px',
            backgroundColor: '#0284c7',
            color: '#ffffff',
            border: 'none',
            borderRadius: '6px',
            cursor: backendStatus === 'checking' ? 'not-allowed' : 'pointer',
            fontSize: '12px',
            fontWeight: 500,
          }}
        >
          {backendStatus === 'checking' ? 'Checking...' : 'Check Backend Health'}
        </button>
      </section>

      <section style={{ marginBottom: '20px', background: '#1e293b', padding: '14px', borderRadius: '8px' }}>
        <h2 style={{ fontSize: '14px', margin: '0 0 10px 0', color: '#f1f5f9' }}>Manual StudyLens</h2>
        {activationState.context ? (
          <p style={{ fontSize: '12px', color: '#94a3b8' }}>Video: {activationState.context.title}</p>
        ) : (
          <p style={{ fontSize: '12px', color: '#fbbf24' }}>Open a supported YouTube watch page first.</p>
        )}
        <ActivationStatus state={activationState} />
        <ActivationToggle
          active={activationState.status === 'active'}
          disabled={!activationState.context || activationCommandStatus === 'sending'}
          onRequest={requestManualActivation}
        />
        {activationCommandError && <p role="alert" style={{ fontSize: '12px', color: '#f87171' }}>{activationCommandError}</p>}
      </section>
      <section style={{ background: '#1e293b', padding: '14px', borderRadius: '8px' }}>
        <h2 style={{ fontSize: '14px', margin: '0 0 10px 0', color: '#f1f5f9' }}>Modular Architecture Slices</h2>
        {features && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontSize: '12px', background: '#0f172a', padding: '8px', borderRadius: '4px' }}>
              <div style={{ fontWeight: 600, color: '#38bdf8' }}>Dev 1: Video Activation</div>
              <div style={{ color: '#64748b' }}>Module: {features.videoActivation.name} (v{features.videoActivation.version})</div>
            </div>
            <div style={{ fontSize: '12px', background: '#0f172a', padding: '8px', borderRadius: '4px' }}>
              <div style={{ fontWeight: 600, color: '#a855f7' }}>Dev 2: Session & Quiz</div>
              <div style={{ color: '#64748b' }}>Module: {features.sessionQuiz.name} (v{features.sessionQuiz.version})</div>
            </div>
            <div style={{ fontSize: '12px', background: '#0f172a', padding: '8px', borderRadius: '4px' }}>
              <div style={{ fontWeight: 600, color: '#34d399' }}>Dev 3: Assessment & History</div>
              <div style={{ color: '#64748b' }}>Module: {features.assessmentHistory.name} (v{features.assessmentHistory.version})</div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};

async function loadActiveYoutubeContext(onMessage: (message: ExtensionMessage) => void): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'STUDYLENS_GET_ACTIVE_CONTEXT' }) as {
      ok?: boolean;
      context?: ExtensionMessage;
    };
    if (response?.ok && response.context) onMessage(response.context);
  } catch {
    // The Side Panel remains usable and explains that no YouTube context is available.
  }
}
