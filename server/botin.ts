import { execFile as execFileCallback } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import express, { type Express, type Request, type Response } from 'express'
import { isHidden, type Privacy } from './profile-lock.js'

// BOTIN marketing CRM: leads, the owner's approval queue and the agents' reports, kept by
// the botin-crm Hermes plugin in ~/botin-crm. Every read and change goes through that
// plugin's admin CLI (fixed arguments, validated here), so the CLI's file lock is the only
// writer lock. These are BOTIN's own files: Hermes itself is still never changed.

const execFile = promisify(execFileCallback)
const PROFILE = process.env.BOTIN_PROFIL_WA ?? 'botin-wa'
const ID = /^[0-9a-f]{8}$/
const KEY = /^[\w.-]{1,80}$/
const REPORT = /^[\w.-]{1,80}\.md$/
const DECISIONS = ['menunggu', 'disetujui', 'ditolak', 'selesai']
const STAGES = ['baru', 'tanya', 'terkualifikasi', 'demo-dijadwalkan', 'demo-selesai', 'penawaran', 'menunggu-bayar', 'lunas', 'aktif', 'hilang']

export type BotinRunner = (args: string[], timeoutMs: number) => Promise<Record<string, unknown>>

export function adminPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.BOTIN_ADMIN ?? join(homedir(), '.local', 'share', 'botin-crm', 'admin.py')
}

export const runAdmin: BotinRunner = async (args, timeoutMs) => {
  try {
    const { stdout } = await execFile('python3', [adminPath(), ...args], { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
    return JSON.parse(stdout) as Record<string, unknown>
  } catch (error) {
    // The CLI prints its JSON verdict even when it exits non-zero.
    const stdout = (error as { stdout?: unknown }).stdout
    if (typeof stdout === 'string' && stdout.trim().startsWith('{')) return JSON.parse(stdout) as Record<string, unknown>
    const code = (error as { code?: unknown }).code
    return { ok: false, galat: code === 'ENOENT' ? 'python3 is not installed.' : 'The BOTIN CRM could not be read. Run pasang.sh in botin-agen first.' }
  }
}

/** Validated admin CLI arguments for one change, or an error message. */
export function actionArgs(body: unknown): string[] | string {
  const input = (body ?? {}) as Record<string, unknown>
  const text = (value: unknown, max: number) => (typeof value === 'string' ? value : '').slice(0, max)
  switch (input.aksi) {
    case 'putuskan':
      if (!ID.test(String(input.id)) || !DECISIONS.includes(String(input.status))) return 'Unknown queue item or decision.'
      return ['putuskan', String(input.id), String(input.status), text(input.catatan, 300)]
    case 'kirim':
      if (!ID.test(String(input.id))) return 'Unknown queue item.'
      return text(input.teks, 1500).trim() ? ['kirim', String(input.id), text(input.teks, 1500)] : ['kirim', String(input.id)]
    case 'tahap':
      if (!KEY.test(String(input.kunci)) || !STAGES.includes(String(input.tahap))) return 'Unknown lead or stage.'
      return ['tahap', String(input.kunci), String(input.tahap)]
    case 'lepas':
      if (!KEY.test(String(input.kunci))) return 'Unknown chat.'
      return ['lepas', String(input.kunci)]
    case 'jeda':
      if (input.nilai !== 'on' && input.nilai !== 'off') return 'Use on or off.'
      return ['jeda', input.nilai]
    default:
      return 'Unknown action.'
  }
}

export function installBotin(app: Express, privacyOf: (request: Request) => Promise<Privacy>, run: BotinRunner = runAdmin): void {
  // The CRM holds customers' WhatsApp numbers: locking the WhatsApp agent hides it too.
  const guard = async (request: Request, response: Response) => {
    if (!isHidden(await privacyOf(request), PROFILE)) return true
    response.status(423).json({ error: `🔒 ${PROFILE} is locked. Enter the PIN to see the BOTIN CRM.`, locked: 'profile', agent: PROFILE })
    return false
  }
  app.get('/api/botin', async (request, response) => {
    if (!(await guard(request, response))) return
    response.json({ ...(await run(['ringkas'], 15_000)), fetchedAt: new Date().toISOString() })
  })
  app.get('/api/botin/laporan/:nama', async (request, response) => {
    if (!(await guard(request, response))) return
    const name = String(request.params.nama)
    if (!REPORT.test(name)) { response.status(400).json({ ok: false, galat: 'Unknown report.' }); return }
    response.json(await run(['laporan', name], 15_000))
  })
  // Changes need the same-page header, like the access-code routes, so other sites cannot make them.
  app.post('/api/botin/aksi', express.json({ limit: '16kb' }), async (request, response) => {
    if (request.get('x-ruang-request') !== '1') { response.status(403).json({ ok: false, galat: 'Forbidden.' }); return }
    if (!(await guard(request, response))) return
    const args = actionArgs(request.body)
    if (typeof args === 'string') { response.status(400).json({ ok: false, galat: args }); return }
    const result = await run(args, args[0] === 'kirim' ? 90_000 : 15_000)
    response.status(result.ok ? 200 : 422).json(result)
  })
}
