'use client';
import { type HTMLAttributes } from 'react';

type Props = HTMLAttributes<HTMLDivElement>;

export function Card({ className = '', ...rest }: Props) {
  return (
    <div
      className={`rounded-3xl border border-border bg-surface shadow-sm ${className}`}
      {...rest}
    />
  );
}
