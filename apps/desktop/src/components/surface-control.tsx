import type { ComponentPropsWithRef } from 'react'

export interface ISurfaceControlProps extends ComponentPropsWithRef<'button'> {
  surfaceControlShape?: 'rounded' | 'circle'
  surfaceControlSize?: 'regular' | 'compact' | 'compact-small' | 'icon'
  surfaceControlVariant?: 'default' | 'primary' | 'subtle' | 'armed-danger'
}

const SurfaceControl = ({
  children,
  className,
  surfaceControlShape = 'rounded',
  surfaceControlSize = 'regular',
  surfaceControlVariant = 'default',
  ...buttonProps
}: ISurfaceControlProps) => (
  <button
    className={['surface-control', className].filter(Boolean).join(' ')}
    data-surface-control-shape={surfaceControlShape}
    data-surface-control-size={surfaceControlSize}
    data-surface-control-variant={surfaceControlVariant}
    {...buttonProps}
  >
    {children}
  </button>
)

export { SurfaceControl }
