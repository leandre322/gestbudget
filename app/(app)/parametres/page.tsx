'use client';

import { useEffect, useState, useCallback } from 'react';
import { Plus, Pencil, Trash2, Check, X, Upload, Save, Link, Link2Off } from 'lucide-react';
import { TYPE_LABELS, ORDRE_TYPES, formatFCFA } from '@/types';
import { clsx } from 'clsx';

const GRANDES_CATEGORIES = [
  'epargne_precaution',
  'epargne_investissement',
  'epargne_autre',
  'depense_fixe',
  'depense_variable',
  'depense_occasionnelle',
  'remboursement_dette',
] as const;

type GrandeCategorie = typeof GRANDES_CATEGORIES[number];

export default function ParametresPage() {
  const [categories,    setCategories]    = useState<any[]>([]);
  const [comptes,       setComptes]       = useState<any[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [editCat,       setEditCat]       = useState<any>(null);
  const [editCompte,    setEditCompte]    = useState<any>(null);
  const [newCat,        setNewCat]        = useState({ nom: '', type: 'depense_variable', sousType: '' });
  const [showNewCat,    setShowNewCat]    = useState(false);
  const [newCompte,     setNewCompte]     = useState('');
  const [showNewCompte, setShowNewCompte] = useState(false);
  const [importing,     setImporting]     = useState(false);
  const [importResult,  setImportResult]  = useState<any>(null);
  const [banques,       setBanques]       = useState<any[]>([]);
  const [newBanque,     setNewBanque]     = useState({ nom: '', solde: '' });
  const [showNewBanque, setShowNewBanque] = useState(false);
  const [editBanque,    setEditBanque]    = useState<any>(null);
  const [anneesData,    setAnneesData]    = useState<any[]>([]);
  const [suppAnnee,     setSuppAnnee]     = useState<number|null>(null);
  const [suppMois,      setSuppMois]      = useState<number|null>(null);
  const [confirmText,   setConfirmText]   = useState('');
  const [suppLoading,   setSuppLoading]   = useState(false);
  const [suppResult,    setSuppResult]    = useState<string>('');
  const [activeTab,     setActiveTab]     = useState<'categories'|'comptes'|'banques'|'import'|'donnees'>('categories');
  const [tauxRef,       setTauxRef]       = useState<Record<GrandeCategorie, number>>({} as Record<GrandeCategorie, number>);
  const [revenuRef,     setRevenuRef]     = useState<number>(0);
  const [savingTaux,    setSavingTaux]    = useState(false);
  const [savedTaux,     setSavedTaux]     = useState(false);
  const [tauxCharge,    setTauxCharge]    = useState(false);
  // Liaison catégorie → fond en cours de sauvegarde
  const [savingLien,    setSavingLien]    = useState<string|null>(null);

  const charger = useCallback(async () => {
    setLoading(true);
    try {
      const [rCats, rComptes, rParams, rBanques, rDonnees] = await Promise.all([
        fetch('/api/categories'),
        fetch('/api/comptes'),
        fetch('/api/parametres'),
        fetch('/api/banques'),
        fetch('/api/donnees'),
      ]);
      if (rDonnees.ok) { const d = await rDonnees.json(); setAnneesData(d.annees ?? []); }
      if (rBanques.ok) { const d = await rBanques.json(); setBanques(d.banques ?? []); }
      if (rCats.ok)    { const d = await rCats.json();    setCategories(d.categories ?? []); }
      if (rComptes.ok) { const d = await rComptes.json(); setComptes(d.comptes ?? []); }
      if (rParams.ok) {
        const d = await rParams.json();
        if (!tauxCharge) {
          setRevenuRef(d.revenuMensuelReference ?? 0);
          const taux = {} as Record<GrandeCategorie, number>;
          GRANDES_CATEGORIES.forEach(type => {
            const cat = (d.categories ?? []).find((c: any) => c.type === type);
            taux[type] = cat?.tauxReference ?? 0;
          });
          setTauxRef(taux);
          setTauxCharge(true);
        }
      }
    } catch (e) {
      console.error('Parametres charger error:', e);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { charger(); }, [charger]);

  const chargerOnglet = useCallback(async (tab: string) => {
    try {
      if (tab === 'categories') {
        const r = await fetch('/api/categories');
        if (r.ok) { const d = await r.json(); setCategories(d.categories ?? []); }
        const rc = await fetch('/api/comptes');
        if (rc.ok) { const d = await rc.json(); setComptes(d.comptes ?? []); }
      } else if (tab === 'comptes') {
        const r = await fetch('/api/comptes');
        if (r.ok) { const d = await r.json(); setComptes(d.comptes ?? []); }
      } else if (tab === 'banques') {
        const r = await fetch('/api/banques');
        if (r.ok) { const d = await r.json(); setBanques(d.banques ?? []); }
      } else if (tab === 'donnees') {
        const r = await fetch('/api/donnees');
        if (r.ok) { const d = await r.json(); setAnneesData(d.annees ?? []); }
      }
    } catch (e) { console.error('chargerOnglet error:', e); }
  }, []);

  useEffect(() => { chargerOnglet(activeTab); }, [activeTab, chargerOnglet]);

  const montantPourTaux = (taux: number) =>
    revenuRef > 0 ? Math.round((taux / 100) * revenuRef) : 0;

  const totalTaux = GRANDES_CATEGORIES.reduce((s, t) => s + (tauxRef[t] ?? 0), 0);

  const sauvegarderTaux = async () => {
    setSavingTaux(true);
    try {
      const res = await fetch('/api/parametres', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revenuMensuelReference: revenuRef, tauxReference: tauxRef }),
      });
      if (res.ok) { setSavedTaux(true); setTimeout(() => setSavedTaux(false), 3000); }
    } catch (e) { console.error('sauvegarderTaux error:', e); }
    finally { setSavingTaux(false); }
  };

  // ── Liaison catégorie → CompteFonds ─────────────────────────────────────
  const sauvegarderLien = async (catId: string, compteFondsId: string | null) => {
    setSavingLien(catId);
    try {
      await fetch('/api/categories', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: catId, compteFondsId }),
      });
      // Mettre à jour localement sans re-fetch complet
      setCategories(prev => prev.map(c =>
        c.id === catId
          ? { ...c, compteFondsId, compteFonds: compteFondsId ? comptes.find(cp => cp.id === compteFondsId) : null }
          : c
      ));
    } catch (e) { console.error('sauvegarderLien error:', e); }
    finally { setSavingLien(null); }
  };

  const ajouterCategorie = async () => {
    if (!newCat.nom) return;
    await fetch('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newCat),
    });
    setNewCat({ nom: '', type: 'depense_variable', sousType: '' });
    setShowNewCat(false);
    chargerOnglet('categories');
  };

  const sauvegarderCat = async () => {
    if (!editCat) return;
    await fetch('/api/categories', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editCat),
    });
    setEditCat(null);
    chargerOnglet('categories');
  };

  const supprimerCat = async (id: string) => {
    if (!confirm('Désactiver cette catégorie ?')) return;
    await fetch(`/api/categories?id=${id}`, { method: 'DELETE' });
    chargerOnglet('categories');
  };

  const ajouterCompte = async () => {
    if (!newCompte) return;
    await fetch('/api/comptes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nom: newCompte, ordre: comptes.length }),
    });
    setNewCompte('');
    setShowNewCompte(false);
    chargerOnglet('comptes');
  };

  const sauvegarderCompte = async () => {
    if (!editCompte) return;
    await fetch('/api/comptes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editCompte),
    });
    setEditCompte(null);
    chargerOnglet('comptes');
  };

  const supprimerCompte = async (id: string) => {
    if (!confirm('Désactiver ce compte ?')) return;
    await fetch(`/api/comptes?id=${id}`, { method: 'DELETE' });
    chargerOnglet('comptes');
  };

  const importerExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/import', { method: 'POST', body: fd });
    setImportResult(await res.json());
    setImporting(false);
    e.target.value = '';
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64"><div className="spinner scale-150" /></div>
  );

  const catsByType = ORDRE_TYPES.map(type => ({
    type,
    cats: categories.filter(c => c.type === type),
  })).filter(g => g.cats.length > 0);

  // Fonds actifs pour le dropdown de liaison
  const fondsActifs = comptes.filter(c => c.isActive);

  const inputCls = "w-full border border-[var(--border)] rounded-xl px-3 py-2 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none transition-all";

  return (
    <div className="space-y-5 animate-fadeIn">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text)]">Paramètres</h1>
        <p className="text-[var(--text-muted)] text-sm">Gérez vos catégories, comptes et données</p>
      </div>

      {/* Onglets */}
      <div className="flex gap-1 bg-slate-100 dark:bg-dark-card rounded-xl p-1 w-fit border border-[var(--border)] flex-wrap">
        {(['categories', 'comptes', 'banques', 'import', 'donnees'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={clsx('px-4 py-2 rounded-lg text-sm font-medium transition-all',
              activeTab === tab ? 'bg-[var(--surface)] text-primary shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text)]')}>
            {tab === 'categories' ? 'Catégories' : tab === 'comptes' ? 'Fonds' : tab === 'banques' ? 'Banques' : tab === 'donnees' ? '🗑️ Données' : 'Import Excel'}
          </button>
        ))}
      </div>

      {/* ── ONGLET CATÉGORIES ── */}
      {activeTab === 'categories' && (
        <div className="space-y-5">

          {/* Budget de référence */}
          <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5 transition-colors">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-[var(--text)]">Budget de référence par catégorie</h3>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">Définissez le revenu mensuel et les taux par grande catégorie</p>
              </div>
              <button onClick={sauvegarderTaux} disabled={savingTaux}
                className="flex items-center gap-1.5 bg-primary hover:bg-primary-dark text-white rounded-xl px-3.5 py-2 text-sm font-medium transition-all disabled:opacity-60">
                <Save size={14} />{savingTaux ? 'Sauvegarde...' : savedTaux ? 'Sauvegardé ✓' : 'Sauvegarder'}
              </button>
            </div>
            <div className="mb-5 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-800">
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex-1 min-w-48">
                  <label className="text-xs font-semibold text-blue-700 dark:text-blue-400 mb-1 block">
                    💰 Revenu mensuel de référence (FCFA)
                  </label>
                  <input type="number" value={revenuRef || ''}
                    onChange={e => setRevenuRef(parseInt(e.target.value) || 0)}
                    placeholder="Ex: 500000"
                    className="w-full border border-blue-300 dark:border-blue-700 rounded-xl px-3 py-2 text-sm bg-white dark:bg-dark-card text-[var(--text)] focus:border-primary outline-none" />
                </div>
                <div className="text-right">
                  <p className="text-xs text-blue-600 dark:text-blue-400">100%</p>
                  <p className="text-lg font-bold text-blue-700 dark:text-blue-400">{formatFCFA(revenuRef)}</p>
                  <p className="text-xs text-blue-500">Objectif fonds urgence (×6) : {formatFCFA(revenuRef * 6)}</p>
                </div>
              </div>
            </div>
            <div className="space-y-3">
              {GRANDES_CATEGORIES.map(type => {
                const taux    = tauxRef[type] ?? 0;
                const montant = montantPourTaux(taux);
                const isOver  = totalTaux > 100;
                const label   = TYPE_LABELS[type as keyof typeof TYPE_LABELS];
                return (
                  <div key={type} className="space-y-1.5">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-sm font-medium text-[var(--text)] w-52 flex-shrink-0">{label}</span>
                      <div className="flex items-center gap-1.5">
                        <input type="number" min="0" max="100" step="0.5" value={taux || ''}
                          onChange={e => setTauxRef(prev => ({ ...prev, [type]: parseFloat(e.target.value) || 0 }))}
                          placeholder="0"
                          className="w-20 text-right border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none" />
                        <span className="text-sm text-[var(--text-muted)]">%</span>
                      </div>
                      <span className="text-sm font-semibold text-primary w-36">
                        {revenuRef > 0 ? formatFCFA(montant) : '—'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-slate-100 dark:bg-dark-card rounded-full overflow-hidden">
                        <div className={clsx('h-full rounded-full transition-all',
                          isOver ? 'bg-red-500' : taux > 30 ? 'bg-blue-500' : taux > 15 ? 'bg-green-500' : 'bg-amber-400')}
                          style={{ width: `${Math.min(100, taux)}%` }} />
                      </div>
                      <span className="text-xs text-[var(--text-muted)] w-10 text-right">{taux}%</span>
                    </div>
                  </div>
                );
              })}
              <div className={clsx('mt-4 pt-4 border-t border-[var(--border)] flex items-center justify-between rounded-xl px-3 py-2',
                totalTaux > 100 ? 'bg-red-50 dark:bg-red-900/20' : totalTaux === 100 ? 'bg-green-50 dark:bg-green-900/20' : 'bg-amber-50 dark:bg-amber-900/20')}>
                <span className="text-sm font-bold text-[var(--text)]">Total alloué</span>
                <div className="flex items-center gap-3">
                  {revenuRef > 0 && (
                    <span className="text-sm text-[var(--text-muted)]">
                      {formatFCFA(Math.round((totalTaux / 100) * revenuRef))} / {formatFCFA(revenuRef)}
                    </span>
                  )}
                  <span className={clsx('text-sm font-bold px-3 py-1 rounded-lg',
                    totalTaux > 100 ? 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400' :
                    totalTaux === 100 ? 'bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-400' :
                    'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400')}>
                    {totalTaux > 100 ? `⚠️ ${totalTaux}%` : totalTaux === 100 ? `✅ ${totalTaux}%` : `⚡ ${totalTaux}% (reste ${(100 - totalTaux).toFixed(1)}%)`}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Liste des catégories */}
          <div className="flex justify-between items-center">
            <p className="text-sm text-[var(--text-muted)]">{categories.filter(c => c.isActive).length} catégories actives</p>
            <button onClick={() => setShowNewCat(!showNewCat)}
              className="flex items-center gap-1.5 bg-primary hover:bg-primary-dark text-white rounded-xl px-3.5 py-2 text-sm font-medium transition-all">
              <Plus size={14} />Ajouter
            </button>
          </div>

          {showNewCat && (
            <div className="bg-[var(--surface)] border border-primary/30 rounded-2xl p-4 flex flex-wrap gap-3 items-end transition-colors">
              <div className="flex-1 min-w-40">
                <label className="text-xs text-[var(--text-muted)] mb-1 block">Nom *</label>
                <input type="text" value={newCat.nom} onChange={e => setNewCat(n => ({ ...n, nom: e.target.value }))}
                  placeholder="Nom de la catégorie" className={inputCls} />
              </div>
              <div>
                <label className="text-xs text-[var(--text-muted)] mb-1 block">Type *</label>
                <select value={newCat.type} onChange={e => setNewCat(n => ({ ...n, type: e.target.value }))}
                  className="border border-[var(--border)] rounded-xl px-3 py-2 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none">
                  {ORDRE_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t as keyof typeof TYPE_LABELS]}</option>)}
                </select>
              </div>
              <div className="flex-1 min-w-32">
                <label className="text-xs text-[var(--text-muted)] mb-1 block">Sous-type</label>
                <input type="text" value={newCat.sousType} onChange={e => setNewCat(n => ({ ...n, sousType: e.target.value }))}
                  placeholder="Ex: Habitation" className={inputCls} />
              </div>
              <div className="flex gap-2">
                <button onClick={ajouterCategorie} className="bg-primary text-white rounded-xl px-4 py-2 text-sm"><Check size={14} /></button>
                <button onClick={() => setShowNewCat(false)} className="border border-[var(--border)] text-[var(--text-muted)] rounded-xl px-4 py-2 text-sm"><X size={14} /></button>
              </div>
            </div>
          )}

          {catsByType.map(({ type, cats }) => (
            <div key={type} className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] overflow-hidden transition-colors">
              <div className="px-4 py-2.5 bg-slate-50 dark:bg-dark-card border-b border-[var(--border)] flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wide">
                    {TYPE_LABELS[type as keyof typeof TYPE_LABELS]}
                  </span>
                  <span className="ml-2 text-xs text-[var(--text-muted)] opacity-60">({cats.length})</span>
                </div>
                <div className="flex items-center gap-3">
                  {tauxRef[type as GrandeCategorie] > 0 && (
                    <span className="text-xs font-semibold text-primary">
                      {tauxRef[type as GrandeCategorie]}% — {formatFCFA(montantPourTaux(tauxRef[type as GrandeCategorie]))}
                    </span>
                  )}
                  {/* Légende liaison pour epargne_autre */}
                  {type === 'epargne_autre' && fondsActifs.length > 0 && (
                    <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                      <Link size={10} />Fond lié
                    </span>
                  )}
                </div>
              </div>
              <div className="divide-y divide-[var(--border)]">
                {cats.map((cat: any) => (
                  <div key={cat.id}
                    className={clsx('px-4 py-2.5 flex items-center gap-3 hover:bg-slate-50/50 dark:hover:bg-dark-card/50 transition-colors',
                      !cat.isActive && 'opacity-40')}>
                    {editCat?.id === cat.id ? (
                      <>
                        <input type="text" value={editCat.nom}
                          onChange={e => setEditCat((c: any) => ({ ...c, nom: e.target.value }))}
                          className="flex-1 border border-primary rounded-lg px-2 py-1 text-sm bg-[var(--card)] text-[var(--text)] outline-none" />
                        <button onClick={sauvegarderCat} className="text-green-500 hover:text-green-600"><Check size={15} /></button>
                        <button onClick={() => setEditCat(null)} className="text-[var(--text-muted)] hover:text-[var(--text)]"><X size={15} /></button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 text-sm text-[var(--text)]">{cat.nom}</span>
                        {cat.sousType && <span className="text-xs text-[var(--text-muted)]">{cat.sousType}</span>}

                        {/* ── Dropdown liaison fond (epargne_autre uniquement) ── */}
                        {type === 'epargne_autre' && cat.isActive && (
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {savingLien === cat.id ? (
                              <span className="text-xs text-primary animate-pulse">Liaison...</span>
                            ) : (
                              <>
                                <select
                                  value={cat.compteFondsId ?? ''}
                                  onChange={e => sauvegarderLien(cat.id, e.target.value || null)}
                                  className={clsx(
                                    'text-xs border rounded-lg px-2 py-1 outline-none transition-all',
                                    cat.compteFondsId
                                      ? 'border-primary/40 bg-primary/5 text-primary font-medium'
                                      : 'border-[var(--border)] bg-[var(--card)] text-[var(--text-muted)]'
                                  )}>
                                  <option value="">— Non lié —</option>
                                  {fondsActifs.map((f: any) => (
                                    <option key={f.id} value={f.id}>{f.nom}</option>
                                  ))}
                                </select>
                                {cat.compteFondsId
                                  ? <Link size={12} className="text-primary flex-shrink-0" />
                                  : <Link2Off size={12} className="text-slate-300 flex-shrink-0" />}
                              </>
                            )}
                          </div>
                        )}

                        <button onClick={() => setEditCat(cat)}
                          className="text-slate-300 dark:text-slate-600 hover:text-primary transition-colors">
                          <Pencil size={13} />
                        </button>
                        {cat.isActive && (
                          <button onClick={() => supprimerCat(cat.id)}
                            className="text-slate-300 dark:text-slate-600 hover:text-red-500 transition-colors">
                            <Trash2 size={13} />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── ONGLET FONDS ── */}
      {activeTab === 'comptes' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-[var(--text-muted)]">{comptes.filter(c => c.isActive).length} fonds actifs</p>
            <button onClick={() => setShowNewCompte(!showNewCompte)}
              className="flex items-center gap-1.5 bg-primary hover:bg-primary-dark text-white rounded-xl px-3.5 py-2 text-sm font-medium transition-all">
              <Plus size={14} />Ajouter
            </button>
          </div>
          {showNewCompte && (
            <div className="bg-[var(--surface)] border border-primary/30 rounded-2xl p-4 flex gap-3 items-end transition-colors">
              <div className="flex-1">
                <label className="text-xs text-[var(--text-muted)] mb-1 block">Nom du fond *</label>
                <input type="text" value={newCompte} onChange={e => setNewCompte(e.target.value)}
                  placeholder="Ex: Fond scolarité" className={inputCls} />
              </div>
              <button onClick={ajouterCompte} className="bg-primary text-white rounded-xl px-4 py-2 text-sm"><Check size={14} /></button>
              <button onClick={() => setShowNewCompte(false)} className="border border-[var(--border)] text-[var(--text-muted)] rounded-xl px-4 py-2 text-sm"><X size={14} /></button>
            </div>
          )}
          <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] divide-y divide-[var(--border)] transition-colors">
            {comptes.map((c: any) => (
              <div key={c.id} className={clsx('px-4 py-3 flex items-center gap-3 hover:bg-slate-50/50 dark:hover:bg-dark-card/50 transition-colors', !c.isActive && 'opacity-40')}>
                {editCompte?.id === c.id ? (
                  <>
                    <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center text-primary font-bold text-sm flex-shrink-0">{editCompte.nom.charAt(0)}</div>
                    <input type="text" value={editCompte.nom} onChange={e => setEditCompte((p: any) => ({ ...p, nom: e.target.value }))}
                      className="flex-1 border border-primary rounded-lg px-2 py-1 text-sm bg-[var(--card)] text-[var(--text)] outline-none" />
                    <button onClick={sauvegarderCompte} className="text-green-500 hover:text-green-600"><Check size={15} /></button>
                    <button onClick={() => setEditCompte(null)} className="text-[var(--text-muted)] hover:text-[var(--text)]"><X size={15} /></button>
                  </>
                ) : (
                  <>
                    <div className="w-8 h-8 rounded-xl bg-primary/10 dark:bg-primary/20 flex items-center justify-center text-primary font-bold text-sm">{c.nom.charAt(0)}</div>
                    <span className="flex-1 text-sm text-[var(--text)] font-medium">{c.nom}</span>
                    <span className="text-sm font-bold text-primary">{formatFCFA(c.soldeActuel ?? 0)}</span>
                    {/* Nombre de catégories liées */}
                    {categories.filter(cat => cat.compteFondsId === c.id).length > 0 && (
                      <span className="text-xs px-2 py-0.5 rounded-lg bg-primary/10 text-primary font-medium flex items-center gap-1">
                        <Link size={10} />
                        {categories.filter(cat => cat.compteFondsId === c.id).length} cat.
                      </span>
                    )}
                    {c.isActive && (
                      <>
                        <button onClick={() => setEditCompte(c)} className="text-slate-300 dark:text-slate-600 hover:text-primary transition-colors"><Pencil size={13} /></button>
                        <button onClick={() => supprimerCompte(c.id)} className="text-slate-300 dark:text-slate-600 hover:text-red-500 transition-colors"><Trash2 size={14} /></button>
                      </>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── ONGLET BANQUES ── */}
      {activeTab === 'banques' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-[var(--text-muted)]">{banques.length} banque(s) configurée(s)</p>
            <button onClick={() => setShowNewBanque(!showNewBanque)}
              className="flex items-center gap-1.5 bg-primary hover:bg-primary-dark text-white rounded-xl px-3.5 py-2 text-sm font-medium transition-all">
              <Plus size={14} />Ajouter une banque
            </button>
          </div>
          {showNewBanque && (
            <div className="bg-[var(--surface)] border border-primary/30 rounded-2xl p-4 flex flex-wrap gap-3 items-end transition-colors">
              <div className="flex-1 min-w-40">
                <label className="text-xs text-[var(--text-muted)] mb-1 block">Nom de la banque *</label>
                <input type="text" value={newBanque.nom} onChange={e => setNewBanque(n => ({ ...n, nom: e.target.value }))}
                  placeholder="Ex: BOA — Yvan" className={inputCls} />
              </div>
              <div className="w-40">
                <label className="text-xs text-[var(--text-muted)] mb-1 block">Solde initial (FCFA)</label>
                <input type="number" value={newBanque.solde} onChange={e => setNewBanque(n => ({ ...n, solde: e.target.value }))}
                  placeholder="0" className={inputCls} />
              </div>
              <div className="flex gap-2">
                <button onClick={async () => {
                  if (!newBanque.nom) return;
                  await fetch('/api/banques', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nomBanque: newBanque.nom, soldeInitial: parseInt(newBanque.solde) || 0 }) });
                  setNewBanque({ nom: '', solde: '' }); setShowNewBanque(false); chargerOnglet('banques');
                }} className="bg-primary text-white rounded-xl px-4 py-2 text-sm"><Check size={14} /></button>
                <button onClick={() => setShowNewBanque(false)} className="border border-[var(--border)] text-[var(--text-muted)] rounded-xl px-4 py-2 text-sm"><X size={14} /></button>
              </div>
            </div>
          )}
          <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] divide-y divide-[var(--border)] transition-colors">
            {banques.length === 0 ? (
              <div className="px-4 py-8 text-center text-[var(--text-muted)] text-sm">Aucune banque configurée.</div>
            ) : banques.map((b: any) => (
              <div key={b.id} className="px-4 py-3 flex items-center gap-3 hover:bg-slate-50/50 dark:hover:bg-dark-card/50 transition-colors">
                {editBanque?.id === b.id ? (
                  <>
                    <div className="w-8 h-8 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 font-bold text-sm flex-shrink-0">🏦</div>
                    <input type="text" value={editBanque.nomBanque} onChange={e => setEditBanque((p: any) => ({ ...p, nomBanque: e.target.value }))}
                      className="flex-1 border border-primary rounded-lg px-2 py-1 text-sm bg-[var(--card)] text-[var(--text)] outline-none" />
                    <button onClick={async () => { await fetch(`/api/banques?id=${editBanque.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nomBanque: editBanque.nomBanque }) }); setEditBanque(null); chargerOnglet('banques'); }} className="text-green-500 hover:text-green-600"><Check size={15} /></button>
                    <button onClick={() => setEditBanque(null)} className="text-[var(--text-muted)] hover:text-[var(--text)]"><X size={15} /></button>
                  </>
                ) : (
                  <>
                    <div className="w-8 h-8 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 font-bold text-sm">🏦</div>
                    <span className="flex-1 text-sm text-[var(--text)] font-medium">{b.nomBanque}</span>
                    <span className="text-sm font-bold text-primary">{formatFCFA(b.solde)}</span>
                    <button onClick={() => setEditBanque(b)} className="text-slate-300 dark:text-slate-600 hover:text-primary transition-colors"><Pencil size={13} /></button>
                    <button onClick={async () => { if (!confirm('Supprimer cette banque ?')) return; await fetch(`/api/banques?id=${b.id}`, { method: 'DELETE' }); chargerOnglet('banques'); }} className="text-slate-300 dark:text-slate-600 hover:text-red-500 transition-colors"><Trash2 size={14} /></button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── ONGLET DONNÉES ── */}
      {activeTab === 'donnees' && (
        <div className="space-y-4">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
            <p className="font-semibold text-red-700 dark:text-red-400 text-sm mb-1">⚠️ Zone dangereuse</p>
            <p className="text-xs text-red-600 dark:text-red-400">La suppression de données est irréversible.</p>
          </div>
          {anneesData.length === 0 ? (
            <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-8 text-center text-[var(--text-muted)] text-sm">Aucune donnée disponible</div>
          ) : anneesData.map((a: any) => (
            <div key={a.id} className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5 transition-colors">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-bold text-[var(--text)]">{a.annee}</h3>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">{a.nbMois} mois avec données · {a.nbDecaissements} opération(s)</p>
                </div>
                <button onClick={() => { setSuppAnnee(a.annee); setSuppMois(null); setConfirmText(''); setSuppResult(''); }}
                  className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-xl text-xs font-semibold transition-all">
                  🗑️ Supprimer {a.annee}
                </button>
              </div>
              {a.moisAvecDonnees.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {a.moisAvecDonnees.map((m: number) => (
                    <button key={m} onClick={() => { setSuppAnnee(a.annee); setSuppMois(m); setConfirmText(''); setSuppResult(''); }}
                      className="px-2.5 py-1 border border-[var(--border)] rounded-lg text-xs text-[var(--text-muted)] hover:border-red-400 hover:text-red-500 transition-all">
                      {['','Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'][m]} ×
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {suppAnnee !== null && (
            <div className="fixed inset-0 z-50 flex items-center justify-center">
              <div className="absolute inset-0 bg-black/50" onClick={() => setSuppAnnee(null)} />
              <div className="relative bg-[var(--surface)] rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 space-y-4">
                <h3 className="font-bold text-red-600 text-lg">⚠️ Confirmer la suppression</h3>
                <p className="text-sm text-[var(--text)]">
                  {suppMois
                    ? `Vous allez supprimer les données de ${['','Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'][suppMois]} ${suppAnnee}.`
                    : `Vous allez supprimer TOUTES les données de l'année ${suppAnnee}.`}
                </p>
                <p className="text-sm font-semibold text-[var(--text)]">
                  Tapez <span className="text-red-500 font-bold">{suppMois ? `${suppAnnee}/${suppMois}` : String(suppAnnee)}</span> :
                </p>
                <input type="text" value={confirmText} onChange={e => setConfirmText(e.target.value)}
                  placeholder={suppMois ? `${suppAnnee}/${suppMois}` : String(suppAnnee)}
                  className="w-full border border-[var(--border)] rounded-xl px-3 py-2 text-sm bg-[var(--card)] text-[var(--text)] focus:border-red-400 outline-none" />
                {suppResult && <p className="text-sm text-green-600 dark:text-green-400 font-medium">{suppResult}</p>}
                <div className="flex gap-2 justify-end">
                  <button onClick={() => { setSuppAnnee(null); setConfirmText(''); }}
                    className="px-4 py-2 rounded-xl text-sm border border-[var(--border)] text-[var(--text-muted)] hover:bg-slate-50 dark:hover:bg-dark-card transition-all">Annuler</button>
                  <button
                    disabled={suppLoading || (suppMois ? confirmText !== `${suppAnnee}/${suppMois}` : confirmText !== String(suppAnnee))}
                    onClick={async () => {
                      setSuppLoading(true);
                      const url = suppMois ? `/api/donnees?annee=${suppAnnee}&mois=${suppMois}` : `/api/donnees?annee=${suppAnnee}`;
                      const res = await fetch(url, { method: 'DELETE' });
                      const d = await res.json();
                      setSuppResult(d.message ?? 'Supprimé');
                      setSuppLoading(false); setConfirmText('');
                      chargerOnglet('donnees');
                      setTimeout(() => { setSuppAnnee(null); setSuppResult(''); }, 2000);
                    }}
                    className="px-4 py-2 rounded-xl text-sm bg-red-500 hover:bg-red-600 text-white font-semibold transition-all disabled:opacity-40">
                    {suppLoading ? 'Suppression...' : '🗑️ Confirmer'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── ONGLET IMPORT ── */}
      {activeTab === 'import' && (
        <div className="space-y-4">
          <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-6 transition-colors">
            <h3 className="font-semibold text-[var(--text)] mb-2">Importer depuis Excel</h3>
            <p className="text-sm text-[var(--text-muted)] mb-4">
              Importez votre fichier <strong className="text-[var(--text)]">BUDGET_MENSUEL_OK.xlsx</strong>.
              L'import lit les onglets{' '}
              <code className="bg-slate-100 dark:bg-dark-card px-1 rounded text-xs">Suivi-2024</code>,{' '}
              <code className="bg-slate-100 dark:bg-dark-card px-1 rounded text-xs">Suivi-2025</code>,{' '}
              <code className="bg-slate-100 dark:bg-dark-card px-1 rounded text-xs">Suivi-2026</code>.
            </p>
            <label className={clsx('flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-2xl cursor-pointer transition-all',
              importing ? 'border-primary bg-primary/5 dark:bg-primary/10' : 'border-[var(--border)] bg-slate-50 dark:bg-dark-card hover:border-primary hover:bg-primary/5 dark:hover:bg-primary/10')}>
              <Upload size={24} className={clsx('mb-2', importing ? 'text-primary animate-bounce' : 'text-[var(--text-muted)]')} />
              <span className="text-sm font-medium text-[var(--text)]">{importing ? 'Import en cours...' : 'Cliquez pour sélectionner'}</span>
              <span className="text-xs text-[var(--text-muted)] mt-1">.xlsx uniquement</span>
              <input type="file" accept=".xlsx,.xls" className="hidden" onChange={importerExcel} disabled={importing} />
            </label>
            {importResult && (
              <div className={clsx('mt-4 p-4 rounded-xl text-sm',
                importResult.success ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800')}>
                {importResult.success ? (
                  <>
                    <p className="font-semibold text-green-700 dark:text-green-400 mb-2">✅ Import terminé</p>
                    {Object.entries(importResult.results ?? {}).map(([yr, res]: any) => (
                      <div key={yr} className="text-green-600 dark:text-green-400">
                        <span className="font-medium">{yr}</span> : <span className="ml-1">{res.imported} ligne(s)</span>
                        {res.skipped > 0 && <span className="ml-1 text-green-500">, {res.skipped} ignorée(s)</span>}
                      </div>
                    ))}
                  </>
                ) : (
                  <p className="text-red-600 dark:text-red-400">❌ {importResult.error}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
