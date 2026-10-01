import { describe, expect, it } from 'vitest';
import {
  type TranscriptAdapterEnvironment,
  YoutubeTranscriptDomAdapter,
} from '../youtube-transcript-adapter';
import type { RawTranscriptCue } from '../transcript-reader';

class FakeTranscriptEnvironment implements TranscriptAdapterEnvironment {
  public cues: RawTranscriptCue[] = [];
  public language = 'en';
  public readDirectTranscript?: () => Promise<import('../transcript-reader').TranscriptReadResult | null>;
  public triggerDomTranscriptExpansion?: () => void;
  public ignoreInitialDomTranscript?: boolean;
  private listener: (() => void) | null = null;
  private readonly queued: Array<() => void> = [];

  public createSource() {
    return {
      getLanguage: () => this.language,
      readRawCues: () => this.cues,
    };
  }

  public subscribeDomChanges(listener: () => void) {
    this.listener = listener;
    return () => { this.listener = null; };
  }

  public schedule(callback: () => void) { this.queued.push(callback); }
  public triggerDomChange() { this.listener?.(); }
  public flushNext() { this.queued.shift()?.(); }
  public flush() { while (this.queued.length > 0) this.queued.shift()?.(); }
}

const availableCues: RawTranscriptCue[] = [
  { startMs: 0, endMs: 10_000, text: 'A sufficiently long transcript cue explains how routing works in a network.' },
  { startMs: 10_000, endMs: 20_000, text: 'A second sufficiently long transcript cue preserves timestamp evidence for learning.' },
];

describe('YoutubeTranscriptDomAdapter', () => {
  it('retries when a transcript panel appears after the initial DOM read', () => {
    const environment = new FakeTranscriptEnvironment();
    const updates: string[] = [];
    const adapter = new YoutubeTranscriptDomAdapter(environment);

    adapter.start((result) => updates.push(result.status));
    environment.flush();
    environment.cues = availableCues;
    environment.triggerDomChange();
    environment.flush();

    expect(updates).toEqual(['unavailable', 'available']);
  });

  it('previews short DOM captions without treating character count as completeness', () => {
    const environment = new FakeTranscriptEnvironment();
    environment.cues = [{ startMs: 0, endMs: 2_000, text: 'Short caption.' }];
    const updates: string[] = [];
    new YoutubeTranscriptDomAdapter(environment).start((result, origin) => updates.push(`${origin}:${result.status}`));
    environment.flush();
    expect(updates).toEqual(['dom:available']);
  });

  it('uses direct timedtext before requesting a DOM transcript panel', async () => {
    const environment = new FakeTranscriptEnvironment();
    let openedDom = false;
    environment.readDirectTranscript = async () => ({ status: 'available', language: 'en', cues: availableCues.map((cue) => ({ startMs: cue.startMs, endMs: cue.endMs!, text: cue.text })) });
    environment.triggerDomTranscriptExpansion = () => { openedDom = true; };
    const updates: string[] = [];
    new YoutubeTranscriptDomAdapter(environment).start((result) => updates.push(result.status));
    environment.flush();
    await Promise.resolve();
    expect(updates).toEqual(['available']);
    expect(openedDom).toBe(false);
  });

  it('waits for caption metadata to appear and then reads the full direct track', async () => {
    const environment = new FakeTranscriptEnvironment();
    let attempts = 0;
    let openedDom = false;
    environment.readDirectTranscript = async () => {
      attempts += 1;
      return attempts < 3 ? null : {
        status: 'available', language: 'en',
        cues: availableCues.map((cue) => ({ startMs: cue.startMs, endMs: cue.endMs!, text: cue.text })),
      };
    };
    environment.triggerDomTranscriptExpansion = () => { openedDom = true; };
    const updates: string[] = [];
    new YoutubeTranscriptDomAdapter(environment).start((result, origin) => updates.push(`${origin}:${result.status}`));
    for (let index = 0; index < 8; index += 1) {
      environment.flush();
      await Promise.resolve();
      await Promise.resolve();
    }
    expect(attempts).toBe(3);
    expect(updates).toEqual(['timedtext:available']);
    expect(openedDom).toBe(false);
  });

  it('does not exhaust metadata retries from DOM mutations before the retry delay', async () => {
    const environment = new FakeTranscriptEnvironment();
    let attempts = 0;
    environment.readDirectTranscript = async () => {
      attempts += 1;
      return null;
    };
    new YoutubeTranscriptDomAdapter(environment).start(() => {});
    environment.flushNext();
    await Promise.resolve();
    environment.triggerDomChange();
    environment.triggerDomChange();
    environment.flushNext();
    expect(attempts).toBe(1);
    environment.flushNext();
    await Promise.resolve();
    expect(attempts).toBe(2);
  });

  it('ignores a direct response after disposal', async () => {
    const environment = new FakeTranscriptEnvironment();
    let resolveRead: ((value: import('../transcript-reader').TranscriptReadResult) => void) | undefined;
    environment.readDirectTranscript = () => new Promise((resolve) => { resolveRead = resolve; });
    const updates: string[] = [];
    const adapter = new YoutubeTranscriptDomAdapter(environment);
    adapter.start((result) => updates.push(result.status));
    environment.flush();
    adapter.dispose();
    resolveRead?.({ status: 'available', language: 'en', cues: availableCues.map((cue) => ({ startMs: cue.startMs, endMs: cue.endMs!, text: cue.text })) });
    await Promise.resolve();
    expect(updates).toEqual([]);
  });

  it('does not fall back to a DOM transcript after direct timedtext succeeded', async () => {
    const environment = new FakeTranscriptEnvironment();
    environment.readDirectTranscript = async () => ({
      status: 'available',
      language: 'en',
      cues: availableCues.map((cue) => ({ startMs: cue.startMs, endMs: cue.endMs!, text: cue.text })),
    });
    const updates: string[] = [];
    new YoutubeTranscriptDomAdapter(environment).start((result) => updates.push(result.status));

    environment.flush();
    await Promise.resolve();
    environment.cues = [
      { startMs: 0, endMs: 10_000, text: 'This rendered panel must not create another capture after direct timedtext succeeded.' },
      { startMs: 10_000, endMs: 20_000, text: 'The public capture and its idempotency key belong to the direct transcript.' },
    ];
    environment.triggerDomChange();
    environment.flush();

    expect(updates).toEqual(['available']);
  });

  it('does not emit or upload again when rendered transcript content is unchanged', () => {
    const environment = new FakeTranscriptEnvironment();
    environment.cues = availableCues;
    const updates: string[] = [];
    const adapter = new YoutubeTranscriptDomAdapter(environment);

    adapter.start((result) => updates.push(result.status));
    environment.flush();
    environment.triggerDomChange();
    environment.triggerDomChange();
    environment.flush();

    expect(updates).toEqual(['available']);
  });

  it('does not reuse a rendered transcript left behind by the previous video', () => {
    const environment = new FakeTranscriptEnvironment();
    environment.cues = availableCues;
    environment.ignoreInitialDomTranscript = true;
    const updates: string[] = [];
    const adapter = new YoutubeTranscriptDomAdapter(environment);

    adapter.start((result) => updates.push(result.status));
    environment.flush();

    expect(updates).toEqual([]);

    environment.cues = [
      { startMs: 0, endMs: 10_000, text: 'The replacement video has different caption evidence after the YouTube panel refreshes.' },
      { startMs: 10_000, endMs: 20_000, text: 'This proves the new transcript is not the panel that belonged to the old video.' },
    ];
    environment.triggerDomChange();
    environment.flush();

    expect(updates).toEqual(['available']);
  });

  it('cancels a scheduled stale read after dispose', () => {
    const environment = new FakeTranscriptEnvironment();
    const adapter = new YoutubeTranscriptDomAdapter(environment);
    const updates: string[] = [];

    adapter.start((result) => updates.push(result.status));
    adapter.dispose();
    environment.flush();

    expect(updates).toEqual([]);
  });
});
