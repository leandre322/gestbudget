'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, CalendarCheck2, Wallet,
  RefreshCcw, Settings, X, TrendingUp
} from 'lucide-react';
import { clsx } from 'clsx';

const NAV = [
  { href: '/dashboard',           label: 'Tableau de bord',    icon: LayoutDashboard  },
  { href: '/suivi',               label: 'Suivi mensuel',      icon: CalendarCheck2   },
  { href: '/budget',              label: 'Budget mensuel',     icon: Wallet           },
  { href: '/ajout-retrait-fonds', label: 'Ajout/Retrait Fonds',icon: RefreshCcw       },
  { href: '/parametres',          label: 'Paramètres',         icon: Settings         },
];

interface SidebarProps {
  open:    boolean;
  onClose: () => void;
}

export default function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();

  return (
    <>
      {/* ── Overlay mobile ── */}
      {open && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/60"
          style={{ backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* ── Sidebar panel ── */}
      <aside
        className={clsx(
          // Position
          'fixed lg:static inset-y-0 left-0',
          // Dimensions
          'w-64 flex-shrink-0 flex flex-col',
          // Glass — classe utilitaire CSS (globals.css)
          'sidebar-glass',
          // Mobile slide
          'transition-transform duration-300 ease-out',
          'lg:translate-x-0',
          open ? 'translate-x-0 z-50' : '-translate-x-full',
        )}
      >

        {/* ── Header brand ── */}
        <div className="flex items-center justify-between px-5 pt-6 pb-4">
          <div className="flex items-center gap-3">
            {/* Logo icône avec glow */}
            <div className={clsx(
              'w-9 h-9 rounded-xl flex-shrink-0',
              'flex items-center justify-center',
              'bg-gradient-to-br from-blue-500 to-blue-700',
              'shadow-[0_4px_16px_rgba(59,130,246,0.50)]',
              'ring-1 ring-blue-400/25',
            )}>
              <TrendingUp size={17} className="text-white" strokeWidth={2.2} />
            </div>
            <div>
              <p className="text-sm font-bold text-[var(--text)] leading-tight">
                GestBudget
              </p>
              <p className="text-[10px] text-[var(--text-muted)] leading-none mt-0.5">
                Gestion budgétaire
              </p>
            </div>
          </div>

          {/* Fermer (mobile) */}
          <button
            onClick={onClose}
            className="lg:hidden p-1.5 rounded-lg text-[var(--text-muted)]
              hover:bg-white/8 dark:hover:bg-white/8 transition-colors"
            aria-label="Fermer le menu"
          >
            <X size={16} />
          </button>
        </div>

        {/* Diviseur dégradé */}
        <div className="mx-4 mb-2 h-px"
          style={{ background: 'linear-gradient(90deg, transparent, var(--border), transparent)' }} />

        {/* ── Navigation ── */}
        <nav className="flex-1 px-3 py-1 space-y-0.5 overflow-y-auto">
          {NAV.map((item, i) => {
            const isActive = pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={clsx(
                  // Base
                  'group flex items-center gap-3 px-3.5 py-2.5 rounded-xl',
                  'text-sm font-medium transition-all duration-200',
                  // P3 : entrée décalée
                  `stagger-${i + 1}`,
                  // État actif vs inactif
                  isActive
                    ? [
                        'sidebar-item-active',          // glow CSS (globals.css)
                        'bg-gradient-to-r from-blue-600/20 to-blue-500/8',
                        'text-[var(--primary)]',
                      ]
                    : [
                        'text-[var(--text-muted)]',
                        'hover:text-[var(--text)]',
                        'hover:bg-white/6 dark:hover:bg-white/5',
                      ]
                )}
              >
                {/* Icône — P4 glow sur actif */}
                <item.icon
                  size={17}
                  strokeWidth={isActive ? 2.2 : 1.8}
                  className={clsx(
                    'flex-shrink-0 transition-all duration-300',
                    isActive
                      ? 'text-[var(--primary)] animate-glow'
                      : 'opacity-50 group-hover:opacity-75',
                  )}
                />

                {/* Label */}
                <span className="flex-1 truncate">{item.label}</span>

                {/* Indicateur actif — trait vertical lumineux */}
                {isActive && (
                  <div className={clsx(
                    'w-1 h-4 rounded-full flex-shrink-0',
                    'bg-gradient-to-b from-blue-300 to-blue-600',
                    'shadow-[0_0_8px_rgba(59,130,246,0.90)]',
                  )} />
                )}

                {/* Dot nouvelle session non-sauvegardée (passé via context si besoin) */}
              </Link>
            );
          })}
        </nav>

        {/* ── Footer ── */}
        <div className="p-4 pb-6">
          <div className="mb-3 h-px"
            style={{ background: 'linear-gradient(90deg, transparent, var(--border), transparent)' }} />

          {/* Devise + version */}
          <div className="flex items-center justify-between px-1">
            <span className="text-[10px] text-[var(--text-muted)]">Devise : F CFA</span>
            <span className="text-[10px] text-[var(--text-muted)] opacity-50">v1.0</span>
          </div>

          {/* Barre de statut connexion */}
          <div className="mt-2 flex items-center gap-1.5 px-1">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400
              shadow-[0_0_6px_rgba(16,185,129,0.80)] animate-pulse" />
            <span className="text-[10px] text-[var(--text-muted)]">Connecté · Sécurisé</span>
          </div>
        </div>
      </aside>
    </>
  );
}
