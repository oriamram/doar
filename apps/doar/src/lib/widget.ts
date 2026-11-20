// The home-screen widget for Android (the app in widget/, served beside Doar).

/** Where the widget app is downloaded from (built from widget/ by `npm run widget`). */
export const WIDGET_APP = '/doar-widget.apk'

/** Is this an Android phone, where the widget can live? */
export const canHaveWidget = () => /Android/i.test(navigator.userAgent)

/**
 * The link that hands a new key to the widget app on this phone (widget/ConnectActivity).
 * Chrome opens the app by its name; when it is not installed, it downloads it instead.
 */
export function widgetLink(key: string, origin: string): string {
  const fallback = encodeURIComponent(`${origin}${WIDGET_APP}`)
  return `intent://connect?key=${encodeURIComponent(key)}#Intent;scheme=doarwidget;package=app.doar.widget;S.browser_fallback_url=${fallback};end`
}
