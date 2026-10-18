// Settings — "This Mac" (figma/screens.md §4, adapted): policy toggles beside connections, API
// keys beside trusted sites and the sandbox budget, permissions beside the privacy statement.

import { useState } from 'react'
import type { Settings } from '@shared/ipc'
import type { AppStatus, ServiceHealth, ServiceKey } from '@shared/types'
import { StatusDot } from '../../components/aegis'
import { AlertBanner, Button, Card, EmptyState, Field, Meter, Toggle } from '../../components/ds'
import { useInvoke } from '../../lib/hooks'

// BUILD_PROMPT §5.2. Must stay true: update it if the build differs.
const PRIVACY_COPY =
  "Documents that look clean are checked on this Mac and never uploaded. Risky files and suspicious links are opened in a Daytona sandbox in the cloud, which is deleted after each scan. Droid, Factory's AI analyst, reads what Aegis's checks find in a risky file, including parts of its text, with secrets masked; it never gets the file itself. Link domains (with tokens removed) are checked with Chalk and Google Safe Browsing. Page text is checked for scams by an AI model through Chalk and isn't stored. Your Chrome cookies never leave Chrome."

const KEYS: Array<{ service: ServiceKey; env: string; where: string }> = [
  { service: 'daytona', env: 'DAYTONA_API_KEY', where: 'Daytona dashboard › API keys' },
  { service: 'droid', env: 'FACTORY_API_KEY', where: 'Factory app › Settings › API keys' },
  { service: 'photon', env: 'PHOTON_*', where: 'Photon dashboard' },
  { service: 'chalk', env: 'CHALK_*', where: 'Chalk dashboard › Settings › Access tokens' },
  {
    service: 'safeBrowsing',
    env: 'SAFE_BROWSING_KEY',
    where: 'Google Cloud console › Safe Browsing API'
  }
]

const STATE_WORD: Record<ServiceHealth['state'], string> = {
  ok: 'Connected',
  degraded: 'Degraded',
  down: 'Down',
  unconfigured: 'Not set up',
  pending: 'Not checked'
}

function PolicyRow({
  label,
  hint,
  checked,
  onChange,
  disabled
}: {
  label: string
  hint: string
  checked: boolean
  onChange: () => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <div className="ae-rows__row">
      <div>
        <p className="ae-rows__label">{label}</p>
        <p className="ae-rows__hint">{hint}</p>
      </div>
      <Toggle
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        label={<span className="sr-only">{label}</span>}
      />
    </div>
  )
}

export default function SettingsView({ status }: { status: AppStatus | null }): React.JSX.Element {
  const [refreshing, setRefreshing] = useState(false)
  const { data: settings, set: setSettingsState } = useInvoke('settings:get')
  const { data: trusted, set: setTrusted } = useInvoke('trusted:list')

  const health = status?.health ?? []
  const byKey = (k: ServiceKey): ServiceHealth | undefined => health.find((h) => h.key === k)
  const notReady = health.filter((h) => h.required && h.state !== 'ok' && h.state !== 'pending')

  const update = async (patch: Partial<Settings>): Promise<void> => {
    setSettingsState(await window.aegis.invoke('settings:set', patch))
  }
  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    try {
      await window.aegis.invoke('health:refresh')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <>
      <div className="grid grid-cols-2 items-start gap-5">
        <Card title="Protection" description="What Aegis does before you open anything.">
          {settings ? (
            <div className="ae-rows">
              <PolicyRow
                label="Hold risky downloads until I decide"
                hint="Off is warn mode: files are delivered with the verdict and report."
                checked={settings.mode === 'block'}
                onChange={() => void update({ mode: settings.mode === 'block' ? 'warn' : 'block' })}
              />
              <PolicyRow
                label="Open suspicious links in a sandbox"
                hint="Shorteners, new domains and suspicious links are detonated in Daytona first."
                checked={settings.autoDetonate}
                onChange={() => void update({ autoDetonate: !settings.autoDetonate })}
              />
              <PolicyRow
                label="Quarantine files from other apps"
                hint="Safari, Mail, Slack and AirDrop files in ~/Downloads are scanned first."
                checked={settings.watchDownloads}
                onChange={() => void update({ watchDownloads: !settings.watchDownloads })}
              />
              <PolicyRow
                label="Pop up the mini panel"
                hint="Without taking focus, when a download is held or a link is blocked."
                checked={settings.panelAutoPop}
                onChange={() => void update({ panelAutoPop: !settings.panelAutoPop })}
              />
              <PolicyRow
                label="Text me when Aegis blocks something"
                hint={
                  byKey('photon')?.state === 'ok'
                    ? 'Sent through Photon to AEGIS_ALERT_PHONE.'
                    : 'Needs Photon (milestone 5).'
                }
                checked={settings.alertTexts}
                disabled={byKey('photon')?.state !== 'ok'}
                onChange={() => void update({ alertTexts: !settings.alertTexts })}
              />
            </div>
          ) : null}
        </Card>

        <div className="flex flex-col gap-5">
          <Card
            title="Connections"
            description="Checked every 60 seconds. At start and on Check now, Daytona and Droid also run a live test, which uses credits."
            action={
              <Button
                size="sm"
                variant="secondary"
                icon="refresh"
                onClick={() => void refresh()}
                disabled={refreshing}
              >
                {refreshing ? 'Checking…' : 'Check now'}
              </Button>
            }
          >
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {health.map((h) => (
                <li
                  key={h.key}
                  className="flex items-center justify-between gap-4"
                  title={h.detail}
                >
                  <span className="text-[13px] leading-[19px] text-ink-muted">
                    {h.name}
                    {h.required ? '' : ' · optional'}
                  </span>
                  <StatusDot
                    state={h.state}
                    label={
                      h.latencyMs !== undefined && h.state === 'ok'
                        ? `${STATE_WORD[h.state]} · ${h.latencyMs} ms`
                        : STATE_WORD[h.state]
                    }
                  />
                </li>
              ))}
            </ul>
          </Card>
          {notReady.length > 0 ? (
            <AlertBanner
              tone="warning"
              title={`${notReady.length} required connection${notReady.length > 1 ? 's' : ''} not ready`}
            >
              {notReady.map((h) => `${h.name}: ${h.detail}`).join(' ')}
            </AlertBanner>
          ) : null}
        </div>

        <Card
          title="API keys"
          description="Read from .env by the main process only. This window and the Chrome extension never see them."
        >
          <div className="flex flex-col gap-4">
            {KEYS.map((k) => {
              const h = byKey(k.service)
              const set = h && h.state !== 'unconfigured'
              return (
                <Field
                  key={k.env}
                  label={k.env}
                  icon="key"
                  readOnly
                  disabled={!set}
                  value={set ? 'Set in .env' : 'Not set'}
                  hint={set ? undefined : k.where}
                  error={h?.state === 'down' ? h.detail : undefined}
                />
              )
            })}
            <p className="m-0 text-[12px] leading-4 text-ink-subtle">
              Add keys to .env at the project root (see .env.example) and restart Aegis. Pasting
              keys here, stored with Electron safeStorage, comes with the sponsor milestones.
            </p>
          </div>
        </Card>

        <div className="flex flex-col gap-5">
          <Card
            title="Trusted sites"
            description="Skip the link heuristics; Safe Browsing and threat feeds still run. Add one from a warning with Trust this site."
          >
            {trusted && trusted.length > 0 ? (
              <ul className="m-0 list-none p-0">
                {trusted.map((t) => (
                  <li
                    key={t.domain}
                    className="flex items-center justify-between border-b border-border py-2.5 last:border-b-0"
                  >
                    <span className="mono selectable text-ink">{t.domain}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="x"
                      aria-label={`Remove ${t.domain}`}
                      onClick={async () =>
                        setTrusted(await window.aegis.invoke('trusted:remove', t.domain))
                      }
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon="globe"
                title="No trusted sites"
                description="Every link gets every check."
              />
            )}
          </Card>
          <Card
            title="Sandbox budget"
            description="Automatic detonations stop for the day at the budget. Downloads and links you inspect always run."
          >
            <Meter
              label="Sandbox jobs today"
              value={0}
              display={`0 of ${settings?.sandboxDailyBudget ?? 200}`}
            />
          </Card>
        </div>

        <Card
          title="Permissions"
          description="macOS ties these to the app's identity. Under pnpm dev they apply to Electron itself."
        >
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {(['downloads', 'fnKey', 'bridge'] as ServiceKey[]).map((k) => {
              const h = byKey(k)
              return h ? (
                <li key={k} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-[14px] leading-5 font-semibold text-ink">{h.name}</span>
                    <StatusDot state={h.state} label={STATE_WORD[h.state]} />
                  </div>
                  <span className="text-[12px] leading-4 text-ink-subtle">{h.detail}</span>
                  {k === 'fnKey' && h.state === 'degraded' ? (
                    <div className="mt-1">
                      <Button
                        size="sm"
                        variant="secondary"
                        icon="key"
                        onClick={() => void window.aegis.invoke('fnkey:retry')}
                      >
                        Allow Input Monitoring
                      </Button>
                    </div>
                  ) : null}
                </li>
              ) : null
            })}
          </ul>
          <p className="m-0 mt-4 text-[12px] leading-4 text-ink-subtle">
            For the fn key, set System Settings › Keyboard › “Press fn (Globe) key to” › Do Nothing,
            or macOS also opens the emoji picker.
          </p>
        </Card>

        <Card title="What leaves this Mac" highlight>
          <p className="body m-0 text-ink">{PRIVACY_COPY}</p>
        </Card>
      </div>
    </>
  )
}
