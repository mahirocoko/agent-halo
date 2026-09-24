import type {
  ComponentPropsWithoutRef,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  Ref,
  UIEventHandler,
} from 'react'
import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react'

interface IScrollMetrics {
  maxScroll: number
  offset: number
  scrollTop: number
  thumbSize: number
  visible: boolean
}

export interface IScrollAreaProps extends Omit<ComponentPropsWithoutRef<'div'>, 'className' | 'onScroll'> {
  className?: string
  onScroll?: UIEventHandler<HTMLDivElement>
  viewportRef?: Ref<HTMLDivElement>
}

const EMPTY_METRICS: IScrollMetrics = {
  maxScroll: 0,
  offset: 0,
  scrollTop: 0,
  thumbSize: 0,
  visible: false,
}

const setRef = <T,>(ref: Ref<T> | undefined, value: T | null) => {
  if (typeof ref === 'function') ref(value)
  else if (ref) ref.current = value
}

const ScrollArea = ({ children, className, onScroll, viewportRef, ...viewportProps }: IScrollAreaProps) => {
  const generatedId = useId()
  const viewportElement = useRef<HTMLDivElement | null>(null)
  const [metrics, setMetrics] = useState(EMPTY_METRICS)
  const viewportId = viewportProps.id ?? generatedId

  const updateMetrics = useCallback(() => {
    const viewport = viewportElement.current
    const root = viewport?.parentElement
    if (!viewport || !root) return

    const trackLength = Math.max(root.clientHeight - 8, 0)
    const scrollHeight = viewport.scrollHeight
    const maxScroll = Math.max(scrollHeight - viewport.clientHeight, 0)
    const visible = maxScroll > 1 && trackLength > 0
    const thumbSize = visible
      ? Math.max(28, Math.min(trackLength, (viewport.clientHeight / scrollHeight) * trackLength))
      : 0
    const maxOffset = Math.max(trackLength - thumbSize, 0)

    setMetrics({
      maxScroll,
      offset: maxScroll > 0 ? (viewport.scrollTop / maxScroll) * maxOffset : 0,
      scrollTop: viewport.scrollTop,
      thumbSize,
      visible,
    })
  }, [])

  const setViewport = useCallback(
    (node: HTMLDivElement | null) => {
      viewportElement.current = node
      setRef(viewportRef, node)
    },
    [viewportRef],
  )

  useLayoutEffect(() => {
    updateMetrics()
    const viewport = viewportElement.current
    if (!viewport) return undefined

    const resizeObserver = new ResizeObserver(updateMetrics)
    const observeContent = () => {
      for (const child of viewport.children) resizeObserver.observe(child)
      updateMetrics()
    }
    const mutationObserver = new MutationObserver(observeContent)
    resizeObserver.observe(viewport)
    observeContent()
    mutationObserver.observe(viewport, { characterData: true, childList: true, subtree: true })
    return () => {
      resizeObserver.disconnect()
      mutationObserver.disconnect()
    }
  }, [updateMetrics])

  const handleScroll: UIEventHandler<HTMLDivElement> = (event) => {
    updateMetrics()
    onScroll?.(event)
  }

  const scrollBy = (amount: number) => {
    viewportElement.current?.scrollBy({ behavior: 'smooth', top: amount })
  }

  const handleScrollbarKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const viewport = viewportElement.current
    if (!viewport) return

    if (event.key === 'ArrowDown') scrollBy(40)
    else if (event.key === 'ArrowUp') scrollBy(-40)
    else if (event.key === 'PageDown') scrollBy(viewport.clientHeight)
    else if (event.key === 'PageUp') scrollBy(-viewport.clientHeight)
    else if (event.key === 'Home') viewport.scrollTo({ behavior: 'smooth', top: 0 })
    else if (event.key === 'End') viewport.scrollTo({ behavior: 'smooth', top: viewport.scrollHeight })
    else return

    event.preventDefault()
  }

  const handleThumbPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const viewport = viewportElement.current
    if (!viewport || !metrics.visible) return

    event.preventDefault()
    const startY = event.clientY
    const startScrollTop = viewport.scrollTop
    const maxScroll = Math.max(viewport.scrollHeight - viewport.clientHeight, 0)
    const maxOffset = Math.max(viewport.clientHeight - 8 - metrics.thumbSize, 1)

    const handlePointerMove = (moveEvent: PointerEvent) => {
      viewport.scrollTop = startScrollTop + ((moveEvent.clientY - startY) / maxOffset) * maxScroll
    }
    const handlePointerUp = () => {
      document.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('pointerup', handlePointerUp)
    }

    document.addEventListener('pointermove', handlePointerMove)
    document.addEventListener('pointerup', handlePointerUp, { once: true })
  }

  return (
    <div className="scroll-area" data-scrollable={metrics.visible}>
      <div
        {...viewportProps}
        className={['scroll-area-viewport', className].filter(Boolean).join(' ')}
        id={viewportId}
        onScroll={handleScroll}
        ref={setViewport}
      >
        {children}
      </div>
      <div
        aria-controls={viewportId}
        aria-hidden={!metrics.visible}
        aria-label="Scroll content"
        aria-orientation="vertical"
        aria-valuemax={metrics.maxScroll}
        aria-valuemin={0}
        aria-valuenow={metrics.scrollTop}
        className="scroll-area-scrollbar"
        onKeyDown={handleScrollbarKeyDown}
        role="scrollbar"
        tabIndex={metrics.visible ? 0 : -1}
      >
        <div
          className="scroll-area-thumb"
          onPointerDown={handleThumbPointerDown}
          style={{ height: `${metrics.thumbSize}px`, transform: `translateY(${metrics.offset}px)` }}
        />
      </div>
    </div>
  )
}

export { ScrollArea }
