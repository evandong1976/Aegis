// Gets a sandbox ready for Droid's tools, once the sample is in it (and, for the live view, after
// it has run): stop anything the run left behind, upload the inspector (sandbox/aegis_inspect.py)
// into a fresh folder and check its SHA-256, run its `identify` check, and pick the tools for the
// file's type from the reference (fileTypes.ts). Both pipelines use it: the live view
// (sandboxScan.ts) and downloads (scans.ts, through index.ts).
//
// No `@shared` imports and `.ts` extensions on local imports: scripts/try-analyst.mts runs this
// file directly under Node.

import { randomBytes } from 'node:crypto'
import { SAMPLE_PATH, sha256Hex, type SandboxSession } from './daytona.ts'
import {
  INSPECTOR_FILE,
  INSPECTOR_PYTHON,
  inspectorToolSpecs,
  sandboxToolSpecs,
  type SandboxToolSpec
} from './droidLockdown.ts'
import {
  identifiedFrom,
  matchFileType,
  parseInspectorResult,
  type FileTypeMatch,
  type ReferenceRow
} from './fileTypes.ts'

/**
 * Stops every process the sample started, found by the marker observeCommand puts in its
 * environment. A run limited by `timeout` can still leave a background child that waits, then
 * rewrites the sample or the inspector after they are checked. (A child that clears its own
 * environment escapes this; describe_sample's hash check is the backstop.)
 */
export const STOP_LEFTOVERS =
  'for p in /proc/[0-9]*; do ' +
  'if tr "\\0" "\\n" < "$p/environ" 2>/dev/null | grep -qx AEGIS_SANDBOX=1; then kill -9 "${p#/proc/}" 2>/dev/null; fi; ' +
  'done; true'

export interface ToolkitInput {
  filename: string
  /** sandbox/aegis_inspect.py, or null to offer only the general tools. */
  inspector: Buffer | null
  rows: ReferenceRow[]
}

export interface Toolkit {
  match: FileTypeMatch
  tools: SandboxToolSpec[]
  /** The identify check's full output, if it ran. */
  identify: string | null
  /** Why the inspector isn't available, if it isn't. */
  problem: string | null
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export async function prepareToolkit(
  session: SandboxSession,
  input: ToolkitInput
): Promise<Toolkit> {
  const general = sandboxToolSpecs(SAMPLE_PATH)
  await session.exec('stop what the sample left running', STOP_LEFTOVERS, 20).catch(() => undefined)
  if (!input.inspector) {
    return {
      match: matchFileType(input.rows, input.filename, null),
      tools: general,
      identify: null,
      problem: 'the inspector is not available'
    }
  }
  const dir = `.aegis-${randomBytes(6).toString('hex')}`
  const path = `${dir}/${INSPECTOR_FILE}`
  try {
    const started = performance.now()
    await session.sandbox.fs.createFolder(dir, '700')
    await session.sandbox.fs.uploadFile(input.inspector, path)
    session.record({
      step: 'upload inspector',
      ok: true,
      bytes: input.inspector.length,
      detail: path,
      started
    })
    const hashed = await session.exec('check inspector', `sha256sum ${path}`, 15)
    if (hashed.result.trim().split(/\s+/)[0] !== sha256Hex(input.inspector)) {
      throw new Error('the inspector arrived changed')
    }
  } catch (err) {
    return {
      match: matchFileType(input.rows, input.filename, null),
      tools: general,
      identify: null,
      problem: `the inspector could not be set up: ${message(err)}`
    }
  }
  const identify = await session
    .exec('identify', `${INSPECTOR_PYTHON} ${path} identify ${SAMPLE_PATH}`, 30)
    .catch(() => null)
  const identified = identify ? identifiedFrom(parseInspectorResult(identify.result)) : null
  const match = matchFileType(input.rows, input.filename, identified)
  return {
    match,
    tools: [...general, ...inspectorToolSpecs(SAMPLE_PATH, dir, match.families)],
    identify: identify?.result ?? null,
    problem: identified ? null : 'the identify check gave no result; tools chosen by name only'
  }
}
