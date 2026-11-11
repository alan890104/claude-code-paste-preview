import type { ClientModule } from 'claude-code'

import { isOnBadge } from './badge'

type Props = { n: number; columns: number; rows: number }

// Over a thumbnail in the band: a click on its close badge asks the hooks module to drop
// the picture from the draft. Elsewhere on the picture a click does nothing.
const Click: ClientModule<Props> = (props, surface) => {
  surface.onPointer(event => {
    if (event.type !== 'up' || event.button !== 'left') return
    const x = event.fine?.x ?? event.x + 0.5
    const y = event.fine?.y ?? event.y + 0.5
    if (isOnBadge(x, y, props.columns, props.rows)) surface.post({ n: props.n, action: 'remove' })
  })
  return surface.elements.Box({})
}

export default Click
