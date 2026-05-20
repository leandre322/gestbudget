'use client';

import { useEffect, useState, useCallback } from 'react';
import { Plus, Pencil, Trash2, Check, X, Upload } from 'lucide-react';
import { TYPE_LABELS, ORDRE_TYPES } from '@/types';
import { clsx } from 'clsx';

export default function ParametresPage() {
  const [categories, setCategories] = useState<any[]>([]);
  const [comptes, setComptes]       = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [editCat, setEditCat]       = useState<any>(null);
  const [newCat, setNewCat]         = useState({ nom: '', type: 'depense_variable', sousType: '' });
  const [showNewCat, setShowNewCat] = useState(false);
  const [newCompte, setNewCompte]   = useState('');
  const [showNewCompte, setShowNewCompte] = useState(false);
  const [importing, setImporting]   = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [activeTab, setActiveTab]   = useState<'categories'|'comptes'|'import'>('categories');

  const charger = useCallback(async () => {
    setLoading(true);
    const [rCats, rComptes] = await Promise.all([
      fetch('/api/categories'),
      fetch('/api/comptes'),
    ]);
    if (rCats.ok)   { const d = await rCats.json();   setCategories(d.categories ?? []); }
    if (rComptes.ok){ const d = await rComptes.json(); setComptes(d.comptes ?? []); }
    setLoading(false);
  }, []);

  useEffect(() => { charger(); }, [charger]);

  const ajouterCategorie = async () => {
    if (!newCat.nom) return;
    await fetch('/api/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newCat) });
    setNewCat({ nom: '', type: 'depense_variable', sousType: '' });
    setShowNewCat(false); charger();
  };

  const sauvegarderCat = async () => {
    if (!editCat) return;
    await fetch('/api/categories', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editCat) });
    setEditCat(null); charger();
  };

  const supprimerCat = async (id: string) => {
    if (!confirm('Désactiver cette catégorie ?')) return;
    await fetch(`/api/categories?id=${id}`, { method: 'DELETE' }); charger();
  };

  const ajouterCompte = async () => {
    if (!newCompte) return;
    await fetch('/api/comptes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nom: newCompte, ordre: comptes.length }) });
    setNewCompte(''); setShowNewCompte(false); charger();
  };

  const supprimerCompte = async (id: string) => {
    if (!confirm('Désactiver ce compte ?')) return;
    await fetch(`/api/comptes?id=${id}`, { method: 'DELETE' }); charger();
  };

  const importerExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true); setImportResult(null);
    const fd = new FormData(); fd.append('file', file);
    const res = await fetch('/api/import', { method: 'POST', body: fd });
    setImportResult(await res.json());
    setImporting(false);
    // Reset input
    e.target.value = '';
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="spinner scale-150" /></div>;

  const catsByType = ORDRE_TYPES.map(type => ({
    type, cats: categories.filter(c => c.type === type),
  })).filter(g => g.cats.length > 0);

  const inputCls = "w-full border border-[var(--border)] rounded-xl px-3 py-2 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none transition-all";

  return (
    <div className="space-y-5 animate-fadeIn">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text)]">Paramètres</h1>
        <p className="text-[var(--text-muted)] text-sm">Gérez vos catégories, comptes et données</p>
      </div>

      {/* Onglets */}
      <div className="flex gap-1 bg-slate-100 dark:bg-dark-card rounded-xl p-1 w-fit border border-[var(--border)]">
        {(['categories', 'comptes', 'import'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={clsx('px-4 py-2 rounded-lg text-sm font-medium transition-all',
              activeTab === tab ? 'bg-[var(--surface)] text-primary shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text)]')}>
            {tab === 'categories' ? 'Catégories' : tab === 'comptes' ? 'Comptes fonds' : 'Import Excel'}
          </button>
        ))}
      </div>

      {/* CATÉGORIES */}
      {activeTab === 'categories' && (
        <div className="space-y-4">
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
                <input type="text" value={newCat.nom} onChange={e => setNewCat(n => ({...n, nom: e.target.value}))}
                  placeholder="Nom de la catégorie" className={inputCls} />
              </div>
              <div>
                <label className="text-xs text-[var(--text-muted)] mb-1 block">Type *</label>
                <select value={newCat.type} onChange={e => setNewCat(n => ({...n, type: e.target.value}))}
                  className="border border-[var(--border)] rounded-xl px-3 py-2 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none">
                  {ORDRE_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                </select>
              </div>
              <div className="flex-1 min-w-32">
                <label className="text-xs text-[var(--text-muted)] mb-1 block">Sous-type</label>
                <input type="text" value={newCat.sousType} onChange={e => setNewCat(n => ({...n, sousType: e.target.value}))}
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
              <div className="px-4 py-2.5 bg-slate-50 dark:bg-dark-card border-b border-[var(--border)]">
                <span className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wide">{TYPE_LABELS[type]}</span>
                <span className="ml-2 text-xs text-[var(--text-muted)] opacity-60">({cats.length})</span>
              </div>
              <div className="divide-y divide-[var(--border)]">
                {cats.map(cat => (
                  <div key={cat.id} className={clsx('px-4 py-2.5 flex items-center gap-3 hover:bg-slate-50/50 dark:hover:bg-dark-card/50 transition-colors', !cat.isActive && 'opacity-40')}>
                    {editCat?.id === cat.id ? (
                      <>
                        <input type="text" value={editCat.nom} onChange={e => setEditCat((c: any) => ({...c, nom: e.target.value}))}
                          className="flex-1 border border-primary rounded-lg px-2 py-1 text-sm bg-[var(--card)] text-[var(--text)] outline-none" />
                        <button onClick={sauvegarderCat} className="text-green-500 hover:text-green-600"><Check size={15} /></button>
                        <button onClick={() => setEditCat(null)} className="text-[var(--text-muted)] hover:text-[var(--text)]"><X size={15} /></button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 text-sm text-[var(--text)]">{cat.nom}</span>
                        {cat.sousType && <span className="text-xs text-[var(--text-muted)]">{cat.sousType}</span>}
                        <button onClick={() => setEditCat(cat)} className="text-slate-300 dark:text-slate-600 hover:text-primary transition-colors"><Pencil size={13} /></button>
                        {cat.isActive && <button onClick={() => supprimerCat(cat.id)} className="text-slate-300 dark:text-slate-600 hover:text-red-500 transition-colors"><Trash2 size={13} /></button>}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* COMPTES */}
      {activeTab === 'comptes' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-[var(--text-muted)]">{comptes.filter(c => c.isActive).length} comptes actifs</p>
            <button onClick={() => setShowNewCompte(!showNewCompte)}
              className="flex items-center gap-1.5 bg-primary hover:bg-primary-dark text-white rounded-xl px-3.5 py-2 text-sm font-medium transition-all">
              <Plus size={14} />Ajouter
            </button>
          </div>
          {showNewCompte && (
            <div className="bg-[var(--surface)] border border-primary/30 rounded-2xl p-4 flex gap-3 items-end transition-colors">
              <div className="flex-1">
                <label className="text-xs text-[var(--text-muted)] mb-1 block">Nom du compte *</label>
                <input type="text" value={newCompte} onChange={e => setNewCompte(e.target.value)}
                  placeholder="Ex: Fond scolarité" className={inputCls} />
              </div>
              <button onClick={ajouterCompte} className="bg-primary text-white rounded-xl px-4 py-2 text-sm"><Check size={14} /></button>
              <button onClick={() => setShowNewCompte(false)} className="border border-[var(--border)] text-[var(--text-muted)] rounded-xl px-4 py-2 text-sm"><X size={14} /></button>
            </div>
          )}
          <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] divide-y divide-[var(--border)] transition-colors">
            {comptes.map(c => (
              <div key={c.id} className={clsx('px-4 py-3 flex items-center gap-3 hover:bg-slate-50/50 dark:hover:bg-dark-card/50 transition-colors', !c.isActive && 'opacity-40')}>
                <div className="w-8 h-8 rounded-xl bg-primary/10 dark:bg-primary/20 flex items-center justify-center text-primary font-bold text-sm">
                  {c.nom.charAt(0)}
                </div>
                <span className="flex-1 text-sm text-[var(--text)] font-medium">{c.nom}</span>
                {c.isActive && <button onClick={() => supprimerCompte(c.id)} className="text-slate-300 dark:text-slate-600 hover:text-red-500 transition-colors"><Trash2 size={14} /></button>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* IMPORT */}
      {activeTab === 'import' && (
        <div className="space-y-4">
          <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-6 transition-colors">
            <h3 className="font-semibold text-[var(--text)] mb-2">Importer depuis Excel</h3>
            <p className="text-sm text-[var(--text-muted)] mb-4">
              Importez votre fichier <strong className="text-[var(--text)]">BUDGET_MENSUEL_OK.xlsx</strong>.
              L'import lit les onglets <code className="bg-slate-100 dark:bg-dark-card px-1 rounded text-xs">Suivi-2024</code>,
              <code className="bg-slate-100 dark:bg-dark-card px-1 rounded text-xs ml-1">Suivi-2025</code>,
              <code className="bg-slate-100 dark:bg-dark-card px-1 rounded text-xs ml-1">Suivi-2026</code>.
            </p>

            <label className={clsx(
              'flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-2xl cursor-pointer transition-all',
              importing
                ? 'border-primary bg-primary/5 dark:bg-primary/10'
                : 'border-[var(--border)] bg-slate-50 dark:bg-dark-card hover:border-primary hover:bg-primary/5 dark:hover:bg-primary/10'
            )}>
              <Upload size={24} className={clsx('mb-2', importing ? 'text-primary animate-bounce' : 'text-[var(--text-muted)]')} />
              <span className="text-sm font-medium text-[var(--text)]">
                {importing ? 'Import en cours...' : 'Cliquez pour sélectionner votre fichier Excel'}
              </span>
              <span className="text-xs text-[var(--text-muted)] mt-1">.xlsx uniquement</span>
              <input type="file" accept=".xlsx,.xls" className="hidden" onChange={importerExcel} disabled={importing} />
            </label>

            {importResult && (
              <div className={clsx('mt-4 p-4 rounded-xl text-sm transition-colors',
                importResult.success
                  ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
                  : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800')}>
                {importResult.success ? (
                  <>
                    <p className="font-semibold text-green-700 dark:text-green-400 mb-2">✅ Import terminé</p>
                    {Object.entries(importResult.results ?? {}).map(([yr, res]: any) => (
                      <div key={yr} className="text-green-600 dark:text-green-400">
                        <span className="font-medium">{yr}</span> :
                        <span className="ml-1">{res.imported} ligne(s) importée(s)</span>
                        {res.skipped > 0 && <span className="ml-1 text-green-500 dark:text-green-500">, {res.skipped} ignorée(s)</span>}
                        {res.errors?.length > 0 && <span className="ml-1 text-amber-500">, {res.errors.length} erreur(s)</span>}
                      </div>
                    ))}
                  </>
                ) : (
                  <p className="text-red-600 dark:text-red-400">❌ Erreur : {importResult.error}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
