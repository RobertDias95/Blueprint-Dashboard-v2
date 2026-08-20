// ===========================================================================
// ★★ fix-369 — the ding
// ===========================================================================
//
// Bobby: "an auditory ding, similar to how Teams works."
//
// ★★ SYNTHESISED, NOT A FILE. Two short notes from a WebAudio oscillator —
// about 400 bytes of code and no asset at all.
//
// The alternative was committing an mp3, and it is worse in three ways: a
// binary blob whose provenance and licence nobody can check from the repo, a
// network fetch at the exact moment something urgent has happened, and a thing
// no test can assert anything about beyond "the file exists". The two
// frequencies below ARE the sound, so a test can hold what it is — and if
// Bobby wants a different one it is two numbers, not a sourcing exercise.
//
// ★ A rising minor third (A5 → C#6), short and soft. Rising reads as "here is
// something" where falling reads as "something went wrong"; 0.22s total is
// under the length at which a sound starts to feel like an alarm; peak gain
// 0.07 is quiet enough to sit under a call.

/** ★ The sound, as data. Held here so the test asserts the sound rather than
 *  asserting that a function was called. */
export const DING_TONES: ReadonlyArray<{ hz: number; at: number; for: number }> = [
  { hz: 880, at: 0, for: 0.12 },
  { hz: 1108.73, at: 0.09, for: 0.13 },
];

export const DING_PEAK_GAIN = 0.07;

/** The slice of AudioContext this needs. Structural so a test can pass a
 *  double, and so nothing here depends on a DOM that jsdom does not have. */
export interface DingContext {
  currentTime: number;
  state: string;
  destination: unknown;
  resume(): Promise<void>;
  createOscillator(): {
    type: string;
    frequency: { value: number };
    connect(node: unknown): void;
    start(at: number): void;
    stop(at: number): void;
  };
  createGain(): {
    gain: {
      value: number;
      setValueAtTime(v: number, at: number): void;
      exponentialRampToValueAtTime(v: number, at: number): void;
    };
    connect(node: unknown): void;
  };
}

/**
 * ★★ THE AUDIO CONTEXT IS CREATED ON A CLICK, NOT ON LOAD.
 *
 * Every browser suspends an AudioContext that was constructed without a user
 * gesture, and a suspended context plays nothing — silently, with no error. So
 * the context is made when the person turns the preference on, which is a click
 * by construction, and `playDing` resumes it defensively in case the tab was
 * backgrounded long enough for the browser to suspend it again.
 *
 * ★ It is also why this module holds one context rather than making one per
 * ding: contexts are a limited resource (~6 per tab in Chrome) and a leak here
 * would end in a notification that stops making a sound after an hour.
 */
let shared: DingContext | null = null;

type ContextCtor = new () => DingContext;

/** Called from a click handler. Returns null where WebAudio does not exist. */
export function ensureDingContext(): DingContext | null {
  if (shared) return shared;
  if (typeof window === 'undefined') return null;
  const Ctor =
    (window as unknown as { AudioContext?: ContextCtor }).AudioContext ??
    (window as unknown as { webkitAudioContext?: ContextCtor }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    shared = new Ctor();
  } catch {
    return null;
  }
  return shared;
}

/** ★ Test seam, and the reason the module-level context is not a problem. */
export function __setDingContextForTest(ctx: DingContext | null): void {
  shared = ctx;
}

/** Plays the two tones. Silent and harmless when there is no context — a
 *  person who never enabled anything, or a browser without WebAudio. */
export function playDing(ctx: DingContext | null = shared): void {
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') void ctx.resume();
    for (const tone of DING_TONES) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = tone.hz;
      const start = ctx.currentTime + tone.at;
      const end = start + tone.for;
      gain.gain.setValueAtTime(DING_PEAK_GAIN, start);
      // ★ Ramped to near-silence rather than cut, because an oscillator stopped
      // at full amplitude produces a click, which is the sound of a bug.
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(end);
    }
  } catch {
    /* ★ A sound is an enhancement. It never breaks the notification. */
  }
}
