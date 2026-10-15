import * as THREE from 'three'
import type { Physics } from '../engine/physics'
import { ECO_STAGES, type EcoStageIndex } from './ecostate'
import type { HeightField } from './heightfield'
import { POI } from './layout'
import { U } from './uniforms'
import type { V2Imports } from './v2assets'
/**
 * Succession model at the Observation Point (WP-03/WP-05): the four supplied VP_STAGE diorama meshes on a
 * plinth, in order Scarred -> Thriving. The real current state of the land lights its tile and moves a marker.
 * Tiles are the unmodified V2 prototype geometry scaled to table size; they are blockout, not production art.
 */
export class SurveyModel {
  readonly group = new THREE.Group()
  readonly centre = new THREE.Vector3()
  private readonly tiles: THREE.Mesh[] = []
  private readonly glows: THREE.Mesh[] = []
  private readonly marker: THREE.Mesh
  private readonly labels: THREE.Sprite[] = []
  private shown = -1
  private level = 0
  constructor(hf: HeightField, v2: V2Imports | null, physics?: Physics) {
    this.group.name = 'survey-model'
    const bx = POI.observation.x - 3
    const bz = POI.observation.z + 9
    const gy = hf.heightAt(bx, bz)
    this.centre.set(bx, gy + 1.3, bz)
    const plinthMat = new THREE.MeshStandardMaterial({ color: '#15171c', roughness: 0.55, metalness: 0.5 })
    const trimMat = new THREE.MeshStandardMaterial({ color: '#2a0d10', emissive: new THREE.Color('#c0372c'), emissiveIntensity: 0.35, roughness: 0.5 })
    const width = 8.2
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(width, 1.0, 2.4), plinthMat)
    plinth.position.set(bx, gy + 0.5, bz)
    plinth.castShadow = true
    plinth.receiveShadow = true
    const trim = new THREE.Mesh(new THREE.BoxGeometry(width + 0.2, 0.08, 2.6), trimMat)
    trim.position.set(bx, gy + 1.02, bz)
    this.group.add(plinth, trim)
    physics?.addStaticBox(new THREE.Vector3(bx, gy + 0.5, bz), new THREE.Vector3(width, 1.0, 2.4))
    const tileMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, flatShading: true })
    const glowMat = () => new THREE.MeshBasicMaterial({ color: '#35f2d2', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
    for (let i = 0; i < 4; i += 1) {
      const x = bx + (i - 1.5) * 2.0
      const holder = new THREE.Group()
      holder.position.set(x, gy + 1.08, bz)
      const src = v2?.stages[i]?.group.children[0] as THREE.Mesh | undefined
      if (src) {
        const m = new THREE.Mesh(src.geometry, tileMat)
        m.scale.setScalar(0.125)
        m.castShadow = true
        holder.add(m)
        this.tiles.push(m)
      } else {
        // Fallback if the GLB failed to load: a flat tile so the model still reads.
        const m = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.2, 1.7), new THREE.MeshStandardMaterial({ color: ['#3a1612', '#4a3a22', '#33492a', '#2a5a3a'][i] }))
        holder.add(m)
        this.tiles.push(m)
      }
      const glow = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.04, 1.86), glowMat())
      glow.position.y = -0.02
      holder.add(glow)
      this.glows.push(glow)
      const label = this.makeLabel(ECO_STAGES[i].name.toUpperCase())
      label.position.set(0, 1.55, 0)
      holder.add(label)
      this.labels.push(label)
      this.group.add(holder)
    }
    this.marker = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 4), new THREE.MeshBasicMaterial({ color: '#35f2d2' }))
    this.marker.rotation.x = Math.PI
    this.group.add(this.marker)
  }
  private makeLabel(text: string): THREE.Sprite {
    const c = document.createElement('canvas')
    c.width = 256
    c.height = 64
    const g = c.getContext('2d')!
    g.fillStyle = 'rgba(8,8,12,0.7)'
    g.fillRect(0, 12, 256, 40)
    g.font = '600 26px Rajdhani, Arial, sans-serif'
    g.textAlign = 'center'
    g.fillStyle = '#e8d9c8'
    g.fillText(text, 128, 42)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }))
    s.scale.set(1.8, 0.45, 1)
    return s
  }
  /** Light the tile that matches the real ecological state; the marker bobs above it. */
  update(time: number, stage: EcoStageIndex, vit: number): void {
    void vit
    if (stage !== this.shown) this.shown = stage
    for (let i = 0; i < 4; i += 1) {
      const m = this.glows[i].material as THREE.MeshBasicMaterial
      const target = i === stage ? 0.55 + 0.25 * Math.sin(time * 2.4) : i < stage ? 0.12 : 0
      m.opacity += (target - m.opacity) * 0.1
    }
    const holderX = this.centre.x + (stage - 1.5) * 2.0
    this.marker.position.set(holderX, this.centre.y + 1.2 + 0.07 * Math.sin(time * 2.2), this.centre.z)
    this.marker.rotation.y = time * 1.4
    this.level = U.uVit.value
  }
  get currentLevel(): number {
    return this.level
  }
}
