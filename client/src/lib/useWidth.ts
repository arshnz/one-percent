import { useEffect, useRef, useState } from 'react'

/**
 * Measure a container so a chart can be drawn at real pixel size rather than by
 * stretching a viewBox — a stretched viewBox distorts stroke widths and text.
 * (The same reasoning, and the same hook, as the one inside CompoundCurve.)
 */
export function useWidth(min = 280) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(560)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.getBoundingClientRect().width)
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return [ref, Math.max(width, min)] as const
}
