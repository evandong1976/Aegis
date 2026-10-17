// Typed React port of the Aegis design system (design-system/components/bundle.js).
// Same markup and `ae-*` classes, so design-system/components/bundle.css styles them unchanged.
// Read each component's README in design-system/components/<Comp>/ before using it.

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, Ref } from 'react'
import { useId } from 'react'
import { PATHS, type IconName } from './icons'

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/* ---- Icon ---------------------------------------------------------------- */
export interface IconProps {
  name: IconName
  size?: number
  strokeWidth?: number
  className?: string
}
export function Icon({
  name,
  size = 20,
  strokeWidth = 1.75,
  className
}: IconProps): React.JSX.Element {
  const paths = PATHS[name] ?? PATHS.shield
  return (
    <svg
      className={cx('ae-icon', className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  )
}

/* ---- Button -------------------------------------------------------------- */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  icon?: IconName
  iconEnd?: IconName
  full?: boolean
}
export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  iconEnd,
  full,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps): React.JSX.Element {
  const glyph = size === 'sm' ? 15 : 17
  return (
    <button
      type={type}
      className={cx(
        'ae-btn',
        `ae-btn--${variant}`,
        `ae-btn--${size}`,
        full && 'ae-btn--full',
        className
      )}
      {...rest}
    >
      {icon ? <Icon name={icon} size={glyph} /> : null}
      {children != null ? <span>{children}</span> : null}
      {iconEnd ? <Icon name={iconEnd} size={glyph} /> : null}
    </button>
  )
}

/* ---- SeverityBadge ------------------------------------------------------- */
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'secure'
const SEV: Record<Severity, { label: string; icon: IconName }> = {
  critical: { label: 'Critical', icon: 'shield-alert' },
  high: { label: 'High', icon: 'alert' },
  medium: { label: 'Medium', icon: 'info' },
  low: { label: 'Low', icon: 'activity' },
  secure: { label: 'Secure', icon: 'check-circle' }
}
export function SeverityBadge({
  level,
  subtle,
  children,
  className
}: {
  level: Severity
  subtle?: boolean
  children?: ReactNode
  className?: string
}): React.JSX.Element {
  const meta = SEV[level] ?? SEV.medium
  return (
    <span className={cx('ae-badge', `ae-badge--${level}`, subtle && 'ae-badge--subtle', className)}>
      <Icon name={meta.icon} size={13} strokeWidth={2} />
      <span>{children ?? meta.label}</span>
    </span>
  )
}

/* ---- Card ---------------------------------------------------------------- */
export interface CardProps {
  title?: ReactNode
  eyebrow?: ReactNode
  description?: ReactNode
  action?: ReactNode
  highlight?: boolean
  children?: ReactNode
  className?: string
}
export function Card({
  title,
  eyebrow,
  description,
  action,
  highlight,
  children,
  className
}: CardProps): React.JSX.Element {
  return (
    <section className={cx('ae-card', highlight && 'ae-card--glow', className)}>
      {title || action ? (
        <header className="ae-card__head">
          <div>
            {eyebrow ? <p className="ae-label ae-card__eyebrow">{eyebrow}</p> : null}
            {title ? <h3 className="ae-card__title">{title}</h3> : null}
            {description ? <p className="ae-card__desc">{description}</p> : null}
          </div>
          {action ? <div className="ae-card__action">{action}</div> : null}
        </header>
      ) : null}
      <div className="ae-card__body">{children}</div>
    </section>
  )
}

/* ---- StatTile ------------------------------------------------------------ */
export function Sparkline({ points }: { points: number[] }): React.JSX.Element | null {
  const w = 104
  const h = 32
  if (points.length < 2) return null
  const max = Math.max(...points)
  const min = Math.min(...points)
  const span = max - min || 1
  const d = points
    .map((v, i) => {
      const x = (i / (points.length - 1)) * w
      const y = h - ((v - min) / span) * (h - 4) - 2
      return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg className="ae-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={`${d} L${w} ${h} L0 ${h} Z`} className="ae-spark__fill" />
      <path d={d} className="ae-spark__line" />
    </svg>
  )
}

export interface StatTileProps {
  label: ReactNode
  value: ReactNode
  unit?: ReactNode
  icon?: IconName
  delta?: ReactNode
  direction?: 'up' | 'down'
  intent?: 'good' | 'bad'
  caption?: ReactNode
  points?: number[]
  className?: string
}
export function StatTile(props: StatTileProps): React.JSX.Element {
  const { label, value, unit, icon, delta, direction, intent, caption, points, className } = props
  const good = intent === 'good' ? 'up' : intent === 'bad' ? 'down' : null
  const tone = direction ? (direction === good ? 'pos' : 'neg') : 'flat'
  return (
    <article className={cx('ae-stat', className)}>
      <div className="ae-stat__top">
        <p className="ae-label">{label}</p>
        {icon ? (
          <span className="ae-stat__icon">
            <Icon name={icon} size={16} />
          </span>
        ) : null}
      </div>
      <p className="ae-stat__value">
        {value}
        {unit ? <span className="ae-stat__unit">{unit}</span> : null}
      </p>
      <div className="ae-stat__foot">
        {delta ? (
          <span className={`ae-delta ae-delta--${tone}`}>
            <Icon
              name={direction === 'down' ? 'trend-down' : 'trend-up'}
              size={13}
              strokeWidth={2}
            />
            <span>{delta}</span>
          </span>
        ) : null}
        {caption ? <span className="ae-stat__caption">{caption}</span> : null}
        {points ? <Sparkline points={points} /> : null}
      </div>
    </article>
  )
}

/* ---- ScoreRing ----------------------------------------------------------- */
export function ScoreRing({
  value,
  label,
  size = 168,
  strokeWidth = 12,
  className
}: {
  value: number
  label?: string
  size?: number
  strokeWidth?: number
  className?: string
}): React.JSX.Element {
  const v = Math.max(0, Math.min(100, value))
  const r = (size - strokeWidth) / 2
  const c = 2 * Math.PI * r
  return (
    <div className={cx('ae-ring', className)} style={{ width: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`${label ?? 'Score'}: ${v} of 100`}
      >
        <circle
          className="ae-ring__track"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={strokeWidth}
        />
        <circle
          className="ae-ring__bar"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={strokeWidth}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v / 100)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="ae-ring__center">
        <p className="ae-ring__value">{v}</p>
        {label ? <p className="ae-ring__label">{label}</p> : null}
      </div>
    </div>
  )
}

/* ---- ThreatTable --------------------------------------------------------- */
export interface ThreatColumn {
  key: string
  header: ReactNode
  /** Mono cells never wrap. */
  mono?: boolean
  /** Keep the cell on one line — hostnames and other values that must not break. */
  nowrap?: boolean
  align?: 'left' | 'right'
}
export function ThreatTable({
  columns,
  rows,
  onRowClick,
  className
}: {
  columns: ThreatColumn[]
  rows: Array<Record<string, ReactNode>>
  /** Aegis addition: makes rows open something (e.g. a report). */
  onRowClick?: (index: number) => void
  className?: string
}): React.JSX.Element {
  return (
    <div className={cx('ae-table-wrap', className)}>
      <table className="ae-table">
        <thead>
          <tr>
            {columns.map((col, i) => (
              <th key={i} className={cx(col.align === 'right' && 'is-right')} scope="col">
                <span className="ae-label">{col.header}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr
              key={ri}
              onClick={onRowClick ? () => onRowClick(ri) : undefined}
              className={onRowClick ? 'cursor-pointer' : undefined}
            >
              {columns.map((col, ci) => (
                <td
                  key={ci}
                  className={cx(
                    col.mono && 'ae-mono',
                    col.nowrap && 'is-nowrap',
                    col.align === 'right' && 'is-right'
                  )}
                >
                  {row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ---- AlertBanner --------------------------------------------------------- */
export type AlertTone = 'critical' | 'warning' | 'info' | 'success'
const ALERT_ICON: Record<AlertTone, IconName> = {
  critical: 'shield-alert',
  warning: 'alert',
  info: 'info',
  success: 'check-circle'
}
export function AlertBanner({
  tone,
  title,
  action,
  children,
  className
}: {
  tone: AlertTone
  title: ReactNode
  action?: ReactNode
  children?: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div
      className={cx('ae-alert', `ae-alert--${tone}`, className)}
      role={tone === 'critical' ? 'alert' : 'status'}
    >
      <span className="ae-alert__icon">
        <Icon name={ALERT_ICON[tone]} size={18} />
      </span>
      <div className="ae-alert__body">
        <p className="ae-alert__title">{title}</p>
        {children != null ? <p className="ae-alert__text">{children}</p> : null}
      </div>
      {action ? <div className="ae-alert__action">{action}</div> : null}
    </div>
  )
}

/* ---- Field / SearchField ------------------------------------------------- */
export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  icon?: IconName
}
export function Field({
  label,
  hint,
  error,
  icon,
  className,
  id,
  ...rest
}: FieldProps): React.JSX.Element {
  const auto = useId()
  const fieldId = id ?? auto
  return (
    <div className={cx('ae-field', error ? 'is-error' : null, className)}>
      <label className="ae-field__label" htmlFor={fieldId}>
        {label}
      </label>
      <div className="ae-field__control">
        {icon ? (
          <span className="ae-field__icon">
            <Icon name={icon} size={16} />
          </span>
        ) : null}
        <input
          id={fieldId}
          className="ae-input"
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={hint || error ? `${fieldId}-d` : undefined}
          {...rest}
        />
      </div>
      {error || hint ? (
        <p id={`${fieldId}-d`} className={cx('ae-field__hint', error ? 'is-error' : null)}>
          {error ? <Icon name="alert" size={13} strokeWidth={2} /> : null}
          <span>{error ?? hint}</span>
        </p>
      ) : null}
    </div>
  )
}

export function SearchField({
  shortcut,
  className,
  placeholder = 'Search',
  ref,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & {
  shortcut?: string
  ref?: Ref<HTMLInputElement>
}): React.JSX.Element {
  return (
    <div className={cx('ae-search', className)}>
      <span className="ae-search__icon">
        <Icon name="search" size={16} />
      </span>
      <input
        type="search"
        ref={ref}
        className="ae-input ae-input--search"
        placeholder={placeholder}
        aria-label={rest['aria-label'] ?? 'Search'}
        {...rest}
      />
      {shortcut ? <kbd className="ae-kbd">{shortcut}</kbd> : null}
    </div>
  )
}

/* ---- Toggle -------------------------------------------------------------- */
export function Toggle({
  checked,
  label,
  onChange,
  disabled,
  className
}: {
  checked: boolean
  label?: ReactNode
  onChange?: () => void
  disabled?: boolean
  className?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked ? 'true' : 'false'}
      className={cx('ae-toggle', checked && 'is-on', className)}
      onClick={onChange}
      disabled={disabled}
    >
      <span className="ae-toggle__track">
        <span className="ae-toggle__thumb" />
      </span>
      {label ? <span className="ae-toggle__label">{label}</span> : null}
    </button>
  )
}

/* ---- NavRail ------------------------------------------------------------- */
export interface NavItem<V extends string = string> {
  value: V
  label: ReactNode
  icon: IconName
  count?: string
}
/** Aegis variant: items are buttons that call `onSelect` (the app routes in memory, not by href). */
export function NavRail<V extends string>({
  brand,
  items,
  value,
  onSelect,
  footer,
  className,
  'aria-label': ariaLabel = 'Primary'
}: {
  brand?: ReactNode
  items: NavItem<V>[]
  value: V
  onSelect: (value: V) => void
  footer?: ReactNode
  className?: string
  'aria-label'?: string
}): React.JSX.Element {
  return (
    <nav className={cx('ae-rail', className)} aria-label={ariaLabel}>
      {brand ? (
        <div className="ae-rail__brand">
          <Icon name="shield-check" size={20} />
          <span>{brand}</span>
        </div>
      ) : null}
      <ul className="ae-rail__list">
        {items.map((item) => {
          const active = item.value === value
          return (
            <li key={item.value}>
              <button
                type="button"
                className={cx('ae-rail__item', active && 'is-active')}
                aria-current={active ? 'page' : undefined}
                onClick={() => onSelect(item.value)}
              >
                <Icon name={item.icon} size={18} />
                <span className="ae-rail__text">{item.label}</span>
                {item.count ? <span className="ae-rail__count">{item.count}</span> : null}
              </button>
            </li>
          )
        })}
      </ul>
      {footer}
    </nav>
  )
}

/* ---- Tabs ---------------------------------------------------------------- */
export function Tabs<V extends string>({
  items,
  value,
  onChange,
  className
}: {
  items: Array<{ label: ReactNode; value: V; count?: number }>
  value?: V
  onChange?: (value: V) => void
  className?: string
}): React.JSX.Element {
  const current = value ?? items[0]?.value
  return (
    <div className={cx('ae-tabs', className)} role="tablist">
      {items.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={t.value === current ? 'true' : 'false'}
          className={cx('ae-tab', t.value === current && 'is-active')}
          onClick={onChange ? () => onChange(t.value) : undefined}
        >
          {t.label}
          {t.count != null ? <span className="ae-tab__count">{t.count}</span> : null}
        </button>
      ))}
    </div>
  )
}

/* ---- Meter --------------------------------------------------------------- */
export function Meter({
  label,
  value,
  display,
  tone,
  className
}: {
  label: string
  value: number
  display?: ReactNode
  tone?: 'success' | 'warning' | 'danger'
  className?: string
}): React.JSX.Element {
  const v = Math.max(0, Math.min(100, value))
  return (
    <div className={cx('ae-meter', className)}>
      <div className="ae-meter__top">
        <span className="ae-meter__label">{label}</span>
        <span className="ae-meter__value">{display ?? `${v}%`}</span>
      </div>
      <div className="ae-meter__track" role="img" aria-label={`${label}: ${v} percent`}>
        <div
          className={cx('ae-meter__bar', tone && `ae-meter__bar--${tone}`)}
          style={{ width: `${v}%` }}
        />
      </div>
    </div>
  )
}

/* ---- LogStream ----------------------------------------------------------- */
export interface LogLine {
  time: string
  level?: 'block' | 'warn' | 'allow'
  text: string
}
export function LogStream({
  lines,
  className
}: {
  lines: LogLine[]
  className?: string
}): React.JSX.Element {
  return (
    <div className={cx('ae-log', className)}>
      {lines.map((line, i) => (
        <p key={i} className={cx('ae-log__line', line.level && `ae-log__line--${line.level}`)}>
          <span className="ae-log__time">{line.time}</span>
          {line.level ? <span className="ae-log__level">{line.level}</span> : null}
          <span className="ae-log__text">{line.text}</span>
        </p>
      ))}
    </div>
  )
}

/* ---- EmptyState ---------------------------------------------------------- */
export function EmptyState({
  icon = 'radar',
  title,
  description,
  action,
  className
}: {
  icon?: IconName
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div className={cx('ae-empty', className)}>
      <span className="ae-empty__icon">
        <Icon name={icon} size={26} />
      </span>
      <h3 className="ae-empty__title">{title}</h3>
      {description ? <p className="ae-empty__text">{description}</p> : null}
      {action ? <div className="ae-empty__action">{action}</div> : null}
    </div>
  )
}
