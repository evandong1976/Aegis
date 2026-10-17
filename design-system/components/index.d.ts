// Aegis — component API. Documentation, not a build target.
import type { ReactNode, InputHTMLAttributes, ButtonHTMLAttributes } from 'react';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'secure';
export type AlertTone = 'critical' | 'warning' | 'info' | 'success';
export type IconName = string; // one of Aegis.iconNames

export interface IconProps {
  /** A name from `Aegis.iconNames`. Unknown names fall back to `shield`. */
  name: IconName;
  /** Rendered px, default 20. */
  size?: number;
  /** Default 1.75; use 2 at 13–14px. */
  strokeWidth?: number;
  className?: string;
}
export declare function Icon(props: IconProps): JSX.Element;
export declare const iconNames: string[];

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Default 'primary'. One primary per view. */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  /** Default 'md'. 'sm' in rows and card headers, 'lg' in empty states. */
  size?: 'sm' | 'md' | 'lg';
  /** Leading glyph. */
  icon?: IconName;
  /** Trailing glyph; direction only. */
  iconEnd?: IconName;
  /** Fill the container's width. */
  full?: boolean;
  children?: ReactNode;
}
export declare function Button(props: ButtonProps): JSX.Element;

export interface SeverityBadgeProps {
  level: Severity;
  /** Drop the border for dense table cells. */
  subtle?: boolean;
  /** Replaces the standard label; the icon stays. */
  children?: ReactNode;
  className?: string;
}
export declare function SeverityBadge(props: SeverityBadgeProps): JSX.Element;

export interface CardProps {
  title?: ReactNode;
  /** Uppercase label above the title. */
  eyebrow?: ReactNode;
  description?: ReactNode;
  /** Node in the top-right corner: a Button or a SeverityBadge. */
  action?: ReactNode;
  /** Accent border and glow. One per view. */
  highlight?: boolean;
  children?: ReactNode;
  className?: string;
}
export declare function Card(props: CardProps): JSX.Element;

export interface StatTileProps {
  label: ReactNode;
  value: ReactNode;
  /** Small suffix after the value, e.g. 'min'. */
  unit?: ReactNode;
  icon?: IconName;
  /** The movement, already formatted: '12%', '3 min'. */
  delta?: ReactNode;
  /** Which way the number moved. */
  direction?: 'up' | 'down';
  /** Which direction is good for this metric; colours the delta with `direction`. */
  intent?: 'good' | 'bad';
  caption?: ReactNode;
  /** 6–12 numbers for the sparkline. */
  points?: number[];
  className?: string;
}
export declare function StatTile(props: StatTileProps): JSX.Element;
export declare function Sparkline(props: { points: number[] }): JSX.Element | null;

export interface ScoreRingProps {
  /** 0–100; clamped. */
  value: number;
  label?: string;
  /** Outer px, default 168. */
  size?: number;
  /** Default 12. */
  strokeWidth?: number;
  className?: string;
}
export declare function ScoreRing(props: ScoreRingProps): JSX.Element;

export interface ThreatColumn {
  /** Key into each row object. */
  key: string;
  header: ReactNode;
  /** Set the cell in the mono scale: IPs, hashes, timestamps. Mono cells never wrap. */
  mono?: boolean;
  /** Keep the cell on one line — hostnames and other values that must not break mid-token. */
  nowrap?: boolean;
  align?: 'left' | 'right';
}
export interface ThreatTableProps {
  columns: ThreatColumn[];
  /** Plain objects keyed by column key; a value may be a node. */
  rows: Record<string, ReactNode>[];
  className?: string;
}
export declare function ThreatTable(props: ThreatTableProps): JSX.Element;

export interface AlertBannerProps {
  tone: AlertTone;
  /** One line: the finding itself. */
  title: ReactNode;
  /** The remedy, as a Button. */
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}
export declare function AlertBanner(props: AlertBannerProps): JSX.Element;

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Always visible; never replaced by a placeholder. */
  label: ReactNode;
  /** What the value does. */
  hint?: ReactNode;
  /** Replaces the hint and marks the input invalid. */
  error?: ReactNode;
  /** Glyph inside the control's left edge. */
  icon?: IconName;
}
export declare function Field(props: FieldProps): JSX.Element;

export interface SearchFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Rendered as a kbd chip; bind it for real. */
  shortcut?: string;
}
export declare function SearchField(props: SearchFieldProps): JSX.Element;

export interface ToggleProps {
  checked: boolean;
  /** Names the setting, not the state. */
  label?: ReactNode;
  onChange?: () => void;
  disabled?: boolean;
  className?: string;
}
export declare function Toggle(props: ToggleProps): JSX.Element;

export interface NavItem {
  label: ReactNode;
  icon: IconName;
  href?: string;
  active?: boolean;
  /** Open items needing attention, pre-formatted: '12', '1.2k'. */
  count?: string;
}
export interface NavRailProps {
  brand?: ReactNode;
  /** Up to eight. */
  items: NavItem[];
  'aria-label'?: string;
  className?: string;
}
export declare function NavRail(props: NavRailProps): JSX.Element;

export interface TabItem {
  label: ReactNode;
  value: string;
  count?: number;
}
export interface TabsProps {
  /** Two to five. */
  items: TabItem[];
  value?: string;
  onChange?: (value: string) => void;
  className?: string;
}
export declare function Tabs(props: TabsProps): JSX.Element;

export interface MeterProps {
  label: ReactNode;
  /** 0–100; clamped. */
  value: number;
  /** Right-hand readout when it differs from the percentage. */
  display?: ReactNode;
  /** Only when the number itself carries a verdict. */
  tone?: 'success' | 'warning' | 'danger';
  className?: string;
}
export declare function Meter(props: MeterProps): JSX.Element;

export interface LogLine {
  /** HH:MM:SS in the viewer's zone. */
  time: string;
  level?: 'block' | 'warn' | 'allow';
  /** Raw, untruncated. */
  text: string;
}
export declare function LogStream(props: { lines: LogLine[]; className?: string }): JSX.Element;

export interface EmptyStateProps {
  /** Default 'radar'. */
  icon?: IconName;
  title: ReactNode;
  /** Why it is empty and when it next changes. */
  description?: ReactNode;
  /** A secondary Button. */
  action?: ReactNode;
  className?: string;
}
export declare function EmptyState(props: EmptyStateProps): JSX.Element;
