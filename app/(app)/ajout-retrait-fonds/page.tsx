'use client';

import { useEffect, useState, useCallback } from 'react';
import { Save, ArrowUpCircle, ArrowDownCircle, Trash2, Building2, Info } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { formatFCFA } from '@/types';
import { clsx } from 'clsx';

const MOIS_COURTS = ['','Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];

type Mouvement = 'ajout' | 'retrait';

// ── Bloquer les caractères non numériques ─────────────────────────────────────
const onlyNumbers = (e: React.KeyboardEvent<HTMLInputElement>) => {
  const allowed = ['Backspace','Delete','Tab','Escape','Enter','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'];
  if (allowed.includes(e.key) || e.ctrlKey || e.metaKey) return;
  if (!/^\d$/.test(e.key)) e.preventDefault();
};

export default function AjoutRetraitFondsPage() {
  const toast = useToast();

  const [comptes,    setComptes]    = useState<any[]>([]);
  const [banques,    setBanques]    = useState<any[]>([]);
  const [historique, setHistorique] = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [suppId,     setSuppId]     = useState<string|null>(null);
  const [activeTab,  setActiveTab]  = useState<'form'|'historique'>('form');

  const today = new Date().toISOString().split('T')[0];
  const [type,           setType]           = useState<Mouvement>('ajout');
  const [compteId,       setCompteId]       = useState('');
  const [montantFond,    setMontantFond]     = useState('');
  const [montantBanque,  setMontantBanque]   = useState('');
  const [montantTotal,   setMontantTotal]    = useState(''); // optionnel
  const [dateOp,         setDateOp]         = useState(today);
  const [note,           setNote]           = useState('');
  const [banqueId,       setBanqueId]       = useState('');
  const [impacterBanque, setImpacterBanque] = useState(false);

  const charger = useCallback(async () => {
    setLoading(true);
    try {
      const [rComptes, rBanques, rDec] = await Promise.all([
        fetch('/api/comptes'),
        fetch('/api/banques'),
        fetch('/api/decaissements'),
      ]);
      if (rComptes.ok) { const d = await rComptes.json(); setComptes(d.comptes ?? []); if (!compteId && d.comptes?.length) setCompteId(d.comptes[0].id); }
      if (rBanques.ok) { const d = await rBanques.json(); setBanques(d.banques ?? []); }
      if (rDec.ok)     { const d = await rDec.json();     setHistorique(d.decaissements ?? []); }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { charger(); }, [charger]);

  const enregistrer = async () => {
    if (!compteId || !dateOp) {
      toast.error('Fond et date sont obligatoires');
      return;
    }
    if (!montantFond && !montantTotal && !(impacterBanque && montantBanque)) {
      toast.error('Saisissez au moins un montant');
      return;
    }
    const mtFond   = parseInt(montantFond)   || 0;
    const mtBanque = parseInt(montantBanque) || 0;
    const mtTotal  = parseInt(montantTotal)  || 0;

    setSaving(true);
    try {
      const fondNom = comptes.find(c => c.id === compteId)?.nom ?? '';
      const desc = note || `${type === 'ajout' ? 'Ajout' : 'Retrait'} — ${fondNom}`;

      const res = await fetch('/api/decaissements', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description:   desc,
          dateOperation: dateOp,
          notes:         note || null,
          typeMouvement: type,
          montantTotal:  mtTotal  > 0 ? mtTotal  : null,
          montantFond:   mtFond   > 0 ? mtFond   : null,
          montantBanque: mtBanque > 0 ? mtBanque : null,
          compteId:      mtFond   > 0 ? compteId : null,
          banqueId:      impacterBanque && banqueId && mtBanque > 0 ? banqueId : null,
          impacterBanque: impacterBanque && !!banqueId && mtBanque > 0,
        }),
      });

      if (res.ok) {
        toast.success(type === 'ajout' ? 'Ajout enregistré ✓' : 'Retrait enregistré ✓');
        setMontantFond('');
        setMontantBanque('');
        setMontantTotal('');
        setNote('');
        setDateOp(today);
        await charger();
      } else {
        const err = await res.json();
        toast.error(err.error ?? 'Erreur lors de l\'enregistrement');
      }
    } catch { toast.error('Erreur réseau'); }
    setSaving(false);
  };

  const supprimer = async (id: string) => {
    if (!confirm('Supprimer ce mouvement ? Le solde du fond sera annulé.')) return;
    setSuppId(id);
    try {
      const res = await fetch(`/api/decaissements?id=${id}`, { method: 'DELETE' });
      if (res.ok) { toast.success('Mouvement supprimé'); await charger(); }
      else toast.error('Erreur lors de la suppression');
    } catch { toast.error('Erreur réseau'); }
    setSuppId(null);
  };

  const fondSelectionne    = comptes.find(c => c.id === compteId);
  const banqueSelectionnee = banques.find(b => b.id === banqueId);
  const formatDate = (d: string | Date) => {
    const dt = new Date(d);
    return `${String(dt.getDate()).padStart(2,'0')}/${MOIS_COURTS[dt.getMonth()+1]}/${dt.getFullYear()}`;
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="spinner scale-150" /></div>;

  // KPIs fonds (sans solde net)
  const totalFonds  = comptes.filter(c => c.isActive).reduce((s, c) => s + (c.soldeActuel ?? 0), 0);
  const totalAjouts = historique.filter(d => d.typeMouvement === 'ajout').reduce((s, d) => s + (d.montantTotal ?? 0), 0);
  const totalRetraits = historique.filter(d => d.typeMouvement === 'retrait').reduce((s, d) => s + (d.montantTotal ?? 0), 0);

  return (
    <div className="space-y-6 animate-fadeIn max-w-3xl mx-auto">

      {/* En-tête + Onglets */}
      <div>
        <h1 className="text-2xl font-bold text-[var(--text)]">Ajout / Retrait — Fonds</h1>
        <p className="text-[var(--text-muted)] text-sm">Gérez les mouvements sur vos fonds de fonctionnement</p>
      </div>

      {/* Onglets */}
      <div className="flex gap-1 bg-slate-100 dark:bg-dark-card rounded-xl p-1 w-fit border border-[var(--border)]">
        {([['form','➕ Nouveau mouvement'],['historique','📋 Historique']] as const).map(([tab, label]) => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={clsx('px-4 py-2 rounded-lg text-sm font-medium transition-all',
              activeTab === tab
                ? 'bg-[var(--surface)] text-primary shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text)]')}>
            {label}
            {tab === 'historique' && historique.length > 0 && (
              <span className="ml-1.5 text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-semibold">
                {historique.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Onglet Formulaire ── */}
      {activeTab === 'form' && (<>

      {/* KPIs — sans solde net */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-2xl p-4 flex items-center gap-3">
          <ArrowUpCircle size={26} className="text-green-600 flex-shrink-0" />
          <div>
            <p className="text-xs text-green-700 dark:text-green-400 opacity-70">Total ajouté</p>
            <p className="text-lg font-bold text-green-700 dark:text-green-400">{formatFCFA(totalAjouts)}</p>
          </div>
        </div>
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-4 flex items-center gap-3">
          <ArrowDownCircle size={26} className="text-red-500 flex-shrink-0" />
          <div>
            <p className="text-xs text-red-600 dark:text-red-400 opacity-70">Total retiré</p>
            <p className="text-lg font-bold text-red-600 dark:text-red-400">{formatFCFA(totalRetraits)}</p>
          </div>
        </div>
      </div>

      {/* Soldes fonds (cliquables) */}
      {comptes.filter(c => c.isActive).length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {comptes.filter(c => c.isActive).map((c: any) => (
            <div key={c.id} onClick={() => setCompteId(c.id)}
              className={clsx('rounded-2xl border p-3.5 cursor-pointer transition-all',
                compteId === c.id
                  ? 'border-primary bg-primary/5 shadow-sm ring-1 ring-primary/20'
                  : 'border-[var(--border)] bg-[var(--surface)] hover:border-primary/40')}>
              <p className="text-xs font-medium text-[var(--text-muted)] truncate mb-1">{c.nom}</p>
              <p className={clsx('text-base font-bold', compteId === c.id ? 'text-primary' : 'text-[var(--text)]')}>
                {formatFCFA(c.soldeActuel ?? 0)}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Formulaire */}
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5 space-y-5 transition-colors">
        <h2 className="font-semibold text-[var(--text)]">Nouveau mouvement</h2>

        {/* Type */}
        <div className="flex gap-2">
          <button onClick={() => setType('ajout')}
            className={clsx('flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border-2 font-semibold text-sm transition-all',
              type === 'ajout' ? 'border-green-500 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : 'border-[var(--border)] text-[var(--text-muted)] hover:border-green-300')}>
            <ArrowUpCircle size={18} />Ajout
          </button>
          <button onClick={() => setType('retrait')}
            className={clsx('flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border-2 font-semibold text-sm transition-all',
              type === 'retrait' ? 'border-red-500 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400' : 'border-[var(--border)] text-[var(--text-muted)] hover:border-red-300')}>
            <ArrowDownCircle size={18} />Retrait
          </button>
        </div>

        {/* Fond + montant fond */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Fond *</label>
            <select value={compteId} onChange={e => setCompteId(e.target.value)}
              className="w-full border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none">
              <option value="">— Choisir un fond —</option>
              {comptes.filter(c => c.isActive).map((c: any) => (
                <option key={c.id} value={c.id}>{c.nom} ({formatFCFA(c.soldeActuel ?? 0)})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Montant fond (FCFA)</label>
            <input type="number" value={montantFond} onChange={e => setMontantFond(e.target.value)}
              onKeyDown={onlyNumbers} placeholder="0" min="0"
              className="w-full border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none" />
          </div>
        </div>

        {/* Montant total (optionnel) */}
        <div className="bg-slate-50 dark:bg-dark-card rounded-xl p-4 space-y-2">
          <div className="flex items-center gap-2 mb-1">
            <Info size={14} className="text-primary flex-shrink-0" />
            <label className="text-xs font-medium text-[var(--text)] ">
              {type === 'ajout'
                ? 'Montant total reçu (FCFA) — optionnel, impacte "Autres revenus" dans Suivi'
                : 'Montant total dépensé (FCFA) — optionnel, impacte "Autre dépense 1" dans Suivi'}
            </label>
          </div>
          <input type="number" value={montantTotal} onChange={e => setMontantTotal(e.target.value)}
            onKeyDown={onlyNumbers} placeholder="Ex: 50 000" min="0"
            className="w-full border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none" />
        </div>

        {/* Date + Note */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Date *</label>
            <input type="date" value={dateOp} onChange={e => setDateOp(e.target.value)}
              className="w-full border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none" />
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Note</label>
            <input type="text" value={note} onChange={e => setNote(e.target.value)}
              placeholder="Ex: Cotisation septembre"
              className="w-full border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none" />
          </div>
        </div>

        {/* Impact bancaire */}
        <div className="bg-slate-50 dark:bg-dark-card rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-3">
            <input type="checkbox" id="impacter-banque" checked={impacterBanque}
              onChange={e => setImpacterBanque(e.target.checked)}
              className="w-4 h-4 accent-primary cursor-pointer" />
            <label htmlFor="impacter-banque" className="text-sm font-medium text-[var(--text)] cursor-pointer flex items-center gap-2">
              <Building2 size={15} className="text-primary" />
              Impacter un compte bancaire
            </label>
          </div>
          {impacterBanque && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Banque</label>
                <select value={banqueId} onChange={e => setBanqueId(e.target.value)}
                  className="w-full border border-[var(--border)] rounded-xl px-3 py-2 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none">
                  <option value="">— Choisir —</option>
                  {banques.map((b: any) => (
                    <option key={b.id} value={b.id}>{b.nomBanque} ({formatFCFA(b.solde ?? 0)})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Montant banque (FCFA)</label>
                <input type="number" value={montantBanque} onChange={e => setMontantBanque(e.target.value)}
                  onKeyDown={onlyNumbers} placeholder="0" min="0"
                  className="w-full border border-[var(--border)] rounded-xl px-3 py-2 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none" />
              </div>
            </div>
          )}
          {/* Flux visuel */}
          {impacterBanque && banqueId && (montantFond || montantBanque) && (
            <div className={clsx('rounded-lg p-2.5 text-xs font-medium',
              type === 'ajout' ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400')}>
              {type === 'ajout' ? (
                <span>
                  {banqueSelectionnee?.nomBanque} <strong>−{formatFCFA(parseInt(montantBanque)||0)}</strong>
                  {' → '}{fondSelectionne?.nom} <strong>+{formatFCFA(parseInt(montantFond)||0)}</strong>
                </span>
              ) : (
                <span>
                  {fondSelectionne?.nom} <strong>−{formatFCFA(parseInt(montantFond)||0)}</strong>
                  {' → '}{banqueSelectionnee?.nomBanque} <strong>+{formatFCFA(parseInt(montantBanque)||0)}</strong>
                </span>
              )}
            </div>
          )}
        </div>

        {/* Submit */}
        <button onClick={enregistrer} disabled={saving || !compteId || !dateOp}
          className={clsx('w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-60',
            type === 'ajout' ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-red-500 hover:bg-red-600 text-white')}>
          <Save size={16} />
          {saving ? 'Enregistrement...' : type === 'ajout' ? 'Enregistrer l\'ajout' : 'Enregistrer le retrait'}
        </button>
      </div>

      </>)} {/* end form tab */}

      {/* ── Onglet Historique ── */}
      {activeTab === 'historique' && (
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] overflow-hidden transition-colors">
        <div className="px-5 py-3 border-b border-[var(--border)] bg-slate-50 dark:bg-dark-card flex items-center justify-between">
          <h3 className="font-semibold text-[var(--text)]">Historique des mouvements</h3>
          <span className="text-xs text-[var(--text-muted)]">{historique.length} opération(s)</span>
        </div>
        {historique.length === 0 ? (
          <div className="px-5 py-8 text-center text-[var(--text-muted)] text-sm">Aucun mouvement enregistré</div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {historique.map((d: any) => {
              const fondNom = d.repartitions?.[0]?.compte?.nom ?? '—';
              const isAjout = d.typeMouvement === 'ajout';
              return (
                <div key={d.id} className="px-5 py-3.5 flex items-center gap-4 hover:bg-slate-50/50 dark:hover:bg-dark-card/50 transition-colors">
                  <div className={clsx('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0',
                    isAjout ? 'bg-green-100 dark:bg-green-900/30' : 'bg-red-100 dark:bg-red-900/30')}>
                    {isAjout
                      ? <ArrowUpCircle size={18} className="text-green-600" />
                      : <ArrowDownCircle size={18} className="text-red-500" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--text)] truncate">{d.description}</p>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">{fondNom} · {formatDate(d.dateOperation)}</p>
                  </div>
                  <p className={clsx('text-sm font-bold flex-shrink-0', isAjout ? 'text-green-600' : 'text-red-500')}>
                    {isAjout ? '+' : '−'}{formatFCFA(d.montantTotal)}
                  </p>
                  <button onClick={() => supprimer(d.id)} disabled={suppId === d.id}
                    className="text-slate-300 hover:text-red-500 transition-colors disabled:opacity-40 flex-shrink-0">
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
      )} {/* end historique tab */}
    </div>
  );
}
