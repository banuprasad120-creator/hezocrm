// Web Audio API Synthesizer for high quality, zero-latency CRM notification sounds

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const AudioContextClass =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

// Ensure audio context resumes on user interaction
if (typeof window !== "undefined") {
  const unlockAudio = () => {
    const ctx = getAudioContext();
    if (ctx && ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    window.removeEventListener("click", unlockAudio);
    window.removeEventListener("keydown", unlockAudio);
    window.removeEventListener("touchstart", unlockAudio);
  };
  window.addEventListener("click", unlockAudio, { passive: true });
  window.addEventListener("keydown", unlockAudio, { passive: true });
  window.addEventListener("touchstart", unlockAudio, { passive: true });
}

export function isSoundEnabled(): boolean {
  if (typeof window === "undefined") return true;
  const stored = localStorage.getItem("hezo_sound_enabled");
  return stored === null ? true : stored === "true";
}

export function setSoundEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("hezo_sound_enabled", String(enabled));
}

/**
 * Plays a pleasant 3-tone harmonic chime for follow-up callback reminders
 */
export function playFollowUpChime(): void {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const notes = [587.33, 739.99, 880.0, 1174.66]; // D5, F#5, A5, D6 harmonic major chime

  notes.forEach((freq, idx) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, now + idx * 0.12);

    gain.gain.setValueAtTime(0.001, now + idx * 0.12);
    gain.gain.exponentialRampToValueAtTime(0.25, now + idx * 0.12 + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.12 + 0.6);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now + idx * 0.12);
    osc.stop(now + idx * 0.12 + 0.65);
  });
}

/**
 * Plays an urgent repeating alert chime for overdue or critical candidate reminders
 */
export function playUrgentAlertChime(): void {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const tones = [880, 1046.5, 880, 1046.5]; // A5 - C6 - A5 - C6

  tones.forEach((freq, idx) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, now + idx * 0.14);

    gain.gain.setValueAtTime(0.001, now + idx * 0.14);
    gain.gain.exponentialRampToValueAtTime(0.3, now + idx * 0.14 + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.14 + 0.3);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now + idx * 0.14);
    osc.stop(now + idx * 0.14 + 0.35);
  });
}

/**
 * Test sound trigger
 */
export function testNotificationSound(): void {
  playFollowUpChime();
}
