import { useState } from 'react'
import { usePolling } from '../polling.ts'
import type { Source } from '../types.ts'
import { Dialog, EmptyState, LoadingState, PageTitle, SearchInput, SourceStatus, Unavailable } from '../ui.tsx'

// BOTIN marketing: the funnel, the owner's approval queue and the agents' reports, kept by
// the botin-crm Hermes plugin (see server/botin.ts). Nothing here is sent to a customer
// without a click on "Kirim via WA".

interface Lead { kunci: string; wa: string; nama: string; peran: string; instansi: string; kabupaten: string; provinsi: string; golongan: string; peserta_per_hari: string; sumber: string; tahap: string; jadwal_demo: string; catatan: string; dibuat: string; diperbarui: string }
interface Antrean { id: string; dibuat: string; jenis: string; kunci: string; wa: string; nama: string; instansi: string; ringkasan: string; draf: string; alasan: string; oleh: string; status: string; diputus: string; catatan_admin: string }
interface Penawaran { label: string; harga_normal_teks: string; harga_penawaran_teks: string; berlaku_sampai: string; sisa_hari: number }
interface BotinSnapshot { ok: boolean; galat?: string; penawaran?: Penawaran; tahap?: string[]; per_tahap?: Record<string, number>; lead?: Lead[]; persetujuan?: Antrean[]; ambil_alih?: Record<string, { sampai: string; sejak: string }>; jeda?: boolean; laporan?: string[]; fetchedAt: string }

const LABEL_JENIS: Record<string, string> = { pesan: 'Draf pesan', tahap: 'Usulan tahap', nego: 'Nego harga', pembayaran: 'Pembayaran', pengadaan: 'Pengadaan', dukungan: 'Dukungan', pertanyaan: 'Pertanyaan', 'minta-manusia': 'Minta admin', demo: 'Jadwal demo' }
const NADA_TAHAP: Record<string, string> = { lunas: 'good', aktif: 'good', hilang: 'muted', 'menunggu-bayar': 'unknown', penawaran: 'unknown' }

async function aksi(body: Record<string, unknown>): Promise<string | null> {
  try {
    const response = await fetch('/api/botin/aksi', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ruang-request': '1' }, body: JSON.stringify(body), credentials: 'same-origin' })
    const data = await response.json().catch(() => undefined) as { ok?: boolean; galat?: string; error?: string } | undefined
    return response.ok && data?.ok ? null : data?.galat ?? data?.error ?? `HTTP ${response.status}`
  } catch {
    return 'Server Ruang tidak bisa dihubungi.'
  }
}

const waktu = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : iso || '—' }
const tautanWa = (wa: string) => wa ? `https://wa.me/${wa.replace(/\D/g, '')}` : undefined
const siapa = (item: { nama: string; instansi: string; wa: string; kunci: string }) => item.nama || item.wa || item.kunci || 'Tanpa nama'

export function Botin() {
  const snapshot = usePolling<BotinSnapshot>('/api/botin', 20_000)
  const [galat, setGalat] = useState<string | null>(null)
  const [sibuk, setSibuk] = useState<string | null>(null)
  const [laporan, setLaporan] = useState<{ nama: string; isi: string } | null>(null)
  const [cari, setCari] = useState('')
  const data = snapshot.status === 'ready' ? snapshot.data : undefined
  const source: Source<unknown> | undefined = data ? (data.ok ? { availability: 'available', data: null } : { availability: 'unavailable', data: null, error: { code: 'BOTIN', message: data.galat ?? 'CRM BOTIN tidak bisa dibaca.' } }) : undefined

  const jalankan = async (kunci: string, body: Record<string, unknown>) => {
    setSibuk(kunci)
    const hasil = await aksi(body)
    setSibuk(null)
    setGalat(hasil)
    snapshot.refresh()
  }
  const bukaLaporan = async (nama: string) => {
    const response = await fetch(`/api/botin/laporan/${encodeURIComponent(nama)}`, { credentials: 'same-origin' }).catch(() => undefined)
    const isi = await response?.json().catch(() => undefined) as { ok?: boolean; isi?: string; galat?: string } | undefined
    setLaporan({ nama, isi: isi?.ok ? isi.isi ?? '' : isi?.galat ?? 'Laporan tidak bisa dibaca.' })
  }

  const menunggu = (data?.persetujuan ?? []).filter((item) => item.status === 'menunggu' || item.status === 'disetujui').reverse()
  const tahap = data?.tahap ?? []
  const puncak = Math.max(1, ...Object.values(data?.per_tahap ?? {}))
  const needle = cari.trim().toLowerCase()
  const lead = [...(data?.lead ?? [])].reverse().filter((item) => !needle || Object.values(item).join(' ').toLowerCase().includes(needle))
  const ambilAlih = Object.entries(data?.ambil_alih ?? {})

  return <><PageTitle eyebrow="BOTIN · PEMASARAN" title="BOTIN">Calon pembeli dari WhatsApp, antrean keputusan Anda, dan laporan para agen. Tidak ada pesan terkirim ke pelanggan tanpa Anda menekan <b>Kirim via WA</b>.</PageTitle>
    <SourceStatus source={source} fetchedAt={data?.fetchedAt} request={snapshot}/><Unavailable source={source} request={snapshot}/>
    {snapshot.status === 'pending' && <LoadingState message="Membaca CRM BOTIN..."/>}
    {galat && <p className="file-notice" role="alert">⚠️ {galat}</p>}
    {data?.ok && <>
      <section className="botin-head">
        {data.penawaran && <div><small>{data.penawaran.label.toUpperCase()}</small><strong>{data.penawaran.harga_penawaran_teks}</strong><span><s>{data.penawaran.harga_normal_teks}</s> · sampai {data.penawaran.berlaku_sampai} · {data.penawaran.sisa_hari} hari lagi</span></div>}
        <div><small>BOT WHATSAPP</small><strong>{data.jeda ? 'Dijeda' : 'Menjawab'}</strong>
          <button type="button" className={`primary-button${data.jeda ? '' : ' danger'}`} disabled={sibuk === 'jeda'} onClick={() => { if (data.jeda || window.confirm('Jeda bot? Semua chat tidak akan dibalas sampai dinyalakan lagi.')) void jalankan('jeda', { aksi: 'jeda', nilai: data.jeda ? 'off' : 'on' }) }}>{data.jeda ? 'Nyalakan lagi' : 'Jeda semua chat'}</button>
        </div>
      </section>

      <h2 className="botin-section">Funnel</h2>
      <section className="botin-funnel" aria-label="Jumlah lead per tahap">{tahap.map((nama) => <div key={nama}><span>{nama}</span><i style={{ width: `${(100 * (data.per_tahap?.[nama] ?? 0)) / puncak}%` }}/><b>{data.per_tahap?.[nama] ?? 0}</b></div>)}</section>

      <h2 className="botin-section">Menunggu keputusan Anda <span className="room-count">{menunggu.length}</span></h2>
      {menunggu.length === 0 ? <EmptyState title="Antrean kosong">Draf dari agen dan permintaan dari chat WhatsApp akan muncul di sini.</EmptyState> : <section className="botin-queue">{menunggu.map((item) => <ItemAntrean key={item.id} item={item} sibuk={sibuk === item.id} jalankan={(body) => jalankan(item.id, { ...body, id: item.id })}/>)}</section>}

      {ambilAlih.length > 0 && <><h2 className="botin-section">Chat yang Anda pegang</h2>
        <p className="card-note">Bot diam di chat ini sampai 12 jam sesudah pesan Anda yang terakhir. Ketik <code>#bot</code> di chat itu, atau tekan tombol di bawah, untuk mengembalikannya ke bot.</p>
        <section className="data-list">{ambilAlih.map(([kunci, info]) => { const pemilik = data.lead?.find((item) => item.kunci === kunci); return <article key={kunci}><div><h2>{pemilik ? siapa(pemilik) : kunci}</h2><p>Sampai {waktu(info.sampai)}</p></div><button type="button" className="refresh-button" disabled={sibuk === kunci} onClick={() => void jalankan(kunci, { aksi: 'lepas', kunci })}>KEMBALIKAN KE BOT</button></article> })}</section></>}

      <h2 className="botin-section">Lead <span className="room-count">{data.lead?.length ?? 0}</span></h2>
      {(data.lead?.length ?? 0) === 0 ? <EmptyState title="Belum ada lead">Lead tercatat otomatis saat calon pembeli mengobrol dengan bot WhatsApp.</EmptyState> : <>
        <div className="toolbar"><SearchInput value={cari} onChange={setCari} label="Cari nama, puskesmas, wilayah"/><span className="toolbar-count">{lead.length} dari {data.lead?.length}</span></div>
        <div className="botin-table-wrap"><table className="log-table"><thead><tr><th>Diperbarui</th><th>Siapa</th><th>Instansi</th><th>Kebutuhan</th><th>Tahap</th></tr></thead><tbody>{lead.map((item) => <tr key={item.kunci}>
          <td>{waktu(item.diperbarui)}</td>
          <td>{tautanWa(item.wa) ? <a href={tautanWa(item.wa)} target="_blank" rel="noreferrer">{siapa(item)}</a> : siapa(item)}{item.peran && <small> · {item.peran}</small>}</td>
          <td>{[item.instansi, item.kabupaten, item.provinsi].filter(Boolean).join(', ') || '—'}</td>
          <td>{[item.golongan, item.peserta_per_hari && `${item.peserta_per_hari}/hari`, item.jadwal_demo && `demo ${item.jadwal_demo}`].filter(Boolean).join(' · ') || '—'}{item.catatan && <p className="botin-note">{item.catatan}</p>}</td>
          <td><select className={`badge ${NADA_TAHAP[item.tahap] ?? ''}`} value={item.tahap} disabled={sibuk === item.kunci} aria-label={`Tahap ${siapa(item)}`} onChange={(event) => { const baru = event.target.value; if (baru !== 'lunas' || window.confirm(`Tandai ${siapa(item)} LUNAS? Pastikan pembayaran sudah Anda cek.`)) void jalankan(item.kunci, { aksi: 'tahap', kunci: item.kunci, tahap: baru }) }}>{tahap.map((nama) => <option key={nama} value={nama}>{nama}</option>)}</select></td>
        </tr>)}</tbody></table></div>
      </>}

      <h2 className="botin-section">Laporan agen</h2>
      {(data.laporan?.length ?? 0) === 0 ? <EmptyState title="Belum ada laporan">Analis menulis laporan harian pukul 07.00 dan mingguan setiap Senin.</EmptyState> : <div className="chip-row">{data.laporan?.map((nama) => <button type="button" className="chip chip-button" key={nama} onClick={() => void bukaLaporan(nama)}>{nama.replace(/\.md$/, '')}</button>)}</div>}
      {laporan && <Dialog labelledBy="botin-laporan" onClose={() => setLaporan(null)} closeLabel="Tutup laporan"><h2 id="botin-laporan">{laporan.nama}</h2><pre className="botin-report">{laporan.isi}</pre></Dialog>}
    </>}
  </>
}

function ItemAntrean({ item, sibuk, jalankan }: { item: Antrean; sibuk: boolean; jalankan: (body: Record<string, unknown>) => void }) {
  const [draf, setDraf] = useState(item.draf)
  const pesan = item.jenis === 'pesan'
  const kirim = () => {
    if (!window.confirm(`Kirim pesan ini ke ${siapa(item)} lewat WhatsApp BOTIN?\n\n${draf}`)) return
    jalankan({ aksi: 'kirim', teks: draf === item.draf ? '' : draf })
  }
  return <article className="botin-item">
    <header><span className="badge unknown">{LABEL_JENIS[item.jenis] ?? item.jenis}</span><b>{siapa(item)}</b>{item.instansi && <span>{item.instansi}</span>}<small>{waktu(item.dibuat)} · {item.oleh}</small></header>
    {item.ringkasan && <p>{item.ringkasan}</p>}
    {item.alasan && <p className="botin-note">Alasan: {item.alasan}</p>}
    {pesan && <textarea value={draf} onChange={(event) => setDraf(event.target.value)} rows={Math.min(8, Math.max(3, Math.ceil(draf.length / 70)))} aria-label="Draf pesan"/>}
    {item.jenis === 'tahap' && <p>Usulan tahap: <b>{item.draf}</b></p>}
    <div className="botin-actions">
      {pesan && <button type="button" className="primary-button" disabled={sibuk || !draf.trim() || !item.wa} title={item.wa ? undefined : 'Nomor belum diketahui; kirim manual dari HP'} onClick={kirim}>Kirim via WA</button>}
      {tautanWa(item.wa) && <a className="refresh-button" href={tautanWa(item.wa)} target="_blank" rel="noreferrer">BUKA CHAT</a>}
      {item.jenis === 'tahap' && <button type="button" className="refresh-button" disabled={sibuk} onClick={() => { jalankan({ aksi: 'tahap', kunci: item.kunci, tahap: item.draf }); jalankan({ aksi: 'putuskan', status: 'disetujui' }) }}>TERAPKAN</button>}
      <button type="button" className="refresh-button" disabled={sibuk} onClick={() => jalankan({ aksi: 'putuskan', status: 'selesai' })}>{pesan ? 'SUDAH SAYA KIRIM SENDIRI' : 'SELESAI'}</button>
      <button type="button" className="refresh-button" disabled={sibuk} onClick={() => jalankan({ aksi: 'putuskan', status: 'ditolak' })}>TOLAK</button>
    </div>
  </article>
}
