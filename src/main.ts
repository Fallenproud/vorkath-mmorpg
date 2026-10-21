import './styles/main.css'
import { AudioEngine } from './engine/audio'
import { Input } from './engine/input'
import { GameLoop } from './engine/loop'
import { SaveStore, type Settings } from './engine/save'
import type { Game, Mode } from './game/game'
import { Ui, type Screen } from './ui/ui'
import { PerfPanel } from './ui/perfpanel'
import { BENCH_CONFIGS, BENCH_WAYPOINTS, runBenchmark } from './game/bench'

const SCREEN_FOR_MODE: Record<Mode, Screen> = {
  boot: 'boot', title: 'title', opening: 'cinematic', playing: 'hud', paused: 'pause', teaser: 'teaser',
}

function download(href: string, name: string): void {
  const a = document.createElement('a')
  a.href = href
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
}

async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#game')!
  const root = document.getElementById('ui')!
  const store = new SaveStore()
  const input = new Input(canvas)
  const audio = new AudioEngine()
  let game: Game | undefined
  let recorder: MediaRecorder | null = null
  let lockLostAt = 0

  const tryLock = () => {
    if (game?.mode === 'playing' && !game.journalOpen && input.method === 'keyboard' && performance.now() - lockLostAt > 450) input.lockPointer()
  }
  const pauseGame = () => {
    if (game?.mode !== 'playing') return
    game.pause()
    input.unlockPointer()
  }
  const resumeGame = () => {
    if (game?.mode !== 'paused') return
    game.resume()
    loop.resetAccumulator()
    window.setTimeout(tryLock, 0)
  }

  const ui = new Ui(root, store, audio, {
    newGame: () => { audio.unlock(); game?.newGame() },
    continueGame: () => { audio.unlock(); game?.continueGame(); window.setTimeout(tryLock, 60) },
    teaser: () => { audio.unlock(); game?.startTeaser('teaser') },
    transform: () => { audio.unlock(); game?.startTeaser('transform') },
    resume: resumeGame,
    quit: () => { input.unlockPointer(); game?.toTitle() },
    skip: () => game?.skipCinematic(),
    settings: patch => {
      Object.assign(store.data.settings, patch)
      store.saveSettings()
      game?.applySettings(store.data.settings as Settings)
    },
    erase: () => game?.eraseSave(),
    closeJournal: () => game?.closeJournal(),
    openJournal: () => game?.openJournal(),
    returnToSafe: () => { game?.returnToSafe(); resumeGame() },
    teaserPause: () => game?.toggleTeaserPause() ?? false,
    teaserRestart: () => game?.restartTeaser(),
    teaserExit: () => game?.exitTeaser(),
    teaserCapture: () => game?.captureStill(url => { download(url, 'vorkath-teaser-still.png'); ui.toast('Still saved to your downloads.', 'info') }),
    teaserRecord: () => {
      if (recorder) {
        recorder.stop()
        recorder = null
        return false
      }
      if (typeof MediaRecorder === 'undefined' || !canvas.captureStream) {
        ui.toast('Recording is not supported in this browser.', 'warn')
        return false
      }
      const stream = canvas.captureStream(30)
      const chunks: BlobPart[] = []
      const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m))
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 8_000_000 } : undefined)
      rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
      rec.onstop = () => {
        const url = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }))
        download(url, 'vorkath-teaser.webm')
        window.setTimeout(() => URL.revokeObjectURL(url), 5000)
        ui.toast('Clip saved to your downloads.', 'info')
      }
      rec.start(500)
      recorder = rec
      return true
    },
    lockPointer: tryLock,
    keepExploring: () => { game?.resume(); loop.resetAccumulator(); window.setTimeout(tryLock, 0) },
  })
  ui.show('boot')
  ui.setBoot(0.08, 'Loading engine...')

  const [{ Game: GameClass }, { Renderer, suggestQuality }, physics, { Assets }] = await Promise.all([
    import('./game/game'), import('./engine/renderer'), import('./engine/physics'), import('./engine/assets'), document.fonts.ready,
  ])
  ui.setBoot(0.25, 'Starting physics...')
  await physics.initPhysics()
  if (!store.hasProgress() && localStorage.getItem('vorkath-prime.quality-set') === null) {
    store.data.settings.quality = suggestQuality()
    store.saveSettings()
    try { localStorage.setItem('vorkath-prime.quality-set', '1') } catch { /* ignore */ }
  }
  const renderer = new Renderer(canvas, store.data.settings.quality)
  const assets = new Assets()
  assets.onProgress(p => ui.setBoot(0.35 + p * 0.3, 'Loading models...'))

  const g = new GameClass(renderer, input, audio, store, {
    toast: (t, k) => ui.toast(t, k),
    discovery: (d, isNew, readings) => ui.discovery(d, isNew, readings),
    objectiveChanged: () => ui.objectiveChanged(),
    complete: () => {
      window.setTimeout(() => {
        if (g.mode !== 'playing') return
        g.pause()
        input.unlockPointer()
        ui.showComplete()
      }, 2200)
    },
    pauseKey: pauseGame,
    helpKey: () => ui.toggleHelp(),
    journalToggled: open => {
      if (open) {
        input.unlockPointer()
        ui.openJournalModal()
      } else {
        ui.closeModal(true)
        window.setTimeout(tryLock, 0)
      }
    },
    teaserEnded: () => { if (recorder) { recorder.stop(); recorder = null } },
    region: name => ui.regionBanner(name),
  })
  game = g
  ui.attach(g)
  g.reducedMotion = store.data.settings.reducedMotion
  ui.setBoot(0.4, 'Building the Scarred Frontier...')
  await g.init(assets)
  ui.setBoot(0.9, 'Warming up...')

  if (import.meta.env.DEV) {
    try {
      const [{ registerGameTuning }, { tuning }] = await Promise.all([import('../scripts/manus-tuning/adapter.js'), import('./game/tuning')])
      await registerGameTuning(tuning)
    } catch (err) {
      console.warn('Tuning bridge unavailable', err)
    }
  }

  let lastMode: Mode = 'boot'
  const loop: GameLoop = new GameLoop({
    step: dt => g.step(dt),
    render: (alpha, frameSeconds) => {
      loop.paused = g.mode === 'paused' || g.journalOpen
      if (g.mode !== lastMode) {
        lastMode = g.mode
        ui.show(SCREEN_FOR_MODE[g.mode])
        ;(document.activeElement as HTMLElement | null)?.blur?.()
        if (g.mode === 'playing') loop.resetAccumulator()
      }
      g.render(alpha, frameSeconds)
      if (g.mode !== 'playing' && input.pointerLocked) input.unlockPointer()
      if (g.mode === 'playing' && g.journalOpen && input.pointerLocked) input.unlockPointer()
      ui.setLockHint(g.mode === 'playing' && !g.journalOpen && !input.pointerLocked && input.method === 'keyboard' && !ui.modal)
      ui.frame(frameSeconds, g.hud)
    },
  })

  g.enterTitle()
  g.hud.black = 0
  ui.setBoot(1, 'Ready')
  loop.start()
  window.setTimeout(() => { lastMode = 'title'; ui.show('title') }, 250)

  const perfPanel = new PerfPanel(g)
  // --- Keyboard handling for states where gameplay input is disabled.
  window.addEventListener('keydown', e => {
    if (e.repeat) return
    const code = e.code
    const mode = g.mode
    if (code === 'F3') { e.preventDefault(); perfPanel.toggle(); return }
    if (code === 'Tab') e.preventDefault()
    if (code === 'Escape' || code === 'KeyP') {
      if (ui.modal) { ui.back(); e.preventDefault(); return }
      if (mode === 'paused') resumeGame()
      else if (mode === 'teaser') g.exitTeaser()
      else if (mode === 'opening') g.skipCinematic()
    } else if ((code === 'Space' || code === 'Enter') && mode === 'opening' && !ui.modal) {
      e.preventDefault()
      g.skipCinematic()
    } else if ((code === 'KeyJ' || code === 'Tab') && g.journalOpen) {
      ui.back()
    } else if (code === 'KeyH' && (mode === 'paused' || mode === 'title')) {
      ui.toggleHelp()
    }
  })

  // Browsers release pointer lock on Escape without delivering the key: treat that as a pause.
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement) {
      lockLostAt = performance.now()
      if (g.mode === 'playing' && !g.journalOpen && input.method === 'keyboard') pauseGame()
    }
  })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      pauseGame()
      g.saveNow()
    }
  })
  window.addEventListener('pagehide', () => g.saveNow())
  canvas.addEventListener('click', () => {
    audio.unlock()
    if (g.mode === 'playing') tryLock()
  })
  window.addEventListener('pointerdown', () => audio.unlock(), { once: false })

  // Test and debug hook.
  ;(window as unknown as { __vorkath: unknown }).__vorkath = { game: g, ui, input, store, loop, perfPanel, bench: { run: runBenchmark.bind(null, g), configs: BENCH_CONFIGS, waypoints: BENCH_WAYPOINTS } }
}

boot().catch(err => {
  console.error(err)
  const el = document.getElementById('ui')
  if (el) el.innerHTML = `<div class="fatal">Failed to start: ${String((err as Error)?.message ?? err).replace(/[<>&]/g, '')}</div>`
})
