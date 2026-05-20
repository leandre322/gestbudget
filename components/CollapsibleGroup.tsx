'use client';

import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { clsx } from 'clsx';

interface CollapsibleGroupProps {
  id: string;           // Clé unique pour mémoriser l'état
  label: string;        // Titre du groupe
  badge?: string;       // Sous-total visible même plié
  badgeColor?: string;  // Couleur du badge
  defaultOpen?: boolean;
  headerClass?: string;
  children: React.ReactNode;
}

export default function CollapsibleGroup({
  id, label, badge, badgeColor = 'text-slate-500 dark:text-slate-400',
  defaultOpen = false, headerClass = '', children,
}: CollapsibleGroupProps) {
  const [open, setOpen] = useState(defaultOpen);

  // Mémoriser l'état dans localStorage (prop. A)
  useEffect(() => {
    const saved = localStorage.getItem(`group-${id}`);
    if (saved !== null) setOpen(saved === 'true');
    else setOpen(defaultOpen);
  }, [id, defaultOpen]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    localStorage.setItem(`group-${id}`, String(next));
  };

  return (
    <div className="border-t border-slate-100 dark:border-dark-border first:border-t-0">
      {/* En-tête cliquable */}
      <button
        onClick={toggle}
        className={clsx(
          'w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors',
          'hover:bg-slate-50 dark:hover:bg-dark-card',
          headerClass
        )}
      >
        <div className="flex items-center gap-2">
          <span className="transition-transform duration-200" style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
            <ChevronDown size={14} className="text-slate-400 dark:text-slate-500" />
          </span>
          <span className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {label}
          </span>
        </div>

        {/* Sous-total visible même plié (prop. C) */}
        {badge && !open && (
          <span className={clsx('text-xs font-semibold', badgeColor)}>
            {badge}
          </span>
        )}
      </button>

      {/* Contenu animé (prop. E) */}
      <div className={clsx('overflow-hidden transition-all duration-300 ease-in-out',
        open ? 'max-h-[9999px] opacity-100' : 'max-h-0 opacity-0')}>
        {children}
      </div>
    </div>
  );
}

// ── Hook utilitaire pour "Tout plier / Tout déplier" (prop. B) ──
export function useCollapseAll(groupIds: string[]) {
  const expandAll = () => {
    groupIds.forEach(id => localStorage.setItem(`group-${id}`, 'true'));
    window.dispatchEvent(new Event('storage'));
  };
  const collapseAll = () => {
    groupIds.forEach(id => localStorage.setItem(`group-${id}`, 'false'));
    window.dispatchEvent(new Event('storage'));
  };
  return { expandAll, collapseAll };
}
