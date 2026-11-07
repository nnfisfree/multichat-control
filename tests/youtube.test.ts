import { describe, expect, it } from 'vitest'
import { canonicalType, normalize } from '../src/main/platforms/youtube/normalize'

const author = { channelId: 'c1', displayName: 'Pete', isChatOwner: false, isChatModerator: true, isChatSponsor: false }
const item = (snippet: any) => ({ id: 'y1', snippet: { publishedAt: '2026-01-01T00:00:00Z', ...snippet }, authorDetails: author })

describe('canonicalType', () => {
  it('maps gRPC enum names to REST names', () => {
    expect(canonicalType('SUPER_CHAT_EVENT')).toBe('superChatEvent')
    expect(canonicalType('textMessageEvent')).toBe('textMessageEvent')
  })
})

describe('normalize', () => {
  it('reads gRPC and REST text messages alike', () => {
    for (const type of ['TEXT_MESSAGE_EVENT', 'textMessageEvent']) {
      expect(normalize(item({ type, textMessageDetails: { messageText: 'hello' } })).message?.parts).toEqual([{ type: 'text', text: 'hello' }])
    }
  })
  it('turns a Super Chat into a highlighted message and an event', () => {
    const r = normalize(item({ type: 'SUPER_CHAT_EVENT', superChatDetails: { amountDisplayString: '€5.00', userComment: 'nice', tier: 2 } }))
    expect(r.message).toMatchObject({ kind: 'paid', label: '€5.00' })
    expect(r.event).toMatchObject({ type: 'paid', amount: '€5.00' })
  })
  it('reports deletions and bans', () => {
    expect(normalize(item({ type: 'messageDeletedEvent', messageDeletedDetails: { deletedMessageId: 'z' } })).deleted).toBe('z')
    const r = normalize(item({ type: 'USER_BANNED_EVENT', userBannedDetails: { banType: 'TEMPORARY', banDurationSeconds: '60', bannedUserDetails: { channelId: 'b', displayName: 'Bad' } } }))
    expect(r.purgedUser).toBe('b')
    expect(r.event?.text).toBe('timed out Bad')
  })
  it('recognises the end of a chat', () => {
    expect(normalize(item({ type: 'CHAT_ENDED_EVENT' })).ended).toBe(true)
  })
})
