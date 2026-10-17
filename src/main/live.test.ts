import { describe, expect, it, vi } from 'vitest'
import type { LiveEvent } from '@shared/live'
import { LIVE_RUNS_KEPT, LineSplitter, LiveBus } from './live'

const agent = { name: 'Droid', mode: 'scripted' as const, where: 'mac' as const }
const begin = (bus: LiveBus, scanId: string): void =>
  bus.begin({ scanId, filename: 'f.sh', size: 1, sha256: null, agent })

describe('LiveBus', () => {
  it('stamps events in order and pushes each one', () => {
    const pushed: Array<[string, LiveEvent]> = []
    const bus = new LiveBus((id, e) => pushed.push([id, e]))
    begin(bus, 's1')
    bus.emit('s1', { kind: 'stage', stage: 'caught', state: 'done', detail: 'held' })
    bus.emit('s1', { kind: 'term', source: 'aegis', stream: 'cmd', text: 'daytona create' })
    expect(pushed.map(([id, e]) => [id, e.seq, e.kind])).toEqual([
      ['s1', 1, 'stage'],
      ['s1', 2, 'term']
    ])
    expect(pushed[0][1].at).toMatch(/^\d{4}-\d\d-\d\dT/)
    expect(bus.get('s1')?.events).toHaveLength(2)
  })

  it('keeps only the latest frame, outside the event list, with a fresh seq', () => {
    const bus = new LiveBus(() => undefined)
    begin(bus, 's1')
    bus.emit('s1', { kind: 'frame', jpeg: 'a' })
    bus.emit('s1', { kind: 'term', source: 'sample', stream: 'out', text: 'hi' })
    bus.emit('s1', { kind: 'frame', jpeg: 'b' })
    const run = bus.get('s1')!
    expect(run.events.map((e) => e.kind)).toEqual(['term'])
    expect(run.frame).toMatchObject({ jpeg: 'b', seq: 3 })
    expect(run.events[0].seq).toBe(2)
  })

  it('marks the run finished at the end event', () => {
    const bus = new LiveBus(() => undefined)
    begin(bus, 's1')
    expect(bus.get('s1')?.finished).toBe(false)
    bus.emit('s1', { kind: 'end', ok: true, verdict: 'clean', summary: '', sandboxDeleted: true })
    expect(bus.get('s1')?.finished).toBe(true)
  })

  it('ignores events for runs it does not know', () => {
    const push = vi.fn()
    const bus = new LiveBus(push)
    bus.emit('nope', { kind: 'frame', jpeg: 'a' })
    expect(push).not.toHaveBeenCalled()
    expect(bus.get('nope')).toBeNull()
  })

  it(`forgets the oldest run beyond ${LIVE_RUNS_KEPT}`, () => {
    const bus = new LiveBus(() => undefined)
    for (let i = 0; i <= LIVE_RUNS_KEPT; i++) begin(bus, `s${i}`)
    expect(bus.get('s0')).toBeNull()
    expect(bus.get(`s${LIVE_RUNS_KEPT}`)).not.toBeNull()
  })
})

describe('LineSplitter', () => {
  it('returns whole lines and keeps the partial one for the next chunk', () => {
    const s = new LineSplitter()
    expect(s.push('+ echo hi\n+ cu')).toEqual(['+ echo hi'])
    expect(s.push('rl x\nhel')).toEqual(['+ curl x'])
    expect(s.flush()).toEqual(['hel'])
    expect(s.flush()).toEqual([])
  })
})
