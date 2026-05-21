'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, CalendarDays, Wallet, ArrowLeftRight, Settings, X } from 'lucide-react';
import { clsx } from 'clsx';

const NAV = [
  { href: '/dashboard',     label: 'Tableau de bord',     icon: LayoutDashboard },
  { href: '/suivi',         label: 'Suivi mensuel',        icon: CalendarDays    },
  { href: '/budget',        label: 'Budget mensuel',       icon: Wallet          },
  { href: '/decaissements', label: 'Ajout/Retrait Fonds',  icon: ArrowLeftRight  },
  { href: '/parametres',    label: 'Paramètres',           icon: Settings        },
];

export default function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  return (
    <>
      {open && <div className="fixed inset-0 bg-black/40 z-30 lg:hidden" onClick={onClose} />}
      <aside className={clsx(
        'fixed top-0 left-0 h-full w-64 z-40 flex flex-col transition-transform duration-300',
        'bg-primary-dark dark:bg-slate-900',
        'lg:translate-x-0 lg:static lg:z-auto',
        open ? 'translate-x-0' : '-translate-x-full'
      )}>
        <div className="flex items-center justify-between px-5 py-5 border-b border-blue-800 dark:border-slate-700">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-white rounded-xl flex items-center justify-center text-xl shadow-sm">💰</div>
            <div>
              <div className="text-white font-bold text-sm">GestBudget</div>
              <div className="text-blue-300 dark:text-slate-400 text-xs">Gestion budgétaire</div>
            </div>
          </div>
          <button onClick={onClose} className="lg:hidden text-blue-300 hover:text-white"><X size={18} /></button>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <Link key={href} href={href} onClick={onClose}
                className={clsx('flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all',
                  active ? 'bg-white/20 text-white shadow-sm' : 'text-blue-200 dark:text-slate-400 hover:bg-white/10 hover:text-white')}>
                <Icon size={17} />{label}
                {active && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-white" />}
              </Link>
            );
          })}
        </nav>
        <div className="px-5 py-4 border-t border-blue-800 dark:border-slate-700">
          <p className="text-blue-300 dark:text-slate-500 text-xs">Devise : F CFA</p>
        </div>
      </aside>
    </>
  );
}