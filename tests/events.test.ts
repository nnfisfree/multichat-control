import { describe, expect, it } from 'vitest'
import { EVENT_BADGE, eventToMessage } from '../src/shared/events'
import type { StreamEvent } from '../src/shared/types'

const e = (over: Partial<StreamEvent>): StreamEvent => ({ id: '1', platform: 'twitch', ts: 1, type: 'sub', text: 'subscribed', details: {}, ...over })

describe('EVENT_BADGE', () => {
  it('marks channel points as CP', () => {
    expect(EVENT_BADGE.redemption).toBe('CP')
  })
})

describe('eventToMessage', () => {
  it('turns subs into chat cards', () => {
    expect(eventToMessage(e({ actor: 'A' }))).toMatchObject({ id: 'event:1', kind: 'event', platform: 'twitch' })
  })
  it('skips events already shown as messages', () => {
    expect(eventToMessage(e({ noChat: true }))).toBeNull()
  })
  it('leaves moderation in the drawer only', () => {
    expect(eventToMessage(e({ type: 'moderation' }))).toBeNull()
  })
})
