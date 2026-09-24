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
