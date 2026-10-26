import type { AddressInfo } from 'node:net'
import express from 'express'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { actionArgs, installBotin } from './botin.js'
import type { Privacy } from './profile-lock.js'

let base: string
let close: () => void
let calls: string[][]
let privacy: Privacy

beforeEach(async () => {
  calls = []
  privacy = { all: false, hidden: [] } as unknown as Privacy
  const app = express()
  installBotin(app, async () => privacy, async (args) => { calls.push(args); return args[0] === 'kirim' ? { ok: false, galat: 'pengiriman gagal' } : { ok: true, args } })
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  close = () => server.close()
})
afterEach(() => close())

const post = (body: unknown, header = true) => fetch(`${base}/api/botin/aksi`, { method: 'POST', headers: { 'content-type': 'application/json', ...(header ? { 'x-ruang-request': '1' } : {}) }, body: JSON.stringify(body) })

describe('BOTIN CRM routes', () => {
  it('reads the summary through the admin CLI', async () => {
    const response = await fetch(`${base}/api/botin`)
    expect(response.status).toBe(200)
    expect(calls).toEqual([['ringkas']])
  })

  it('refuses changes without the same-page header', async () => {
    expect((await post({ aksi: 'jeda', nilai: 'on' }, false)).status).toBe(403)
    expect(calls).toEqual([])
  })

  it('passes only validated arguments to the CLI', async () => {
    expect((await post({ aksi: 'putuskan', id: 'a1b2c3d4', status: 'ditolak', catatan: 'x' })).status).toBe(200)
    expect((await post({ aksi: 'tahap', kunci: '6281200000001', tahap: 'lunas' })).status).toBe(200)
    expect((await post({ aksi: 'kirim', id: 'a1b2c3d4' })).status).toBe(422)
    expect(calls).toEqual([['putuskan', 'a1b2c3d4', 'ditolak', 'x'], ['tahap', '6281200000001', 'lunas'], ['kirim', 'a1b2c3d4']])
  })

  it('rejects unknown actions and malformed input before running anything', async () => {
    for (const body of [{ aksi: 'hapus' }, { aksi: 'putuskan', id: '../x', status: 'ditolak' }, { aksi: 'tahap', kunci: 'a;rm -rf', tahap: 'lunas' }, { aksi: 'tahap', kunci: 'k1', tahap: 'deal' }, { aksi: 'jeda', nilai: 'maybe' }]) {
      expect((await post(body)).status).toBe(400)
    }
    expect((await fetch(`${base}/api/botin/laporan/..%2Fleads.csv`)).status).toBe(400)
    expect(calls).toEqual([])
  })

  it('hides the CRM while the WhatsApp agent is locked', async () => {
    privacy = { all: false, hidden: ['botin-wa'] } as unknown as Privacy
    expect((await fetch(`${base}/api/botin`)).status).toBe(423)
    expect((await post({ aksi: 'jeda', nilai: 'on' })).status).toBe(423)
    expect(calls).toEqual([])
  })

  it('keeps an edited draft and caps its length', () => {
    expect(actionArgs({ aksi: 'kirim', id: 'a1b2c3d4', teks: 'Halo Bu' })).toEqual(['kirim', 'a1b2c3d4', 'Halo Bu'])
    expect((actionArgs({ aksi: 'kirim', id: 'a1b2c3d4', teks: 'x'.repeat(5000) }) as string[])[2]).toHaveLength(1500)
  })
})
