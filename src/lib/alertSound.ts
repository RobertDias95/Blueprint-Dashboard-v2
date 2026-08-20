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
 * ★★★ fix-371 — WHY fix-369'S SOUND DID NOT PLAY, and it was not the policy.
 *
 * Bobby: *"i don't think i am hearing the sound every time i get a
 * notification"*, and the brief blamed `void ctx.resume()` swallowing a
 * rejection outside a user gesture. That is a real bug and it is fixed below,
 * but it is the second one. The first is simpler and total:
 *
 * ★★★ `playDing()` DEFAULTED TO `shared`, AND NOTHING BUT `DesktopAlertsControl`
 * EVER CREATED IT. `ensureDingContext()` was called in exactly two places, both
 * inside that component's click handlers. Every reload starts this module with
 * `shared === null`, so until the person navigated to /notifications and
 * clicked something, `playDing()` returned on its first line. **Not a quiet
 * ding — no ding at all, on every fresh load.** Which matches the report
 * exactly: it works right after you have clicked something, and not otherwise.
 *
 * ★★ SO THE UNLOCK MOVED TO THE GESTURE THAT ALREADY HAPPENS. hooks/useDingUnlock
 * arms one `pointerdown`/`keydown` listener at the shell, resumes the context on
 * the first click anywhere in the app, and removes itself. A person using the
 * app produces that gesture within seconds without being asked for one.
 *
 * ★ AND WHAT KEEPS IT ALIVE ACROSS A LONG IDLE. Chrome's autoplay policy is
 * per-PAGE and sticky: once the document has had a user gesture, `resume()`
 * succeeds from a timer for the rest of that document's life. So a context
 * unlocked by the first click stays resumable through any amount of idling, and
 * `playDing` resumes it again if the browser suspended it while backgrounded.
 * A reload resets both the module and the sticky activation, which is exactly
 * when the first-gesture listener arms again.
 *
 * ★★ AND A FAILED RESUME IS NO LONGER SILENT TO US. `void ctx.resume()`
 * discarded a rejected promise, so a blocked sound produced no sound, no error
 * and no trace. The rejection is now observed, recorded as `dingState`, and
 * surfaced by the control — "sound is blocked by the browser" is actionable,
 * nothing is not.
 *
 * ★ One context, not one per ding: they are a limited resource (~6 per tab in
 * Chrome) and a leak ends in a notification that stops making a sound after an
 * hour.
 */
let shared: DingContext | null = null;

/**
 * ★★ What we know about whether a ding can be heard.
 *
 *   'idle'        nothing has tried yet
 *   'unlocked'    a resume succeeded, or the context was born running
 *   'blocked'     ★ a resume was REJECTED — the browser is refusing
 *   'unsupported' no WebAudio in this browser at all
 */
export type DingState = 'idle' | 'unlocked' | 'blocked' | 'unsupported';

let dingState: DingState = 'idle';
const listeners = new Set<() => void>();

export function getDingState(): DingState {
  return dingState;
}

/** ★ So the control can re-render when a ding turns out to be blocked, without
 *  polling and without the sound module importing React. */
export function subscribeDingState(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function setDingState(next: DingState): void {
  if (dingState === next) return;
  dingState = next;
  for (const l of [...listeners]) l();
}

type ContextCtor = new () => DingContext;

/** Creates the context if there is not one. Safe to call from anywhere — a
 *  context made outside a gesture is simply born suspended, and `unlockDing`
 *  is what turns that around. Returns null where WebAudio does not exist. */
export function ensureDingContext(): DingContext | null {
  if (shared) return shared;
  if (typeof window === 'undefined') return null;
  const Ctor =
    (window as unknown as { AudioContext?: ContextCtor }).AudioContext ??
    (window as unknown as { webkitAudioContext?: ContextCtor }).webkitAudioContext;
  if (!Ctor) {
    setDingState('unsupported');
    return null;
  }
  try {
    shared = new Ctor();
  } catch {
    setDingState('unsupported');
    return null;
  }
  if (shared.state === 'running') setDingState('unlocked');
  return shared;
}

/**
 * ★★★ THE UNLOCK, AND ITS RESULT IS OBSERVED.
 *
 * Call it from a user gesture — the first click anywhere in the app, or the
 * "Turn on desktop alerts" button. `resume()` returns a promise that REJECTS
 * when the browser refuses; fix-369 wrote `void ctx.resume()`, which discarded
 * that rejection and left a blocked sound indistinguishable from a working one.
 *
 * ★ Resolves to what is now known, so a caller can say it out loud.
 */
export async function unlockDing(): Promise<DingState> {
  const ctx = ensureDingContext();
  if (!ctx) return 'unsupported';
  if (ctx.state === 'running') {
    setDingState('unlocked');
    return 'unlocked';
  }
  try {
    await ctx.resume();
    setDingState('unlocked');
    return 'unlocked';
  } catch {
    // ★ The fact the old code threw away. A person can act on this.
    setDingState('blocked');
    return 'blocked';
  }
}

/** ★ Test seam, and the reason the module-level context is not a problem. */
export function __setDingContextForTest(ctx: DingContext | null): void {
  shared = ctx;
  dingState = 'idle';
}

/**
 * Plays the two tones.
 *
 * ★★★ IT NOW MAKES ITS OWN CONTEXT. The default argument used to be `shared`,
 * which was null on every load until somebody clicked a control on
 * /notifications — so the driver called this on every arriving notification and
 * it returned on line one. That was the whole of the "not every time".
 *
 * ★★ AND A REFUSED RESUME IS RECORDED. `resume()` rejects asynchronously; the
 * tones below are scheduled anyway because a context that resumes in time still
 * plays them, and if it does not, `dingState` says why and the control shows it.
 */
export function playDing(ctx: DingContext | null = ensureDingContext()): void {
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') {
      // ★ NOT `void`. The rejection is the only evidence a browser gives that
      // it is refusing, and fix-369 threw it away.
      ctx.resume().then(
        () => setDingState('unlocked'),
        () => setDingState('blocked'),
      );
    } else {
      setDingState('unlocked');
    }
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
