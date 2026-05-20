'use client';

import { useEffect, useState, useCallback } from 'react';
import { Plus, Trash2, Search } from 'lucide-react';
import { formatFCFA } from '@/types';
import { clsx } from 'clsx';
import { useMois } from '../layout';

export default function DecaissementsPage() {
  const { annee } = useMois();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({
    description: '', dateOperation: new Date().toISOString().split('T')[0],
    montantTotal: '', repartitions: {} as Record<string, string>, notes: '',
  });

  const charger = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/decaissements?annee=${annee}`);
    if (res.ok) setData(await res.json());
    setLoading(false);
  }, [annee]);

  useEffect(() => { charger(); }, [charger]);

  const handleRep = (id: string, val: string) =>
    setForm(f => ({ ...f, repartitions: { ...f.repartitions, [id]: val } }));

  const totalRep = Object.values(form.repartitions).reduce((s, v) => s + (parseInt(v)||0), 0);

  const sauvegarder = async () => {
    if (!form.description || !form.montantTotal) return;
    setSaving(true);
    await fetch('/api/decaissements', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, anneeId: data?.anneeId, montantTotal: parseInt(form.montantTotal) }),
    });
    setForm({ description: '', dateOperation: new Date().toISOString().split('T')[0], montantTotal: '', repartitions: {}, notes: '' });
    setFormOpen(false); setSaving(false); charger();
  };

  const supprimer = async (id: string) => {
    if (!confirm('Supprimer ?')) return;
    await fetch(`/api/decaissements?id=${id}`, { method: 'DELETE' });
    charger();
  };

  const filtered = (data?.decaissements ?? []).filter((d: any) =>
    !search || d.description.toLowerCase().includes(search.toLowerCase())
  );
  const comptes = data?.comptes ?? [];
  const totauxComptes = comptes.map((c: any) => ({
    ...c, total: (data?.decaissements ?? []).reduce((s: number, d: any) => {
      const r = d.repartitions?.find((r: any) => r.compteId === c.id);
      return s + (r ? Number(r.montant) : 0);
    }, 0),
  }));
  const totalGeneral = filtered.reduce((s: number, d: any) => s + Number(d.montantTotal), 0);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="spinner scale-150" /></div>;

  return (
    <div className="space-y-5 animate-fadeIn">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text)]">Journal des décaissements</h1>
          <p className="text-[var(--text-muted)] text-sm">{annee} — {filtered.length} transaction(s)</p>
        </div>
        <button onClick={() => setFormOpen(!formOpen)}
          className="flex items-center gap-2 bg-primary hover:bg-primary-dark text-white rounded-xl px-4 py-2.5 text-sm font-medium transition-all">
          <Plus size={16} />Nouveau décaissement
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {totauxComptes.map((c: any) => (
          <div key={c.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3 text-center transition-colors">
            <p className="text-xs text-[var(--text-muted)] font-medium truncate">{c.nom}</p>
            <p className="text-sm font-bold text-primary mt-1">{formatFCFA(c.total)}</p>
          </div>
        ))}
        <div className="bg-primary/5 dark:bg-primary/10 border border-primary/20 rounded-xl p-3 text-center">
          <p className="text-xs text-primary font-medium">TOTAL</p>
          <p className="text-sm font-bold text-primary mt-1">{formatFCFA(totalGeneral)}</p>
        </div>
      </div>

      {formOpen && (
        <div className="bg-[var(--surface)] border border-primary/30 rounded-2xl p-5 shadow-sm space-y-4 transition-colors">
          <h3 className="font-semibold text-[var(--text)]">Nouveau décaissement</h3>
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-[var(--text-muted)] mb-1 block">Description *</label>
              <input type="text" value={form.description} onChange={e => setForm(f=>({...f,description:e.target.value}))}
                placeholder="Ex: Facture électricité"
                className="w-full border border-[var(--border)] bg-[var(--card)] text-[var(--text)] rounded-xl px-3 py-2 text-sm focus:border-primary outline-none transition-all" />
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] mb-1 block">Date *</label>
              <input type="date" value={form.dateOperation} onChange={e => setForm(f=>({...f,dateOperation:e.target.value}))}
                className="w-full border border-[var(--border)] bg-[var(--card)] text-[var(--text)] rounded-xl px-3 py-2 text-sm focus:border-primary outline-none" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)] mb-1 block">Montant total (FCFA) *</label>
            <input type="number" value={form.montantTotal} onChange={e => setForm(f=>({...f,montantTotal:e.target.value}))}
              placeholder="0"
              className="w-48 border border-[var(--border)] bg-[var(--card)] text-[var(--text)] rounded-xl px-3 py-2 text-sm focus:border-primary outline-none" />
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)] mb-2 block">
              Répartition
              {form.montantTotal && <span className={clsx('ml-2 font-semibold', totalRep===parseInt(form.montantTotal)?'text-green-600':'text-amber-500')}>
                ({formatFCFA(totalRep)} / {formatFCFA(parseInt(form.montantTotal)||0)})
              </span>}
            </label>
            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2.5">
              {comptes.map((c: any) => (
                <div key={c.id} className="flex items-center gap-2">
                  <span className="text-sm text-[var(--text)] flex-1 truncate">{c.nom}</span>
                  <input type="number" value={form.repartitions[c.id]??''} onChange={e=>handleRep(c.id,e.target.value)} placeholder="0"
                    className="w-28 border border-[var(--border)] bg-[var(--card)] text-[var(--text)] rounded-lg px-2 py-1.5 text-sm text-right focus:border-primary outline-none" />
                </div>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={sauvegarder} disabled={saving||!form.description||!form.montantTotal}
              className="bg-primary hover:bg-primary-dark text-white rounded-xl px-5 py-2 text-sm font-medium transition-all disabled:opacity-50">
              {saving?'Enregistrement...':'Enregistrer'}
            </button>
            <button onClick={()=>setFormOpen(false)}
              className="border border-[var(--border)] text-[var(--text-muted)] hover:bg-slate-50 dark:hover:bg-dark-card rounded-xl px-5 py-2 text-sm font-medium transition-all">
              Annuler
            </button>
          </div>
        </div>
      )}

      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
        <input type="text" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Rechercher une transaction..."
          className="w-full border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] rounded-xl pl-9 pr-4 py-2.5 text-sm focus:border-primary outline-none" />
      </div>

      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] overflow-hidden transition-colors">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 dark:bg-dark-card border-b border-[var(--border)]">
                <th className="text-left px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase">Date</th>
                <th className="text-left px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase">Description</th>
                <th className="text-right px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase">Montant</th>
                <th className="text-left px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase">Répartition</th>
                <th className="px-4 py-3 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-12 text-[var(--text-muted)]">
                  {search?'Aucun résultat':'Aucun décaissement enregistré'}
                </td></tr>
              ) : filtered.map((d: any) => (
                <tr key={d.id} className="border-t border-[var(--border)] hover:bg-slate-50/60 dark:hover:bg-dark-card/60 transition-colors">
                  <td className="px-4 py-3 text-[var(--text-muted)] whitespace-nowrap">{new Date(d.dateOperation).toLocaleDateString('fr-FR')}</td>
                  <td className="px-4 py-3 text-[var(--text)] font-medium">{d.description}</td>
                  <td className="px-4 py-3 text-right font-semibold text-[var(--text)]">{formatFCFA(Number(d.montantTotal))}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {d.repartitions?.filter((r: any)=>Number(r.montant)>0).map((r: any)=>(
                        <span key={r.id} className="bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs rounded-full px-2 py-0.5">
                          {r.compte?.nom} : {formatFCFA(Number(r.montant))}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={()=>supprimer(d.id)} className="text-slate-300 hover:text-red-500 transition-colors"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
