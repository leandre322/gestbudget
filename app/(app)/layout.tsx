'use client';

import { useState, useEffect, createContext, useContext } from 'react';
import { SessionProvider, useSession } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import { Menu, ChevronLeft, ChevronRight, LogOut, User, WifiOff, Sun, Moon } from 'lucide-react';
import { signOut } from 'next-auth/react';
import { MOIS_LABELS } from '@/types';
import { useTheme } from '@/lib/theme';
import { InactivityWarning } from '@/lib/inactivity';
import { clsx } from 'clsx';
import { ToastProvider } from '@/components/Toast';

interface MoisCtx { mois: number; annee: number; setMois: (m: number) => void; setAnnee: (a: number) => void; }
export const MoisContext = createContext<MoisCtx>({ mois: 1, annee: 2026, setMois: () => {}, setAnnee: () => {} });
export const useMois = () => useContext(MoisContext);

function Topbar({ onMenu, mois, annee, onPrev, onNext, saveStatus, isOffline, onMoisCourant, estMoisCourant }: any) {
  const { data: session } = useSession();
  const { isDark, toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <header className="h-14 bg-[var(--surface)] border-b border-[var(--border)] flex items-center px-4 gap-3 sticky top-0 z-20 shadow-sm transition-colors">
      <button onClick={onMenu} className="lg:hidden text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"><Menu size={22} /></button>
      <div className="flex items-center gap-1.5">
        <button onClick={onPrev} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-dark-card text-slate-400 transition-all">
          <ChevronLeft size={17} />
        </button>
        <span className="font-semibold text-[var(--text)] text-sm min-w-[130px] text-center select-none">
          {MOIS_LABELS[mois]} {annee}
        </span>
        <button onClick={onNext} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-dark-card text-slate-400 transition-all">
          <ChevronRight size={17} />
        </button>
        {!estMoisCourant && (
          <button onClick={onMoisCourant}
            title="Revenir au mois courant"
            className="ml-1 px-2.5 py-1 bg-primary text-white rounded-lg text-xs font-semibold hover:bg-primary-dark transition-all flex items-center gap-1">
            📅 Aujourd'hui
          </button>
        )}
      </div>
      {saveStatus === 'saving' && <span className="text-xs text-amber-500 font-medium hidden sm:block">Sauvegarde...</span>}
      {saveStatus === 'saved'  && <span className="text-xs text-green-500 font-medium hidden sm:block">Sauvegardé ✓</span>}
      {saveStatus === 'error'  && <span className="text-xs text-red-500 font-medium hidden sm:block">Erreur ⚠️</span>}
      <div className="flex-1" />
      {isOffline && (
        <div className="flex items-center gap-1.5 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 text-amber-600 dark:text-amber-400 rounded-full px-3 py-1 text-xs font-medium">
          <WifiOff size={12} />Hors-ligne
        </div>
      )}
      <button onClick={toggleTheme} title={isDark ? 'Mode clair' : 'Mode sombre'}
        className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-dark-card transition-all text-slate-500 dark:text-slate-400">
        {isDark ? <Sun size={18} className="text-amber-400" /> : <Moon size={18} />}
      </button>
      <div className="relative">
        <button onClick={() => setMenuOpen(!menuOpen)}
          className="flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-dark-card rounded-xl px-3 py-1.5 transition-all">
          <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center"><User size={13} className="text-white" /></div>
          <span className="text-sm text-slate-500 dark:text-slate-400 hidden sm:block max-w-[140px] truncate">{session?.user?.email}</span>
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full mt-1.5 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-lg py-1 min-w-[180px] z-50">
            <div className="px-4 py-2 text-xs text-[var(--text-muted)] border-b border-[var(--border)] truncate">{session?.user?.email}</div>
            <button onClick={() => signOut({ callbackUrl: '/login' })}
              className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all">
              <LogOut size={14} />Se déconnecter
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

function BottomNav() {
  const pathname = usePathname();
  const items = [
    { href: '/dashboard',     label: 'Dashboard', icon: '📊' },
    { href: '/suivi',         label: 'Suivi',     icon: '📅' },
    { href: '/decaissements', label: 'Dépenses',  icon: '📒' },
    { href: '/budget',        label: 'Budget',    icon: '💰' },
    { href: '/parametres',    label: 'Paramètres',icon: '⚙️' },
  ];
  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-[var(--surface)] border-t border-[var(--border)] z-20 flex transition-colors">
      {items.map(item => (
        <a key={item.href} href={item.href}
          className={clsx('flex-1 flex flex-col items-center py-2 text-xs transition-all',
            pathname.startsWith(item.href) ? 'text-primary font-semibold' : 'text-[var(--text-muted)]')}>
          <span className="text-lg leading-none mb-0.5">{item.icon}</span>{item.label}
        </a>
      ))}
    </nav>
  );
}

function InnerLayout({ children }: { children: React.ReactNode }) {
  const now = new Date();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mois,  setMois]  = useState(now.getMonth() + 1);
  const [annee, setAnnee] = useState(now.getFullYear());
  const [saveStatus, setSaveStatus] = useState('idle');
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    (window as any).__setSaveStatus = setSaveStatus;
    const upd = () => setIsOffline(!navigator.onLine);
    window.addEventListener('online', upd); window.addEventListener('offline', upd);
    setIsOffline(!navigator.onLine);
    return () => { window.removeEventListener('online', upd); window.removeEventListener('offline', upd); };
  }, []);

  const prev = () => { if (mois===1){setMois(12);setAnnee(a=>a-1);}else setMois(m=>m-1); };
  const next = () => { if (mois===12){setMois(1);setAnnee(a=>a+1);}else setMois(m=>m+1); };
  const moisCourantReel    = new Date().getMonth() + 1;
  const anneeCouranteReelle = new Date().getFullYear();
  const estMoisCourant     = mois === moisCourantReel && annee === anneeCouranteReelle;
  const allerMoisCourant   = () => { setMois(moisCourantReel); setAnnee(anneeCouranteReelle); };

  return (
    <MoisContext.Provider value={{ mois, annee, setMois, setAnnee }}>
      <div className="flex h-screen overflow-hidden bg-[var(--bg)] transition-colors">
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <div className="flex-1 flex flex-col overflow-hidden">
          <Topbar
            onMenu={() => setSidebarOpen(true)}
            mois={mois} annee={annee}
            onPrev={prev} onNext={next}
            saveStatus={saveStatus}
            isOffline={isOffline}
            onMoisCourant={allerMoisCourant}
            estMoisCourant={estMoisCourant}
          />
          <main className="flex-1 overflow-y-auto p-4 md:p-6 pb-20 lg:pb-6 bg-[var(--bg)] transition-colors">
            {children}
          </main>
        </div>
      </div>
      <BottomNav />
      <InactivityWarning />
    </MoisContext.Provider>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ToastProvider>
        <InnerLayout>{children}</InnerLayout>
      </ToastProvider>
    </SessionProvider>
  );
}