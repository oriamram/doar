// Build the home-screen widget app (widget/) and put it where Doar serves it:
// public/doar-widget.apk, which Settings offers for download on an Android phone.
//
//   npm run widget
//
// Needs the Android SDK (ANDROID_HOME) and a JDK 17 or newer (JAVA_HOME, or one found
// under C:\Program Files\Java). The app is signed with this PC's debug key, so a newer
// build installs over the older one on the phone.

import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const app = join(root, 'widget')
const windows = process.platform === 'win32'

function fail(message) {
  console.error(`\n✖ ${message}\n`)
  process.exit(1)
}

const env = { ...process.env }
if (!env.JAVA_HOME && windows) {
  const base = 'C:\\Program Files\\Java'
  const jdk = existsSync(base) ? readdirSync(base).filter((name) => /^jdk-(1[7-9]|[2-9]\d)/.test(name)).sort().at(-1) : null
  if (jdk) env.JAVA_HOME = join(base, jdk)
}
if (!env.JAVA_HOME) fail('No JDK found. Set JAVA_HOME to a JDK 17 or newer.')

const sdk = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT
if (!sdk) fail('ANDROID_HOME is not set (the Android SDK).')
const local = join(app, 'local.properties')
if (!existsSync(local)) writeFileSync(local, `sdk.dir=${sdk.replace(/\\/g, '/')}\n`)

const gradle = spawnSync(join(app, windows ? 'gradlew.bat' : 'gradlew'), ['assembleRelease', '-q'], { cwd: app, env, stdio: 'inherit', shell: windows })
if (gradle.status !== 0) fail('The widget app did not build.')

const built = join(app, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
const target = join(root, 'public', 'doar-widget.apk')
copyFileSync(built, target)
console.log(`\n✔ ${target} (${Math.round(statSync(target).size / 1024)} KB)\n`)
