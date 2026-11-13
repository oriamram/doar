// Reading a letter aloud, with the device's own voice.

export const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window

/** Read this text aloud (Hebrew when it has Hebrew in it). `onEnd` runs when the voice stops, however it stops. */
export function speak(text: string, onEnd: () => void) {
  if (!canSpeak) return
  speechSynthesis.cancel()
  const words = new SpeechSynthesisUtterance(text.slice(0, 20_000))
  words.lang = /[\u0590-\u05ff]/.test(text) ? 'he-IL' : 'en-US'
  words.onend = onEnd
  words.onerror = onEnd
  speechSynthesis.speak(words)
}

export function hush() {
  if (canSpeak) speechSynthesis.cancel()
}
