import { getSettings } from './settings'

/**
 * Small desk sounds, made on the spot (no audio files): a rubber stamp's thump,
 * paper sliding, a letter flying off. Off unless turned on in the settings.
 */

export type Sound = 'thump' | 'paper' | 'whoosh' | 'tick'

let context: AudioContext | null = null

function audio(): AudioContext | null {
  try {
    context ??= new AudioContext()
    if (context.state === 'suspended') void context.resume()
    return context
  } catch {
    return null
  }
}

/** A burst of hiss, shaped by a filter: the raw material for paper and air sounds. */
function noise(ctx: AudioContext, seconds: number): AudioBufferSourceNode {
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate)
  const samples = buffer.getChannelData(0)
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1
  const source = ctx.createBufferSource()
  source.buffer = buffer
  return source
}

export function playSound(sound: Sound) {
  if (!getSettings().sounds) return
  const ctx = audio()
  if (!ctx) return
  const now = ctx.currentTime
  const out = ctx.createGain()
  out.connect(ctx.destination)

  if (sound === 'thump') {
    // A low knock that drops in pitch, plus a short slap of the rubber on paper.
    const knock = ctx.createOscillator()
    knock.frequency.setValueAtTime(150, now)
    knock.frequency.exponentialRampToValueAtTime(48, now + 0.1)
    out.gain.setValueAtTime(0.5, now)
    out.gain.exponentialRampToValueAtTime(0.001, now + 0.16)
    knock.connect(out)
    knock.start(now)
    knock.stop(now + 0.17)

    const slap = noise(ctx, 0.04)
    const lowpass = ctx.createBiquadFilter()
    lowpass.type = 'lowpass'
    lowpass.frequency.value = 900
    const slapGain = ctx.createGain()
    slapGain.gain.setValueAtTime(0.25, now)
    slapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.04)
    slap.connect(lowpass).connect(slapGain).connect(ctx.destination)
    slap.start(now)
    return
  }

  if (sound === 'tick') {
    const click = ctx.createOscillator()
    click.type = 'triangle'
    click.frequency.setValueAtTime(1400, now)
    out.gain.setValueAtTime(0.08, now)
    out.gain.exponentialRampToValueAtTime(0.001, now + 0.05)
    click.connect(out)
    click.start(now)
    click.stop(now + 0.06)
    return
  }

  // Paper and air: filtered hiss whose pitch sweeps as it moves.
  const length = sound === 'whoosh' ? 0.42 : 0.2
  const hiss = noise(ctx, length)
  const band = ctx.createBiquadFilter()
  band.type = 'bandpass'
  band.Q.value = sound === 'whoosh' ? 0.9 : 0.6
  band.frequency.setValueAtTime(sound === 'whoosh' ? 500 : 3200, now)
  band.frequency.exponentialRampToValueAtTime(sound === 'whoosh' ? 2600 : 1800, now + length)
  out.gain.setValueAtTime(0.0001, now)
  out.gain.exponentialRampToValueAtTime(sound === 'whoosh' ? 0.22 : 0.12, now + length * 0.3)
  out.gain.exponentialRampToValueAtTime(0.0001, now + length)
  hiss.connect(band).connect(out)
  hiss.start(now)
}
