import { readFileSync } from 'fs'
import { describe, expect, it, vi } from 'vitest'
import { SAMPLE_PATH, SandboxSession, sha256Hex, type SandboxLike } from './daytona'
import { REFERENCE_ROWS } from './droidAssets'
import { STOP_LEFTOVERS, prepareToolkit } from './droidToolkit'

const INSPECTOR = readFileSync('sandbox/aegis_inspect.py')
const identifyResult = (extra: Record<string, unknown>): string =>
  `== What the file really is ==\nAEGIS_RESULT ${JSON.stringify({ check: 'identify', findings: [], facts: {}, extra })}\n`

interface Fake {
  session: SandboxSession
  commands: string[]
  folders: Array<[string, string]>
  files: Map<string, Buffer>
}

function fakeSession(opts: { tamper?: boolean; identify?: string } = {}): Fake {
  const files = new Map<string, Buffer>()
  const commands: string[] = []
  const folders: Array<[string, string]> = []
  const sandbox: SandboxLike = {
    id: 'sbx-1',
    networkBlockAll: true,
    fs: {
      createFolder: vi.fn(async (path: string, mode: string) => {
        folders.push([path, mode])
      }),
      uploadFile: vi.fn(async (file: Buffer, path: string) => {
        files.set(path, opts.tamper ? Buffer.from('print("changed")') : file)
      })
    },
    process: {
      executeCommand: vi.fn(async (cmd: string) => {
        commands.push(cmd)
        if (cmd.startsWith('sha256sum ')) {
          const path = cmd.slice('sha256sum '.length)
          return {
            exitCode: 0,
            result: `${sha256Hex(files.get(path) ?? Buffer.alloc(0))}  ${path}\n`
          }
        }
        if (cmd.includes(' identify ')) return { exitCode: 0, result: opts.identify ?? '' }
        return { exitCode: 0, result: '' }
      })
    },
    delete: vi.fn(async () => undefined)
  }
  return { session: new SandboxSession(sandbox), commands, folders, files }
}

describe('preparing the tools', () => {
  it('stops leftovers, uploads the inspector to a fresh folder, and picks tools by the bytes', async () => {
    const { session, commands, folders, files } = fakeSession({
      identify: identifyResult({
        family: 'shell',
        claimedFamily: 'image',
        label: 'shell script (sh)',
        strong: true
      })
    })
    const kit = await prepareToolkit(session, {
      filename: 'photo.jpg',
      inspector: INSPECTOR,
      rows: REFERENCE_ROWS
    })

    expect(commands[0]).toBe(STOP_LEFTOVERS)
    const [dir, mode] = folders[0]
    expect(dir).toMatch(/^\.aegis-[0-9a-f]{12}$/)
    expect(mode).toBe('700')
    expect(files.get(`${dir}/aegis_inspect.py`)).toEqual(INSPECTOR)
    expect(commands).toContain(`python3 -I ${dir}/aegis_inspect.py identify ${SAMPLE_PATH}`)

    expect(kit.problem).toBeNull()
    expect(kit.match).toMatchObject({ families: ['image', 'shell'], mismatch: true })
    const names = kit.tools.map((t) => t.name)
    expect(names.slice(0, 3)).toEqual(['list_sample_files', 'describe_sample', 'read_sample'])
    expect(names).toEqual(
      expect.arrayContaining(['identify_file', 'inspect_image', 'review_shell'])
    )
    expect(names).not.toContain('inspect_pdf')
    expect(session.log.map((e) => e.step)).toEqual([
      'stop what the sample left running',
      'upload inspector',
      'check inspector',
      'identify'
    ])
  })

  it('gives each scan its own folder', async () => {
    const a = fakeSession()
    const b = fakeSession()
    await prepareToolkit(a.session, {
      filename: 'x.pdf',
      inspector: INSPECTOR,
      rows: REFERENCE_ROWS
    })
    await prepareToolkit(b.session, {
      filename: 'x.pdf',
      inspector: INSPECTOR,
      rows: REFERENCE_ROWS
    })
    expect(a.folders[0][0]).not.toBe(b.folders[0][0])
  })

  it('offers only the general tools if the inspector arrives changed', async () => {
    const { session, commands } = fakeSession({ tamper: true })
    const kit = await prepareToolkit(session, {
      filename: 'invoice.pdf',
      inspector: INSPECTOR,
      rows: REFERENCE_ROWS
    })
    expect(kit.tools.map((t) => t.name)).toEqual([
      'list_sample_files',
      'describe_sample',
      'read_sample'
    ])
    expect(kit.problem).toContain('arrived changed')
    expect(kit.match.families).toEqual(['pdf'])
    expect(commands.some((c) => c.includes(' identify '))).toBe(false)
  })

  it('chooses by name when identify says nothing', async () => {
    const { session } = fakeSession({ identify: 'Traceback (most recent call last):\n' })
    const kit = await prepareToolkit(session, {
      filename: 'invoice.pdf',
      inspector: INSPECTOR,
      rows: REFERENCE_ROWS
    })
    expect(kit.tools.map((t) => t.name)).toContain('inspect_pdf')
    expect(kit.problem).toContain('by name only')
  })
})
