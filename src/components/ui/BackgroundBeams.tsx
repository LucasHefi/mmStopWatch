import { memo, useEffect, useRef } from 'react'

export interface BackgroundBeamsProps {
  className?: string
}

const MAX_CANVAS_WIDTH = 480
const FRAME_INTERVAL_MS = 1000 / 18

function createGlowSprite(innerColor: string): HTMLCanvasElement {
  const sprite = document.createElement('canvas')
  sprite.width = 160
  sprite.height = 160
  const context = sprite.getContext('2d')
  if (!context) return sprite
  const gradient = context.createRadialGradient(80, 80, 0, 80, 80, 80)
  gradient.addColorStop(0, innerColor)
  gradient.addColorStop(0.42, innerColor.replace('0.28', '0.11'))
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 160, 160)
  return sprite
}

function drawGlow(
  context: CanvasRenderingContext2D,
  sprite: HTMLCanvasElement,
  x: number,
  y: number,
  radiusX: number,
  radiusY: number,
  rotation: number,
): void {
  context.save()
  context.translate(x, y)
  context.rotate(rotation)
  context.drawImage(sprite, -radiusX, -radiusY, radiusX * 2, radiusY * 2)
  context.restore()
}

export const BackgroundBeams = memo(({ className = '' }: BackgroundBeamsProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d', { alpha: true })
    if (!canvas || !context) return

    let frameId = 0
    let lastFrame = 0
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const glowSprites = [
      createGlowSprite('rgba(24, 204, 252, 0.28)'),
      createGlowSprite('rgba(174, 72, 255, 0.28)'),
      createGlowSprite('rgba(99, 68, 245, 0.28)'),
    ]

    const resize = () => {
      const width = Math.min(MAX_CANVAS_WIDTH, Math.max(240, Math.round(canvas.clientWidth / 2)))
      const ratio = canvas.clientHeight / Math.max(canvas.clientWidth, 1)
      canvas.width = width
      canvas.height = Math.max(140, Math.round(width * ratio))
    }

    const render = (now: number) => {
      frameId = window.requestAnimationFrame(render)
      if (document.hidden || (!reduceMotion && now - lastFrame < FRAME_INTERVAL_MS)) return
      if (reduceMotion && lastFrame > 0) return
      lastFrame = now

      const width = canvas.width
      const height = canvas.height
      const phase = now * 0.00016
      context.clearRect(0, 0, width, height)
      context.globalCompositeOperation = 'screen'
      drawGlow(context, glowSprites[0], width * (0.24 + Math.sin(phase) * 0.12), height * (0.28 + Math.cos(phase * 0.8) * 0.12), width * 0.48, height * 0.18, 0.34)
      drawGlow(context, glowSprites[1], width * (0.72 + Math.cos(phase * 0.72) * 0.13), height * (0.67 + Math.sin(phase * 0.9) * 0.14), width * 0.45, height * 0.2, -0.4)
      drawGlow(context, glowSprites[2], width * (0.5 + Math.sin(phase * 0.55) * 0.16), height * (0.48 + Math.cos(phase * 0.6) * 0.1), width * 0.38, height * 0.12, 0.12)
    }

    resize()
    window.addEventListener('resize', resize)
    frameId = window.requestAnimationFrame(render)
    return () => {
      window.cancelAnimationFrame(frameId)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <div aria-hidden="true" className={`ambient-light-field pointer-events-none absolute inset-0 overflow-hidden ${className}`}>
      <canvas ref={canvasRef} className="ambient-canvas absolute inset-0 h-full w-full" />
    </div>
  )
})

BackgroundBeams.displayName = 'BackgroundBeams'
