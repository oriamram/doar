// Live reload on an Android phone (or emulator).
//
//   npm run android:live
//
// 1. Starts the Vite dev server on this PC.
// 2. Installs a debug build on the connected phone that loads its screens from
//    that dev server instead of from files bundled in the app.
// 3. Forwards the phone's localhost:5173 to this PC over the ADB connection
//    ("adb reverse"), which works over Wi-Fi (Wireless debugging) or USB, with no
//    firewall setup needed.
//
// Save a file and the phone updates instantly. Press Ctrl+C to stop.
//
// Steps are done directly instead of via `cap run --live-reload`, because that
// command fails on Windows (it runs the Mac/Linux `gradlew` script).

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PORT = 5173
const APP_ID = 'app.doar.mail'
const isWindows = process.platform === 'win32'
const root = join(import.meta.dirname, '..')
const androidDir = join(root, 'android')
const assetsConfig = join(androidDir, 'app', 'src', 'main', 'assets', 'capacitor.config.json')

const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT
const adbPath = sdk ? join(sdk, 'platform-tools', isWindows ? 'adb.exe' : 'adb') : null
const adb = adbPath && existsSync(adbPath) ? adbPath : 'adb'

function step(message) {
  console.log(`\n\x1b[36m▸ ${message}\x1b[0m`)
}

function fail(message) {
  console.error(`\n\x1b[31m✖ ${message}\x1b[0m\n`)
  cleanup()
  process.exit(1)
}

/** Run a command to completion, streaming its output. */
function runSync(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: root, ...options })
  return result.status === 0
}

function connectedDevices() {
  const result = spawnSync(adb, ['devices'], { encoding: 'utf8' })
  if (result.error) fail('Could not run adb. Is the Android SDK installed and ANDROID_HOME set?')
  return result.stdout
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter(([id, state]) => id && state)
}

let vite = null
let stopping = false

/** Stop a process started with `shell: true`, including the program the shell launched. */
function killTree(child) {
  if (!child || child.exitCode !== null) return
  if (isWindows) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  else child.kill()
}

function cleanup() {
  stopping = true
  killTree(vite)
  // Put back the normal config, so the next `npm run sync` build works offline.
  spawnSync('npx', ['cap', 'copy', 'android'], { cwd: root, shell: true, stdio: 'ignore' })
}

// --- 1. Check a phone is connected ----------------------------------------

step('Looking for a connected Android device')
const devices = connectedDevices()
// Over Wi-Fi the same phone can be listed twice (by name and by IP), so dedupe by serial number.
const seenSerials = new Set()
const ready = devices
  .filter(([, state]) => state === 'device')
  .filter(([id]) => {
    const serial = spawnSync(adb, ['-s', id, 'shell', 'getprop', 'ro.serialno'], { encoding: 'utf8' })
      .stdout?.trim()
    if (serial && seenSerials.has(serial)) return false
    if (serial) seenSerials.add(serial)
    return true
  })
for (const [id, state] of devices) {
  if (state === 'unauthorized') console.log(`  ${id}: tap "Allow" on the phone's debugging prompt`)
}
if (ready.length === 0) {
  fail(
    'No phone found. Either:\n' +
      '  • Wi-Fi: run `npm run android:pair` (phone and PC on the same Wi-Fi), or\n' +
      '  • USB:   plug it in with USB debugging on, and accept the prompt on the phone.',
  )
}
if (ready.length > 1) {
  fail(`More than one device is connected (${ready.map(([id]) => id).join(', ')}). Disconnect all but one.`)
}
const [deviceId] = ready[0]
console.log(`  Using ${deviceId}`)

// --- 2. Start the dev server ----------------------------------------------

step(`Starting dev server on port ${PORT}`)
const portBusy = await fetch(`http://localhost:${PORT}`).then(
  () => true,
  () => false,
)
if (portBusy) {
  fail(`Port ${PORT} is already in use. Stop the other dev server (e.g. \`npm run dev\`) and try again.`)
}
// 127.0.0.1, not "localhost": on Windows Vite may listen on IPv6 only, but adb reverse connects over IPv4.
vite = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  cwd: root,
  shell: true,
  stdio: 'inherit',
})
vite.on('exit', (code) => {
  if (code && !stopping) fail(`Dev server stopped (exit code ${code}). Is port ${PORT} already in use?`)
})

const start = Date.now()
for (;;) {
  try {
    await fetch(`http://localhost:${PORT}`)
    break
  } catch {
    if (Date.now() - start > 30_000) fail('Dev server did not start within 30 seconds.')
    await new Promise((r) => setTimeout(r, 300))
  }
}

// --- 3. Build and install the app, pointed at the dev server --------------

step('Preparing the Android project')
if (!existsSync(join(root, 'dist', 'index.html'))) {
  if (!runSync('npm', ['run', 'build'], { shell: true })) fail('Web build failed.')
}
if (!runSync('npx', ['cap', 'sync', 'android'], { shell: true })) fail('Capacitor sync failed.')

const config = JSON.parse(readFileSync(assetsConfig, 'utf8'))
config.server = { ...config.server, url: `http://localhost:${PORT}`, cleartext: true }
writeFileSync(assetsConfig, JSON.stringify(config, null, '\t'))

step('Building and installing the debug app (first time takes a minute)')
// Full path: some Windows setups don't run programs from the current folder.
const gradle = `"${join(androidDir, isWindows ? 'gradlew.bat' : 'gradlew')}"`
if (!runSync(gradle, ['installDebug', '-q'], { cwd: androidDir, shell: true })) {
  fail('Android build or install failed (see the Gradle output above).')
}

// --- 4. Connect the phone to the dev server and launch --------------------

step('Connecting the phone to this PC and opening Doar')
if (!runSync(adb, ['-s', deviceId, 'reverse', `tcp:${PORT}`, `tcp:${PORT}`])) {
  fail('adb reverse failed.')
}
runSync(adb, ['-s', deviceId, 'shell', 'am', 'start', '-n', `${APP_ID}/.MainActivity`], { stdio: 'ignore' })

console.log(
  '\n\x1b[32m✔ Doar is running on your phone with live reload.\x1b[0m' +
    '\n  Edit files in src/ and the phone updates when you save.' +
    '\n  Keep the phone connected (Wi-Fi or USB). Press Ctrl+C to stop.' +
    '\n  Afterwards, run `npm run android:install` to install a normal build that works without this PC.\n',
)

process.on('SIGINT', () => {
  cleanup()
  process.exit(0)
})
