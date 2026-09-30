import type { ComponentPropsWithRef } from 'react'
import { ScrollArea } from './scroll-area'

type BoardSurfaceTone = 'mint' | 'lavender' | 'sand' | 'parchment' | 'slate' | 'navy' | 'teal'

export interface IBoardSurfaceProps extends ComponentPropsWithRef<'section'> {
  tone: BoardSurfaceTone
}

export interface IBoardScrollProps extends ComponentPropsWithRef<'div'> {}

const BoardSurface = ({ className, tone, ...sectionProps }: IBoardSurfaceProps) => (
  <section
    className={['halo-tab-surface', `halo-surface-${tone}`, className].filter(Boolean).join(' ')}
    {...sectionProps}
  />
)

const BoardScroll = ({ className, ref, ...scrollProps }: IBoardScrollProps) => (
  <ScrollArea
    {...scrollProps}
    className={['halo-inner-scroll', className].filter(Boolean).join(' ')}
    data-scroll-owner="inner"
    viewportRef={ref}
  />
)

export { BoardScroll, BoardSurface }
