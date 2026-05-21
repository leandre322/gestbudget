'use client';
import { useState, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { clsx } from 'clsx';

interface CollapsibleGroupProps {
  id: string;
  label: string;
  badge?: string;
  badgeColor?: string;
  defaultOpen?: boolean;
  headerClass?: string;
  children: React.ReactNode;
}

export default function CollapsibleGroup({
  id, label, badge, badgeColor = 'text-slate-500 dark:text-slate-400',
  defaultOpen = false, headerClass = '', children,
}: CollapsibleGroupProps) {
  const [open, setOpen] = useState(() => {
    // Initialisation synchrone depuis localStorage
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(`group-${id}`);
      if (saved !== null) return saved === 'true';
    }
    return defaultOpen;
  });

  // ✅ Écouter les changements externes (Tout plier / Tout déplier)
  useEffect(() => {
    const handleStorage = () => {
      const saved = localStorage.getItem(`group-${id}`);
      if (saved !== null) setOpen(saved === 'true');
    };

    window.addEventListener('storage', handleStorage);
    // Écouter aussi l'événement custom
    window.addEventListener('collapse-all-update', handleStorage);

    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('collapse-all-update', handleStorage);
    };
  }, [id]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    localStorage.setItem(`group-${id}`, String(next));
  };

  return (
    <div className="border-t border-slate-100 dark:border-dark-border first:border-t-0">
      <button
        onClick={toggle}
        className={clsx(
          'w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors',
          'hover:bg-slate-50 dark:hover:bg-dark-card',
          headerClass
        )}
      >
        <div className="flex items-center gap-2">
          <span className="transition-transform duration-200"
                style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
            <ChevronDown size={14} className="text-slate-400 dark:text-slate-500" />
          </span>
          <span className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {label}
          </span>
        </div>
        {badge && !open && (
          <span className={clsx('text-xs font-semibold', badgeColor)}>
            {badge}
          </span>
        )}
      </button>
      <div className={clsx('overflow-hidden transition-all duration-300 ease-in-out',
        open ? 'max-h-[9999px] opacity-100' : 'max-h-0 opacity-0')}>
        {children}
      </div>
    </div>
  );
}

// ── Hook utilitaire ──
export function useCollapseAll(groupIds: string[]) {
  const expandAll = () => {
    groupIds.forEach(id => localStorage.setItem(`group-${id}`, 'true'));
    window.dispatchEvent(new Event('storage'));
    window.dispatchEvent(new Event('collapse-all-update'));
  };
  const collapseAll = () => {
    groupIds.forEach(id => localStorage.setItem(`group-${id}`, 'false'));
    window.dispatchEvent(new Event('storage'));
    window.dispatchEvent(new Event('collapse-all-update'));
  };
  return { expandAll, collapseAll };
}