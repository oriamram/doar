// Connect to an Android phone over Wi-Fi (no USB cable), using Android 11+ Wireless debugging.
//
//   npm run android:pair
//
// Pairing is needed once per phone. After that, only the "connect" step is needed
// (e.g. after the phone restarts or Wi-Fi reconnects): run this again and leave the
// pairing questions empty.

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const isWindows = process.platform === 'win32'
const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT
const adbPath = sdk ? join(sdk, 'platform-tools', isWindows ? 'adb.exe' : 'adb') : null
const adb = adbPath && existsSync(adbPath) ? adbPath : 'adb'

const rl = createInterface({ input: process.stdin })
const lines = rl[Symbol.asyncIterator]()
async function ask(question) {
  process.stdout.write(question)
  const { value } = await lines.next()
  return (value ?? '').trim()
}

function runAdb(args) {
  const result = spawnSync(adb, args, { encoding: 'utf8' })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  if (output) console.log(`  ${output.replaceAll('\n', '\n  ')}`)
  return result.status === 0 && !/fail|error|unable|cannot/i.test(output)
}

console.log(`
On your phone (same Wi-Fi as this PC):
  Settings → System → Developer options → Wireless debugging → turn it on.
`)

console.log('Step 1 of 2: Pair (only needed the first time; press Enter to skip)')
console.log('  On the phone, tap "Pair device with pairing code".')
const pairAddress = await ask('  IP address & Port shown in the pairing popup (e.g. 192.168.1.20:37099): ')
if (pairAddress) {
  const code = await ask('  Wi-Fi pairing code (6 digits): ')
  if (!runAdb(['pair', pairAddress, code])) {
    console.error('\n✖ Pairing failed. The popup closes quickly; open it again and retry.\n')
    process.exit(1)
  }
}

console.log('\nStep 2 of 2: Connect')
console.log('  On the main Wireless debugging screen (not the popup), find "IP address & Port".')
const connectAddress = await ask('  IP address & Port (e.g. 192.168.1.20:41235): ')
rl.close()
if (!connectAddress || !runAdb(['connect', connectAddress])) {
  console.error('\n✖ Could not connect. Check the phone and PC are on the same Wi-Fi and try again.\n')
  process.exit(1)
}

console.log('\n✔ Connected over Wi-Fi. Now run: npm run android:live\n')
