'use client';

import Link from 'next/link';
import { useState } from 'react';
import { signOut } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, CalendarCheck2, Wallet,
  RefreshCcw, Settings, X, TrendingUp, LogOut, Target, BarChart2, Repeat,
  Landmark, Receipt, ClipboardList, ChevronDown
} from 'lucide-react';
import { clsx } from 'clsx';
import { useNbProjetsEnRetard } from '@/lib/hooks/useDashboard';

// ─── S7 / F13 — Navigation groupée ────────────────────────────────────────────
// « Comptes » regroupe les deux écrans qui mutent les soldes (fonds et banques).
// /decaissements et /recapitulatif existaient dans app/(app) sans jamais figurer
// dans le menu : elles n'étaient atteignables que par URL directe.

type NavIcon = typeof LayoutDashboard;

type NavLink = {
  type:   'link';
  href:   string;
  label:  string;
  icon:   NavIcon;
  badge?: 'projets';
};

type NavGroupe = {
  type:     'groupe';
  id:       string;
  label:    string;
  icon:     NavIcon;
  enfants:  NavLink[];
};

type NavItem = NavLink | NavGroupe;

const NAV: NavItem[] = [
  { type: 'link',  href: '/dashboard',   label: 'Tableau de bord', icon: LayoutDashboard },
  { type: 'link',  href: '/suivi',       label: 'Suivi mensuel',   icon: CalendarCheck2  },
  { type: 'link',  href: '/budget',      label: 'Budget mensuel',  icon: Wallet          },
  {
    type: 'groupe', id: 'comptes', label: 'Comptes', icon: Landmark,
    enfants: [
      { type: 'link', href: '/ajout-retrait-fonds', label: 'Ajout / Retrait Fonds', icon: RefreshCcw },
      { type: 'link', href: '/decaissements',       label: 'Décaissements',         icon: Receipt    },
    ],
  },
  { type: 'link',  href: '/projets',       label: 'Projets',       icon: Target,        badge: 'projets' },
  { type: 'link',  href: '/recurrentes',   label: 'Récurrentes',   icon: Repeat         },
  { type: 'link',  href: '/recapitulatif', label: 'Récapitulatif', icon: ClipboardList  },
  { type: 'link',  href: '/analytiques',   label: 'Analytiques',   icon: BarChart2      },
  { type: 'link',  href: '/parametres',    label: 'Paramètres',    icon: Settings       },
];

interface SidebarProps {
  open:    boolean;
  onClose: () => void;
}

export default function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const nbRetard = useNbProjetsEnRetard();

  // undefined = « suit la route » ; une fois basculé par l'utilisateur, la
  // valeur explicite prend le dessus. Évite tout useEffect et tout risque
  // de divergence d'hydratation.
  const [groupes, setGroupes] = useState<Record<string, boolean>>({});

  const basculer = (id: string, valeurCourante: boolean) =>
    setGroupes(prev => ({ ...prev, [id]: !valeurCourante }));

  // S7 FIX : `startsWith(href)` allumait deux entrées dès que deux routes
  // partageaient un préfixe (/comptes et /comptes-fonds). Correspondance
  // exacte, ou début de segment.
  const estActif = (href: string) =>
    pathname === href || pathname.startsWith(href + '/');

  // Les classes stagger-N sont définies en dur dans le CSS global : Tailwind
  // ne peut pas les générer depuis une interpolation. On plafonne pour ne pas
  // référencer une classe inexistante maintenant que le menu s'est allongé.
  let rang = 0;
  const staggerSuivant = () => `stagger-${Math.min(++rang, 8)}`;

  // ── Rendu d'un lien (premier niveau ou enfant de groupe) ──────────────────
  const rendreLien = (item: NavLink, sousNiveau: boolean) => {
    const isActive   = estActif(item.href);
    const afficheBadge = item.badge === 'projets' && nbRetard > 0;

    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onClose}
        aria-current={isActive ? 'page' : undefined}
        className={clsx(
          'group flex items-center gap-3 rounded-xl',
          'text-sm font-medium transition-all duration-200',
          sousNiveau ? 'px-3 py-2 ml-3' : 'px-3.5 py-2.5',
          staggerSuivant(),
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
          size={sousNiveau ? 15 : 17}
          strokeWidth={isActive ? 2.2 : 1.8}
          className={clsx(
            'flex-shrink-0 transition-all duration-300',
            isActive
              ? 'text-[var(--primary)] animate-glow'
              : 'opacity-50 group-hover:opacity-75',
          )}
        />

        <span className="flex-1 truncate">{item.label}</span>

        {/* Badge projets en retard — masqué si 0 */}
        {afficheBadge && (
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
  };

  // ── Rendu d'un groupe déroulant ──────────────────────────────────────────
  const rendreGroupe = (groupe: NavGroupe) => {
    const contientActif = groupe.enfants.some(e => estActif(e.href));
    const ouvert        = groupes[groupe.id] ?? contientActif;
    const idPanneau     = `nav-groupe-${groupe.id}`;

    return (
      <div key={groupe.id}>
        <button
          type="button"
          onClick={() => basculer(groupe.id, ouvert)}
          aria-expanded={ouvert}
          aria-controls={idPanneau}
          className={clsx(
            'group w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl',
            'text-sm font-medium transition-all duration-200',
            staggerSuivant(),
            contientActif
              ? ['text-[var(--primary)]', 'bg-gradient-to-r from-blue-600/12 to-transparent']
              : ['text-[var(--text-muted)]', 'hover:text-[var(--text)]', 'hover:bg-white/6 dark:hover:bg-white/5'],
          )}
        >
          <groupe.icon
            size={17}
            strokeWidth={contientActif ? 2.2 : 1.8}
            className={clsx(
              'flex-shrink-0 transition-all duration-300',
              contientActif ? 'text-[var(--primary)]' : 'opacity-50 group-hover:opacity-75',
            )}
          />

          <span className="flex-1 truncate text-left">{groupe.label}</span>

          {/* Repère quand le groupe est replié sur une page active */}
          {contientActif && !ouvert && (
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--primary)] flex-shrink-0
              shadow-[0_0_6px_rgba(59,130,246,0.90)]" />
          )}

          <ChevronDown
            size={14}
            className={clsx(
              'flex-shrink-0 opacity-50 transition-transform duration-200',
              ouvert && 'rotate-180',
            )}
          />
        </button>

        {/* Panneau enfants — guide vertical pour rattacher visuellement */}
        <div
          id={idPanneau}
          hidden={!ouvert}
          className="mt-0.5 space-y-0.5 border-l border-[var(--border)] ml-5 pl-1"
        >
          {groupe.enfants.map(enfant => rendreLien(enfant, true))}
        </div>
      </div>
    );
  };

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
          'fixed lg:static inset-y-0 left-0',
          'w-64 flex-shrink-0 flex flex-col',
          'sidebar-glass',
          'transition-transform duration-300 ease-out',
          'lg:translate-x-0',
          open ? 'translate-x-0 z-50' : '-translate-x-full',
        )}
      >

        {/* ── Header brand ── */}
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
                Gestion budgétaire
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

        {/* Diviseur dégradé */}
        <div className="mx-4 mb-2 h-px"
          style={{ background: 'linear-gradient(90deg, transparent, var(--border), transparent)' }} />

        {/* ── Navigation ── */}
        <nav className="flex-1 px-3 py-1 space-y-0.5 overflow-y-auto">
          {NAV.map(item =>
            item.type === 'groupe' ? rendreGroupe(item) : rendreLien(item, false)
          )}
        </nav>

        {/* ── Footer ── */}
        <div className="p-4 pb-6">
          <div className="mb-3 h-px"
            style={{ background: 'linear-gradient(90deg, transparent, var(--border), transparent)' }} />

          <button
            onClick={() => setShowLogoutModal(true)}
            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl mb-3 text-sm font-medium text-red-500 hover:bg-red-500/10 transition-all group"
          >
            <LogOut size={15} className="flex-shrink-0" />
            <span>Se déconnecter</span>
          </button>

          <div className="flex items-center justify-between px-1">
            <span className="text-[10px] text-[var(--text-muted)]">Devise : F CFA</span>
            <span className="text-[10px] text-[var(--text-muted)] opacity-50">v1.0</span>
          </div>

          <div className="mt-2 flex items-center gap-1.5 px-1">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400
              shadow-[0_0_6px_rgba(16,185,129,0.80)] animate-pulse" />
            <span className="text-[10px] text-[var(--text-muted)]">Connecté · Sécurisé</span>
          </div>
        </div>
      </aside>

      {/* ── Modale déconnexion ── */}
      {showLogoutModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowLogoutModal(false)} />
          <div className="relative bg-[var(--surface)] rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-[var(--border)] bg-red-50 dark:bg-red-900/20">
              <LogOut size={18} className="text-red-500" />
              <h3 className="font-bold text-red-700 dark:text-red-400">Se déconnecter ?</h3>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-[var(--text-muted)]">
                Votre session sera fermée. Vous devrez vous reconnecter pour accéder à GestBudget.
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
