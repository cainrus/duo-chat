// A short two-tone "ding" for the nudge, synthesized with WebAudio (no audio files to fetch).
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
