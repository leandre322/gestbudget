'use client';

import Link from 'next/link';
import { useState } from 'react';
import { signOut } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, CalendarCheck2, Wallet,
  RefreshCcw, Settings, X, TrendingUp, LogOut, Target, BarChart2
} from 'lucide-react';
import { clsx } from 'clsx';
import { useNbProjetsEnRetard } from '@/lib/hooks/useDashboard';

const NAV = [
  { href: '/dashboard',           label: 'Tableau de bord',     icon: LayoutDashboard },
  { href: '/suivi',               label: 'Suivi mensuel',       icon: CalendarCheck2  },
  { href: '/budget',              label: 'Budget mensuel',      icon: Wallet          },
  { href: '/ajout-retrait-fonds', label: 'Ajout/Retrait Fonds', icon: RefreshCcw      },
  { href: '/projets',             label: 'Projets',             icon: Target          },
  { href: '/analytiques',         label: 'Analytiques',         icon: BarChart2       },
  { href: '/parametres',          label: 'Parametres',          icon: Settings        },
];

interface SidebarProps {
  open:    boolean;
  onClose: () => void;
}

export default function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const nbRetard = useNbProjetsEnRetard();

  return (
    <>
      {/* â”€â”€ Overlay mobile â”€â”€ */}
      {open && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/60"
          style={{ backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* â”€â”€ Sidebar panel â”€â”€ */}
      <aside
        className={clsx(
          'fixed lg:static inset-y-0 left-0',
          'w-64 flex-shrink-0 flex flex-col',
          'sidebar-glass',
          'transition-transform duration-300 ease-out',
          'lg:translate-x-0',
          open ? 'translate-x-0 z-50' : '-translate-x-full',
        )}
      >

        {/* â”€â”€ Header brand â”€â”€ */}
        <div className="flex items-center justify-between px-5 pt-6 pb-4">
          <div className="flex items-center gap-3">
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
                Gestion budgetaire
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="lg:hidden p-1.5 rounded-lg text-[var(--text-muted)]
              hover:bg-white/8 dark:hover:bg-white/8 transition-colors"
            aria-label="Fermer le menu"
          >
            <X size={16} />
          </button>
        </div>

        {/* Diviseur degrade */}
        <div className="mx-4 mb-2 h-px"
          style={{ background: 'linear-gradient(90deg, transparent, var(--border), transparent)' }} />

        {/* â”€â”€ Navigation â”€â”€ */}
        <nav className="flex-1 px-3 py-1 space-y-0.5 overflow-y-auto">
          {NAV.map((item, i) => {
            const isActive  = pathname.startsWith(item.href);
            const isProjets = item.href === '/projets';

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={clsx(
                  'group flex items-center gap-3 px-3.5 py-2.5 rounded-xl',
                  'text-sm font-medium transition-all duration-200',
                  `stagger-${i + 1}`,
                  isActive
                    ? [
                        'sidebar-item-active',
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

                <span className="flex-1 truncate">{item.label}</span>

                {/* Badge projets en retard â€” masque si 0 */}
                {isProjets && nbRetard > 0 && (
                  <span
                    title={`${nbRetard} projet${nbRetard > 1 ? 's' : ''} en retard`}
                    className={clsx(
                      'flex-shrink-0 min-w-[18px] h-[18px] px-1',
                      'flex items-center justify-center',
                      'rounded-full text-[10px] font-bold leading-none',
                      'bg-red-500 text-white',
                      'shadow-[0_0_6px_rgba(239,68,68,0.60)]',
                      'animate-pulse',
                    )}
                  >
                    {nbRetard > 99 ? '99+' : nbRetard}
                  </span>
                )}

                {isActive && (
                  <div className={clsx(
                    'w-1 h-4 rounded-full flex-shrink-0',
                    'bg-gradient-to-b from-blue-300 to-blue-600',
                    'shadow-[0_0_8px_rgba(59,130,246,0.90)]',
                  )} />
                )}
              </Link>
            );
          })}
        </nav>

        {/* â”€â”€ Footer â”€â”€ */}
        <div className="p-4 pb-6">
          <div className="mb-3 h-px"
            style={{ background: 'linear-gradient(90deg, transparent, var(--border), transparent)' }} />

          <button
            onClick={() => setShowLogoutModal(true)}
            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl mb-3 text-sm font-medium text-red-500 hover:bg-red-500/10 transition-all group"
          >
            <LogOut size={15} className="flex-shrink-0" />
            <span>Se deconnecter</span>
          </button>

          <div className="flex items-center justify-between px-1">
            <span className="text-[10px] text-[var(--text-muted)]">Devise : F CFA</span>
            <span className="text-[10px] text-[var(--text-muted)] opacity-50">v1.0</span>
          </div>

          <div className="mt-2 flex items-center gap-1.5 px-1">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400
              shadow-[0_0_6px_rgba(16,185,129,0.80)] animate-pulse" />
            <span className="text-[10px] text-[var(--text-muted)]">Connecte Â· Securise</span>
          </div>
        </div>
      </aside>

      {/* â”€â”€ Modale deconnexion â”€â”€ */}
      {showLogoutModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowLogoutModal(false)} />
          <div className="relative bg-[var(--surface)] rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-[var(--border)] bg-red-50 dark:bg-red-900/20">
              <LogOut size={18} className="text-red-500" />
              <h3 className="font-bold text-red-700 dark:text-red-400">Se deconnecter ?</h3>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-[var(--text-muted)]">
                Votre session sera fermee. Vous devrez vous reconnecter pour acceder a GestBudget.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowLogoutModal(false)}
                  className="flex-1 py-2.5 rounded-xl border border-[var(--border)] text-sm text-[var(--text-muted)] hover:bg-slate-50 dark:hover:bg-dark-card transition-all"
                >
                  Annuler
                </button>
                <button
                  onClick={() => signOut({ callbackUrl: '/login' })}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-semibold transition-all"
                >
                  <LogOut size={14} />Confirmer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
