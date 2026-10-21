import type { Game } from '../game/game'
import { BENCH_CONFIGS, BENCH_WAYPOINTS, runBenchmark, type BenchReport } from '../game/bench'

/**
 * F3 performance panel. Live frame cost, renderer counters and memory, A/B toggles for the Ultra pilot features
 * (PBR layers, GTAO) and a scripted benchmark whose JSON can be downloaded and shared.
 * Open it from the title screen or the pause menu to run the benchmark; the live view works everywhere.
 */
export class PerfPanel {
  private readonly el: HTMLDivElement
  private readonly out: HTMLPreElement
  private readonly status: HTMLDivElement
  private timer = 0
  private running = false
  private last: BenchReport | null = null
  private pbr: boolean | null = null
  private gtao: boolean | null = null
  constructor(private readonly game: Game) {
    this.el = document.createElement('div')
    this.el.id = 'perfPanel'
    this.el.setAttribute('role', 'dialog')
    this.el.setAttribute('aria-label', 'Performance panel')
    this.el.style.cssText = 'position:fixed;top:10px;right:10px;z-index:60;width:372px;max-height:92vh;overflow:auto;background:rgba(8,9,12,.88);border:1px solid rgba(80,200,190,.45);border-radius:6px;padding:10px 12px;color:#cfe;font:11px/1.45 ui-monospace,Menlo,Consolas,monospace;display:none;backdrop-filter:blur(3px)'
    this.el.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><b style="letter-spacing:.08em;color:#6fe3d4">PERFORMANCE (F3)</b><button data-a="close" style="${this.btn()}">Close</button></div>
<pre id="pp-out" style="margin:0 0 8px;white-space:pre-wrap"></pre>
<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px">
<button data-a="pbr" style="${this.btn()}"></button><button data-a="gtao" style="${this.btn()}"></button>
<button data-a="quick" style="${this.btn()}">Run benchmark</button><button data-a="uhd" style="${this.btn()}">UHD sweep</button>
<button data-a="dl" style="${this.btn()}" disabled>Download JSON</button></div>
<div id="pp-status" style="color:#ffd9a0"></div>`
    document.body.appendChild(this.el)
    this.out = this.el.querySelector('#pp-out') as HTMLPreElement
    this.status = this.el.querySelector('#pp-status') as HTMLDivElement
    this.el.addEventListener('click', e => {
      const a = (e.target as HTMLElement).dataset?.a
      if (!a) return
      if (a === 'close') this.toggle(false)
      else if (a === 'pbr') { this.pbr = this.pbr === null ? false : this.pbr === false ? true : null; this.game.pbrOverride = this.pbr; this.refreshButtons() }
      else if (a === 'gtao') { this.gtao = this.gtao === null ? false : this.gtao === false ? true : null; this.game.renderer.setGtaoOverride(this.gtao); this.refreshButtons() }
      else if (a === 'quick') void this.bench(false)
      else if (a === 'uhd') void this.bench(true)
      else if (a === 'dl') this.download()
    })
    this.el.addEventListener('keydown', e => {
      e.stopPropagation() // keep game shortcuts from firing while a panel button has focus
      if (e.code === 'F3') { e.preventDefault(); this.toggle(false) }
    })
    this.refreshButtons()
  }
  private btn(): string {
    return 'background:#10181a;color:#bff;border:1px solid rgba(80,200,190,.5);border-radius:4px;padding:3px 8px;font:inherit;cursor:pointer'
  }
  private refreshButtons(): void {
    const label = (v: boolean | null) => (v === null ? 'auto' : v ? 'ON' : 'OFF')
    ;(this.el.querySelector('[data-a=pbr]') as HTMLButtonElement).textContent = `PBR layers: ${label(this.pbr)}`
    ;(this.el.querySelector('[data-a=gtao]') as HTMLButtonElement).textContent = `GTAO: ${label(this.gtao)}`
  }
  get visible(): boolean {
    return this.el.style.display !== 'none'
  }
  toggle(force?: boolean): void {
    const show = force ?? !this.visible
    this.el.style.display = show ? 'block' : 'none'
    window.clearInterval(this.timer)
    if (show) {
      this.tick()
      this.timer = window.setInterval(() => this.tick(), 500)
    }
  }
  private tick(): void {
    if (this.running) return
    const t = this.game.telemetry() as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    const p = t.probe
    const b = t.buffer
    const gpu = p.gpuMs ? `${p.gpuMs.avg.toFixed(2)} ms avg / ${p.gpuMs.p95.toFixed(2)} p95` : this.game.renderer.probe.gpuSupported ? 'collecting...' : 'n/a (no GPU timer query in this browser)'
    this.out.textContent = [
      `quality   ${t.quality}   buffer ${b.width}x${b.height} (x${b.pixelRatio})`,
      `MSAA ${b.msaa}x   GTAO ${t.gtao ? 'on' : 'off'}   PBR ${t.pbr.state} (mix ${t.pbr.mix})`,
      `frame     ${p.frameMs.avg.toFixed(1)} ms (rAF, vsync-capped)`,
      `CPU render ${p.cpuMs.avg.toFixed(2)} ms avg / ${p.cpuMs.p95.toFixed(2)} p95`,
      `GPU       ${gpu}`,
      `calls ${t.drawCalls}   tris ${(t.triangles / 1000).toFixed(0)}k   geo ${t.geometries}   tex ${t.textures}`,
      `post targets ~${b.targetsMB} MB (estimate)`,
      t.pbr.state === 'ready' ? `PBR arrays ${t.pbr.gpuFormat}, ${t.pbr.transferKB} KB transferred, ${t.pbr.loadMs} ms` : t.pbr.state === 'failed' ? `PBR load failed: ${t.pbr.error}` : '',
    ].filter(Boolean).join('\n')
  }
  private async bench(uhd: boolean): Promise<void> {
    if (this.running) return
    const mode = this.game.mode
    if (mode !== 'paused' && mode !== 'title') {
      this.status.textContent = 'Open the pause menu (Esc) or the title screen first, then press the button. The benchmark moves the camera.'
      return
    }
    this.running = true
    this.status.textContent = 'Running... do not touch the window.'
    try {
      const configs = uhd ? [BENCH_CONFIGS[0], BENCH_CONFIGS[3]] : BENCH_CONFIGS
      const widths = uhd ? [1920, 2560, 3840] : [null]
      const waypoints = BENCH_WAYPOINTS.filter(w => w.eco === undefined).slice(0, uhd ? 2 : 3)
      this.last = await runBenchmark(this.game, { widths, seconds: 3, warmupMs: 700, configs, waypoints, allowEco: false },
        (d, n, label) => { this.status.textContent = `Benchmark ${d + 1}/${n}: ${label}` })
      ;(window as unknown as { __vorkathBench?: BenchReport }).__vorkathBench = this.last
      this.out.textContent = this.summarize(this.last)
      this.status.textContent = 'Done. Download the JSON to share it.'
      ;(this.el.querySelector('[data-a=dl]') as HTMLButtonElement).disabled = false
    } catch (e) {
      this.status.textContent = `Benchmark failed: ${String((e as Error).message ?? e)}`
    } finally {
      this.running = false
    }
  }
  private summarize(r: BenchReport): string {
    const rows = new Map<string, { cpu: number[]; gpu: number[]; frame: number[]; w: number }>()
    for (const x of r.runs) {
      const k = `${x.config} @${x.buffer.width}px`
      const v = rows.get(k) ?? { cpu: [], gpu: [], frame: [], w: x.buffer.width }
      v.cpu.push(x.cpuMs.avg); if (x.gpuMs) v.gpu.push(x.gpuMs.avg); v.frame.push(x.frameMs.avg)
      rows.set(k, v)
    }
    const avg = (a: number[]) => (a.length ? (a.reduce((p, c) => p + c, 0) / a.length).toFixed(2) : 'n/a')
    const lines = [`GPU: ${String(r.meta.gpu)}`, `timer queries: ${String(r.meta.gpuTimerQueries)}`, '', 'config @ width : CPU ms | GPU ms | frame ms']
    for (const [k, v] of rows) lines.push(`${k} : ${avg(v.cpu)} | ${avg(v.gpu)} | ${avg(v.frame)}`)
    return lines.join('\n')
  }
  private download(): void {
    if (!this.last) return
    const blob = new Blob([JSON.stringify(this.last, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `vorkath-bench-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }
}
