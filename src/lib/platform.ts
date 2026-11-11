import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { Haptics, ImpactStyle } from '@capacitor/haptics'

/** True inside the Android app, false in a browser or the installed PC web app. */
export const isNative = Capacitor.isNativePlatform()

/** A short vibration, e.g. when a swipe passes its trigger point. */
export function tapHaptic() {
  if (isNative) {
    void Haptics.impact({ style: ImpactStyle.Light })
  } else {
    navigator.vibrate?.(10)
  }
}

/**
 * Handle the Android back button. `onBack` returns true if it handled the press
 * (e.g. closed an open email); otherwise the app exits, like other Android apps.
 */
export function onAndroidBack(onBack: () => boolean): () => void {
  if (!isNative) return () => {}
  const listener = CapacitorApp.addListener('backButton', () => {
    if (!onBack()) void CapacitorApp.exitApp()
  })
  return () => void listener.then((l) => l.remove())
}
