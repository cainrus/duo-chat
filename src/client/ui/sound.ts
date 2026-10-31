// Sounds synthesized with WebAudio (no audio files to fetch): a short two-tone "ding" for the
// nudge, and a soft repeating chime while a call rings towards us.
let ctx: AudioContext | null = null

export function playDing(): void {
  try {
    ctx ??= new AudioContext()
    const t0 = ctx.currentTime
    for (const [i, freq] of [880, 1320].entries()) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const start = t0 + i * 0.18
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.3, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35)
      osc.connect(gain).connect(ctx.destination)
      osc.start(start)
      osc.stop(start + 0.4)
    }
  } catch {
    // No audio (autoplay policy, unsupported): the animation is enough.
  }
}

/** How often the soft ring repeats while the friend waits for us in a call. */
export const RING_EVERY_MS = 3_000
/**
 * She may wait for a long time (voice room, no ring timeout): the chime stops after this,
 * and only the glowing AUDIO button keeps inviting.
 */
export const RING_FOR_MS = 60_000

/** One soft, low chime: quieter and shorter than the nudge ding. */
function playChime(): void {
  try {
    ctx ??= new AudioContext()
    const t0 = ctx.currentTime
    for (const [i, freq] of [660, 880].entries()) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const start = t0 + i * 0.22
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.04)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.5)
      osc.connect(gain).connect(ctx.destination)
      osc.start(start)
      osc.stop(start + 0.55)
    }
  } catch {
    // No audio (autoplay policy, unsupported): the highlighted button is enough.
  }
}

/** Starts the soft repeating ring (for RING_FOR_MS at most); returns the function that stops it. */
export function startRinging(): () => void {
  playChime()
  const id = setInterval(playChime, RING_EVERY_MS)
  const cap = setTimeout(() => clearInterval(id), RING_FOR_MS)
  return () => {
    clearInterval(id)
    clearTimeout(cap)
  }
}
