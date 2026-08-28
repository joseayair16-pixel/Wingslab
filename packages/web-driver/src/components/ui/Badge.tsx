'use client';
import { type ReactNode } from 'react';
import { CheckCircle2, Clock, XCircle, AlertTriangle, Info, type LucideIcon } from 'lucide-react';

export type BadgeTone =
  | 'neutral'
  | 'paid'
  | 'review'
  | 'rejected'
  | 'overdue'
  | 'expired'
  | 'pending'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info';

const tones: Record<BadgeTone, string> = {
  neutral: 'bg-surface-2 text-muted',
  paid: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  review: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  rejected: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  overdue: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  expired: 'bg-neutral-200 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300',
  pending: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  warning: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  danger: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  info: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
};

type Props = {
  tone?: BadgeTone;
  icon?: LucideIcon;
  className?: string;
  children: ReactNode;
};

export function Badge({ tone = 'neutral', icon: IconComponent, className = '', children }: Props) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${tones[tone]} ${className}`}
    >
      {IconComponent && <IconComponent className="h-3.5 w-3.5" />}
      {children}
    </span>
  );
}

type SettlementStatus = 'PAID' | 'IN_REVIEW' | 'REJECTED' | 'OVERDUE' | 'PENDING' | 'EXPIRED' | string;

const STATUS_MAP: Record<string, { tone: BadgeTone; label: string; icon: LucideIcon }> = {
  PAID: { tone: 'paid', label: 'Pagado', icon: CheckCircle2 },
  IN_REVIEW: { tone: 'review', label: 'En revisión', icon: Clock },
  REJECTED: { tone: 'rejected', label: 'Rechazado', icon: XCircle },
  OVERDUE: { tone: 'overdue', label: 'Vencido', icon: AlertTriangle },
  PENDING: { tone: 'pending', label: 'Pendiente', icon: Clock },
  EXPIRED: { tone: 'expired', label: 'Expirado', icon: XCircle },
};

export function SettlementStatusBadge({ status, className = '' }: { status: SettlementStatus; className?: string }) {
  const cfg = STATUS_MAP[status] || { tone: 'neutral' as BadgeTone, label: status, icon: Info };
  return (
    <Badge tone={cfg.tone} icon={cfg.icon} className={`${status === 'OVERDUE' ? 'animate-pulse' : ''} ${className}`}>
      {cfg.label}
    </Badge>
  );
}
