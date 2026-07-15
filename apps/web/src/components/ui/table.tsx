import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/** Compact table (40px rows, sticky header) per docs/11 §2 density. */
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-x-auto rounded-lg border border-zinc-200 bg-white', className)}>
      <table className="w-full border-collapse text-left text-sm">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="sticky top-0 z-10 bg-zinc-50 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
      {children}
    </thead>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-zinc-100">{children}</tbody>;
}

export function TR({
  children,
  className,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <tr
      onClick={onClick}
      className={cn(onClick && 'cursor-pointer', 'hover:bg-zinc-50/70', className)}
    >
      {children}
    </tr>
  );
}

export function TH({
  children,
  className,
  numeric,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <th
      className={cn(
        'h-9 border-b border-zinc-200 px-3 font-medium',
        numeric && 'text-right',
        className,
      )}
      {...props}
    >
      {children}
    </th>
  );
}

export function TD({
  children,
  className,
  numeric,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td
      className={cn(
        'h-10 px-3 text-zinc-700 align-middle',
        numeric && 'nums text-right tabular-nums',
        className,
      )}
      {...props}
    >
      {children}
    </td>
  );
}
