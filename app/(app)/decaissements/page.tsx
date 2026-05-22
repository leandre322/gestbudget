'use client';

import { useEffect, useState, useCallback } from 'react';
import { Trash2, Search, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';
import { formatFCFA } from '@/types';
import { clsx } from 'clsx';
import { useMois } from '../layout';

const LIGNES_PAR_PAGE = 50;

// ── Formulaire SORTI du composant parent — Fix curseur (Demande 8) ──
type FormData = {
  description: string;
  dateOperation: string;
  montantTotal: string;
  repartitions: Record<string, string>;
  notes: string;
};

type FormulaireProps = {
  type: 'ajout' | 'retrait';
  form: FormData;
  setForm: React.Dispatch<React.SetStateAction<FormData>>;
  comptes: any[];
  banques: any[];
  saving: boolean;
  onSave: () => void;
};

function Formulaire({ type, form, setForm, comptes, banques, saving, onSave }: FormulaireProps) {
  const totalRep = Object.values(form.repartitions).reduce((s, v) => s + (parseInt(v) || 0), 0);

  const inputCls = "w-full border border-[var(--border)] bg-[var(--card)] text-[var(--text)] rounded-xl px-3 py-2 text-sm focus:border-primary outline-none transition-all";

  return (
    <div className={clsx(
      'bg-[var(--surface)] border rounded-2xl p-5 shadow-sm space-y-4 transition-colors',
      type === 'ajout' ? 'border-green-200 dark:border-green-800' : 'border-red-200 dark:border-red-800'
    )}>
      <div className="flex items-center gap-2">
        {type === 'ajout'
          ? <ArrowDownCircle size={18} className="text-green-500" />
          : <ArrowUpCircle  size={18} className="text-red-500" />
        }
        <h3 className={clsx('font-semibold',
          type === 'ajout' ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400')}>
          {type === 'ajout' ? 'Ajout de fonds' : 'Retrait de fonds'}
        </h3>
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <div className="sm:col-span-2">
          <label className="text-xs font-medium text-[var(--text-muted)] mb-1 block">Description *</label>
          <input
            type="text"
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            placeholder={type === 'ajout' ? 'Ex: Virement mensuel épargne' : 'Ex: Frais médicaux'}
            className={inputCls}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-[var(--text-muted)] mb-1 block">Date *</label>
          <input
            type="date"
            value={form.dateOperation}
            onChange={e => setForm(f => ({ ...f, dateOperation: e.target.value }))}
            className={inputCls}
          />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-[var(--text-muted)] mb-1 block">Montant total (FCFA) *</label>
        <input
          type="number"
          value={form.montantTotal}
          onChange={e => setForm(f => ({ ...f, montantTotal: e.target.value }))}
          placeholder="0"
          className="w-48 border border-[var(--border)] bg-[var(--card)] text-[var(--text)] rounded-xl px-3 py-2 text-sm focus:border-primary outline-none"
        />
      </div>

      {/* Répartition — Fonds + Banques */}
      <div>
        <label className="text-xs font-medium text-[var(--text-muted)] mb-2 block">
          Répartition par fond / banque
          {form.montantTotal && (
            <span className={clsx('ml-2 font-semibold',
              totalRep === parseInt(form.montantTotal) ? 'text-green-600' : 'text-amber-500')}>
              ({formatFCFA(totalRep)} / {formatFCFA(parseInt(form.montantTotal) || 0)})
            </span>
          )}
        </label>

        {/* Fonds de roulement */}
        {comptes.length > 0 && (
          <div className="mb-3">
            <p className="text-xs text-[var(--text-muted)] font-medium mb-2 uppercase tracking-wide">
              💼 Fonds de fonctionnement
            </p>
            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2.5">
              {comptes.map((c: any) => (
                <div key={c.id} className="flex items-center gap-2">
                  <span className="text-sm text-[var(--text)] flex-1 truncate">{c.nom}</span>
                  <input
                    type="number"
                    value={form.repartitions[c.id] ?? ''}
                    onChange={e => setForm(f => ({
                      ...f, repartitions: { ...f.repartitions, [c.id]: e.target.value },
                    }))}
                    placeholder="0"
                    className="w-28 border border-[var(--border)] bg-[var(--card)] text-[var(--text)] rounded-lg px-2 py-1.5 text-sm text-right focus:border-primary outline-none"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Banques */}
        {banques.length > 0 && (
          <div>
            <p className="text-xs text-[var(--text-muted)] font-medium mb-2 uppercase tracking-wide">
              🏦 Comptes bancaires
            </p>
            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2.5">
              {banques.map((b: any) => (
                <div key={b.id} className="flex items-center gap-2">
                  <span className="text-sm text-[var(--text)] flex-1 truncate">{b.nomBanque}</span>
                  <input
                    type="number"
                    value={form.repartitions[`banque_${b.id}`] ?? ''}
                    onChange={e => setForm(f => ({
                      ...f, repartitions: { ...f.repartitions, [`banque_${b.id}`]: e.target.value },
                    }))}
                    placeholder="0"
                    className="w-28 border border-[var(--border)] bg-[var(--card)] text-[var(--text)] rounded-lg px-2 py-1.5 text-sm text-right focus:border-primary outline-none"
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div>
        <label className="text-xs font-medium text-[var(--text-muted)] mb-1 block">Notes (optionnel)</label>
        <input
          type="text"
          value={form.notes}
          onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          placeholder="Remarques..."
          className={inputCls}
        />
      </div>

      <button
        onClick={onSave}
        disabled={saving || !form.description || !form.montantTotal}
        className={clsx(
          'px-5 py-2 rounded-xl text-sm font-medium text-white transition-all disabled:opacity-50',
          type === 'ajout' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-500 hover:bg-red-600'
        )}>
        {saving ? 'Enregistrement...' : type === 'ajout' ? '✅ Valider l\'ajout' : '✅ Valider le retrait'}
      </button>
    </div>
  );
}

// ── Page principale ──
export default function DecaissementsPage() {
  const { annee } = useMois();
  const [data,        setData]        = useState<any>(null);
  const [banques,     setBanques]     = useState<any[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [search,      setSearch]      = useState('');
  const [page,        setPage]        = useState(1);
  const [onglet,      setOnglet]      = useState<'ajout'|'retrait'|'historique'>('ajout');

  const resetForm = (): FormData => ({
    description: '',
    dateOperation: new Date().toISOString().split('T')[0],
    montantTotal: '',
    repartitions: {},
    notes: '',
  });

  const [formAjout,   setFormAjout]   = useState<FormData>(resetForm());
  const [formRetrait, setFormRetrait] = useState<FormData>(resetForm());

  const charger = useCallback(async () => {
    setLoading(true);
    const [resD, resB] = await Promise.all([
      fetch(`/api/decaissements?annee=${annee}`),
      fetch('/api/banques'),
    ]);
    if (resD.ok) setData(await resD.json());
    if (resB.ok) {
      const db = await resB.json();
      setBanques(db.banques ?? []);
    }
    setLoading(false);
  }, [annee]);

  useEffect(() => { charger(); }, [charger]);

  const comptes = data?.comptes ?? [];

  // ── Sauvegarder + impact soldes banques ──
  const sauvegarder = async (type: 'ajout' | 'retrait') => {
    const form = type === 'ajout' ? formAjout : formRetrait;
    if (!form.description || !form.montantTotal) return;
    setSaving(true);

    // Séparer répartitions fonds vs banques
    const repartitionsFonds: Record<string, string> = {};
    const repartitionsBanques: Record<string, { banqueId: string; montant: number }> = {};

    for (const [key, val] of Object.entries(form.repartitions)) {
      const montant = parseInt(val) || 0;
      if (montant <= 0) continue;
      if (key.startsWith('banque_')) {
        const banqueId = key.replace('banque_', '');
        repartitionsBanques[banqueId] = { banqueId, montant };
      } else {
        repartitionsFonds[key] = val;
      }
    }

    // Sauvegarder le décaissement (fonds seulement)
    await fetch('/api/decaissements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        repartitions: repartitionsFonds,
        anneeId: data?.anneeId,
        montantTotal: parseInt(form.montantTotal),
        typeMouvement: type,
      }),
    });

    // Mettre à jour les soldes bancaires
    for (const { banqueId, montant } of Object.values(repartitionsBanques)) {
      await fetch(`/api/banques?id=${banqueId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: type === 'ajout' ? 'increment' : 'decrement',
          montant,
        }),
      });
    }

    // Reset formulaire
    if (type === 'ajout') setFormAjout(resetForm());
    else setFormRetrait(resetForm());

    setSaving(false);
    charger();
  };

  const supprimer = async (id: string) => {
    if (!confirm('Supprimer cette opération ?')) return;
    await fetch(`/api/decaissements?id=${id}`, { method: 'DELETE' });
    charger();
  };

  // ── Historique ──
  const tousMovements = data?.decaissements ?? [];
  const filtered = tousMovements
    .filter((d: any) => !search || d.description.toLowerCase().includes(search.toLowerCase()))
    .sort((a: any, b: any) => new Date(b.dateOperation).getTime() - new Date(a.dateOperation).getTime());

  const totalPages = Math.ceil(filtered.length / LIGNES_PAR_PAGE);
  const paginated  = filtered.slice((page - 1) * LIGNES_PAR_PAGE, page * LIGNES_PAR_PAGE);

  const totalAjouts   = tousMovements.filter((d: any) => d.typeMouvement === 'ajout').reduce((s: number, d: any) => s + Number(d.montantTotal), 0);
  const totalRetraits = tousMovements.filter((d: any) => d.typeMouvement !== 'ajout').reduce((s: number, d: any) => s + Number(d.montantTotal), 0);
  const soldeNet      = totalAjouts - totalRetraits;

  // ── Totaux par compte ──
  const totauxComptes = comptes.map((c: any) => ({
    ...c,
    totalAjout:   tousMovements.filter((d: any) => d.typeMouvement === 'ajout').reduce((s: number, d: any) => { const r = d.repartitions?.find((r: any) => r.compteId === c.id); return s + (r ? Number(r.montant) : 0); }, 0),
    totalRetrait: tousMovements.filter((d: any) => d.typeMouvement !== 'ajout').reduce((s: number, d: any) => { const r = d.repartitions?.find((r: any) => r.compteId === c.id); return s + (r ? Number(r.montant) : 0); }, 0),
  }));

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="spinner scale-150" />
    </div>
  );

  return (
    <div className="space-y-5 animate-fadeIn">

      {/* En-tête */}
      <div>
        <h1 className="text-2xl font-bold text-[var(--text)]">Ajout / Retrait Fonds</h1>
        <p className="text-[var(--text-muted)] text-sm">{annee} — {tousMovements.length} opération(s)</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-2xl p-4 text-center">
          <p className="text-xs text-green-600 dark:text-green-400 font-medium">Total Ajouts</p>
          <p className="text-lg font-bold text-green-700 dark:text-green-400 mt-1">{formatFCFA(totalAjouts)}</p>
        </div>
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-4 text-center">
          <p className="text-xs text-red-600 dark:text-red-400 font-medium">Total Retraits</p>
          <p className="text-lg font-bold text-red-700 dark:text-red-400 mt-1">{formatFCFA(totalRetraits)}</p>
        </div>
        <div className={clsx('rounded-2xl p-4 text-center border',
          soldeNet >= 0
            ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
            : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800')}>
          <p className={clsx('text-xs font-medium', soldeNet >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-red-600 dark:text-red-400')}>
            Solde net
          </p>
          <p className={clsx('text-lg font-bold mt-1', soldeNet >= 0 ? 'text-blue-700 dark:text-blue-400' : 'text-red-700 dark:text-red-400')}>
            {formatFCFA(soldeNet)}
          </p>
        </div>
      </div>

      {/* Onglets */}
      <div className="flex gap-1 bg-slate-100 dark:bg-dark-card rounded-xl p-1 w-fit border border-[var(--border)]">
        {([
          ['ajout',      '➕ Ajout',      'text-green-600'],
          ['retrait',    '➖ Retrait',    'text-red-500'  ],
          ['historique', '📋 Historique', 'text-blue-600' ],
        ] as const).map(([key, label, color]) => (
          <button key={key} onClick={() => setOnglet(key)}
            className={clsx('px-4 py-2 rounded-lg text-sm font-medium transition-all',
              onglet === key
                ? 'bg-[var(--surface)] shadow-sm ' + color
                : 'text-[var(--text-muted)] hover:text-[var(--text)]')}>
            {label}
          </button>
        ))}
      </div>

      {/* Formulaires */}
      {onglet === 'ajout' && (
        <Formulaire
          type="ajout"
          form={formAjout}
          setForm={setFormAjout}
          comptes={comptes}
          banques={banques}
          saving={saving}
          onSave={() => sauvegarder('ajout')}
        />
      )}
      {onglet === 'retrait' && (
        <Formulaire
          type="retrait"
          form={formRetrait}
          setForm={setFormRetrait}
          comptes={comptes}
          banques={banques}
          saving={saving}
          onSave={() => sauvegarder('retrait')}
        />
      )}

      {/* Historique */}
      {onglet === 'historique' && (
        <div className="space-y-4">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input type="text" value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Rechercher une opération..."
              className="w-full border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] rounded-xl pl-9 pr-4 py-2.5 text-sm focus:border-primary outline-none" />
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            {filtered.length} opération(s) — Page {page} / {Math.max(1, totalPages)}
          </p>
          <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] overflow-hidden transition-colors">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-dark-card border-b border-[var(--border)]">
                    <th className="text-left px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase">Type</th>
                    <th className="text-left px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase">Date</th>
                    <th className="text-left px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase">Description</th>
                    <th className="text-right px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase">Montant</th>
                    <th className="text-left px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase">Répartition</th>
                    <th className="px-4 py-3 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-12 text-[var(--text-muted)]">
                      {search ? 'Aucun résultat' : 'Aucune opération enregistrée'}
                    </td></tr>
                  ) : paginated.map((d: any) => {
                    const isAjout = d.typeMouvement === 'ajout';
                    return (
                      <tr key={d.id} className="border-t border-[var(--border)] hover:bg-slate-50/60 dark:hover:bg-dark-card/60 transition-colors">
                        <td className="px-4 py-3">
                          <span className={clsx('inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full',
                            isAjout ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                                    : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400')}>
                            {isAjout ? '➕' : '➖'} {isAjout ? 'Ajout' : 'Retrait'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-[var(--text-muted)] whitespace-nowrap">
                          {new Date(d.dateOperation).toLocaleDateString('fr-FR')}
                        </td>
                        <td className="px-4 py-3 text-[var(--text)] font-medium">{d.description}</td>
                        <td className={clsx('px-4 py-3 text-right font-semibold',
                          isAjout ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400')}>
                          {isAjout ? '+' : '-'}{formatFCFA(Number(d.montantTotal))}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {d.repartitions?.filter((r: any) => Number(r.montant) > 0).map((r: any) => (
                              <span key={r.id} className="bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs rounded-full px-2 py-0.5">
                                {r.compte?.nom} : {formatFCFA(Number(r.montant))}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => supprimer(d.id)} className="text-slate-300 hover:text-red-500 transition-colors">
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-sm text-[var(--text-muted)] hover:bg-slate-50 dark:hover:bg-dark-card disabled:opacity-40 transition-all">
                ← Précédent
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                <button key={p} onClick={() => setPage(p)}
                  className={clsx('w-8 h-8 rounded-lg text-sm font-medium transition-all',
                    p === page ? 'bg-primary text-white' : 'border border-[var(--border)] text-[var(--text-muted)] hover:bg-slate-50 dark:hover:bg-dark-card')}>
                  {p}
                </button>
              ))}
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-sm text-[var(--text-muted)] hover:bg-slate-50 dark:hover:bg-dark-card disabled:opacity-40 transition-all">
                Suivant →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}