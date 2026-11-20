// Runs a Vercel command for one of the apps.
//
// Every app is a Vercel project of its own, with its own address, and all of them are
// built from this one repo: each project's "Root Directory" setting on Vercel names the
// app's folder (apps/doar, apps/notes), and the whole repo is uploaded so that the shared
// packages and the server's pure parts are there when the app is built.
//
//   node tools/vercel.mjs doar deploy --prod --yes      (npm run deploy:doar)
//   node tools/vercel.mjs notes deploy --prod --yes     (npm run deploy:notes)
//   node tools/vercel.mjs notes ls                      (any other Vercel command works too)
//
// A deploy that should not go live at once: add --skip-domain, look at the address it
// prints, then `node tools/vercel.mjs doar promote <that address> --yes`.
//
// How it picks the project: the Vercel CLI takes it from two environment variables
// (VERCEL_ORG_ID, VERCEL_PROJECT_ID). They are looked up here by the project's name, so
// no ids are kept in the repo. Needs the Vercel CLI, signed in (`vercel login`).

import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

/** The app's folder under apps/, and the name of its project on Vercel. */
const PROJECTS = { doar: 'doar', notes: 'pitkiyot' }

const root = join(import.meta.dirname, '..')
const [app, ...command] = process.argv.slice(2)

function fail(message) {
  console.error(`\n✖ ${message}\n`)
  process.exit(1)
}

if (!app || !PROJECTS[app] || command.length === 0) {
  fail(`Say which app and what to do: node tools/vercel.mjs <${Object.keys(PROJECTS).join('|')}> deploy --prod --yes`)
}

const asked = spawnSync('vercel', ['api', `/v9/projects/${PROJECTS[app]}`, '--raw'], { cwd: root, shell: true, encoding: 'utf8' })
let project
try {
  project = JSON.parse(asked.stdout)
} catch {
  fail(`Vercel did not answer about the project "${PROJECTS[app]}". Is the CLI signed in (vercel whoami)?\n${asked.stderr ?? ''}`)
}
if (!project?.id || !project.accountId) fail(`There is no Vercel project named "${PROJECTS[app]}" in this account.`)
if (project.rootDirectory !== `apps/${app}`) {
  fail(`The project "${project.name}" builds from "${project.rootDirectory ?? '(the repo root)'}", not from apps/${app}. Set its Root Directory on Vercel first.`)
}

const run = spawnSync('vercel', command, {
  cwd: root,
  shell: true,
  stdio: 'inherit',
  env: { ...process.env, VERCEL_ORG_ID: project.accountId, VERCEL_PROJECT_ID: project.id },
})
process.exit(run.status ?? 1)
