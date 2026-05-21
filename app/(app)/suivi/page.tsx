'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Copy, Save, ChevronsDownUp, ChevronsUpDown, Plus, Trash2, Pencil } from 'lucide-react';
import CollapsibleGroup, { useCollapseAll } from '@/components/CollapsibleGroup';
import BandeauMoisAnterieur from '@/components/BandeauMoisAnterieur';
import ModalKPI from '@/components/ModalKPI';
import { useMois } from '../layout';
import { formatFCFA, MOIS_LABELS, ORDRE_TYPES, TYPE_LABELS, LABEL_PREVISION, LABEL_REEL, LABEL_ECART, LABEL_EXEC } from '@/types';
import { clsx } from 'clsx';

type Lignes = Record<string, { anticipe: string; reel: string }>;
type LigneBanque = { id: string; banqueId: string; anticipe: number; reel: string };

const TYPES_OUVERTS_PAR_DEFAUT = ['revenu', 'epargne_precaution'];

export default function SuiviPage() {
  const { mois, annee, setMois, setAnnee } = useMois();
  const [data,         setData]         = useState<any>(null);
  const [lignes,       setLignes]       = useState<Lignes>({});
  const [banques,      setBanques]      = useState<any[]>([]);
  const [lignesBanque, setLignesBanque] = useState<LigneBanque[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [saving,       setSaving]       = useState(false);
  const [saved,        setSaved]        = useState(false);
  const [copying,      setCopying]      = useState(false);
  const [modalOpen,    setModalOpen]    = useState(false);
  const [modalType,    setModalType]    = useState<string>('');
  const timerRef = useRef<NodeJS.Timeout>();

  const moisCourantReel     = new Date().getMonth() + 1;
  const anneeCouranteReelle = new Date().getFullYear();

  const groupIds = ORDRE_TYPES.map(t => `suivi-${t}`);
  const { expandAll, collapseAll } = useCollapseAll(groupIds);

  const charger = useCallback(async () => {
    setLoading(true);
    const [resBudget, resBanques] = await Promise.all([
      fetch(`/api/budget?annee=${annee}&mois=${mois}`),
      fetch('/api/banques'),
    ]);
    if (!resBudget.ok) { setLoading(false); return; }
    const d = await resBudget.json();
    setData(d);
    const init: Lignes = {};
    for (const cat of d.categories) {
      const b = d.budget.find((b: any) => b.categorieId === cat.id);
      init[cat.id] = {
        anticipe: b?.montantAnticipe ? String(b.montantAnticipe) : '',
        reel:     b?.montantReel     ? String(b.montantReel)     : '',
      };
    }
    setLignes(init);
    if (resBanques.ok) {
      const db  = await resBanques.json();
      const bqs = db.banques ?? [];
      setBanques(bqs);
      const key = `lignes-banque-${annee}-${mois}`;
      try {
        const sv = localStorage.getItem(key);
        if (sv) {
          setLignesBanque(JSON.parse(sv));
        } else {
          const catsPrecaution  = d.categories.filter((c: any) => c.type === 'epargne_precaution');
          const totalAnticipe   = catsPrecaution.reduce((s: number, c: any) => {
            const b = d.budget.find((b: any) => b.categorieId === c.id);
            return s + (b?.montantAnticipe ?? 0);
          }, 0);
          const anticipeParLigne = bqs.length > 0 ? Math.round(totalAnticipe / Math.min(2, bqs.length)) : 0;
          setLignesBanque([
            { id: `lb-${Date.now()}-1`, banqueId: bqs[0]?.id ?? '', anticipe: anticipeParLigne, reel: '' },
            { id: `lb-${Date.now()}-2`, banqueId: bqs[1]?.id ?? '', anticipe: anticipeParLigne, reel: '' },
          ]);
        }
      } catch {
        setLignesBanque([{ id: `lb-${Date.now()}-1`, banqueId: bqs[0]?.id ?? '', anticipe: 0, reel: '' }]);
      }
    }
    setLoading(false);
  }, [mois, annee]);

  useEffect(() => { charger(); }, [charger]);

  useEffect(() => {
    if (lignesBanque.length > 0) {
      try { localStorage.setItem(`lignes-banque-${annee}-${mois}`, JSON.stringify(lignesBanque)); } catch {}
    }
  }, [lignesBanque, annee, mois]);

  const scheduleSave = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => sauvegarder(), 30000);
  };

  const handleChange = (catId: string, field: 'anticipe'|'reel', val: string) => {
    setLignes(prev => ({ ...prev, [catId]: { ...prev[catId], [field]: val } }));
    scheduleSave();
    setSaved(false);
  };

  const sauvegarder = async () => {
    if (!data?.anneeId) return;
    setSaving(true);
    (window as any).__setSaveStatus?.('saving');
    const res = await fetch('/api/budget', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ anneeId: data.anneeId, mois, lignes }),
    });
    for (const lb of lignesBanque) {
      const reelVal = parseInt(lb.reel) || 0;
      if (lb.banqueId && reelVal > 0) {
        const oldKey = `lignes-banque-saved-${annee}-${mois}-${lb.id}`;
        const oldVal = parseInt(localStorage.getItem(oldKey) ?? '0');
        const diff   = reelVal - oldVal;
        if (diff !== 0) {
          await fetch(`/api/banques?id=${lb.banqueId}`, {
            method:  'PUT',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ action: diff > 0 ? 'increment' : 'decrement', montant: Math.abs(diff) }),
          });
          localStorage.setItem(oldKey, String(reelVal));
        }
      }
    }
    setSaving(false);
    if (res.ok) {
      setSaved(true);
      (window as any).__setSaveStatus?.('saved');
      setTimeout(() => { setSaved(false); (window as any).__setSaveStatus?.('idle'); }, 3000);
    } else {
      (window as any).__setSaveStatus?.('error');
    }
  };

  const copierMoisPrecedent = async () => {
    const ok = window.confirm(
      `Copier les prévisions de ${MOIS_LABELS[mois===1?12:mois-1]} ${mois===1?annee-1:annee} vers ce mois ?\nCela remplacera les prévisions actuelles.`
    );
    if (!ok) return;
    setCopying(true);
    const pm  = mois === 1 ? 12 : mois - 1;
    const pa  = mois === 1 ? annee - 1 : annee;
    const res = await fetch(`/api/budget?annee=${pa}&mois=${pm}`);
    if (res.ok) {
      const prev = await res.json();
      const newL = { ...lignes };
      for (const b of (prev.budget ?? [])) {
        if (newL[b.categorieId] !== undefined) {
          newL[b.categorieId] = { ...newL[b.categorieId], anticipe: String(b.montantAnticipe) };
        }
      }
      setLignes(newL);
      scheduleSave();
    }
    setCopying(false);
  };

  const handleModalSave = async (vals: Record<string, { prevision: string; reel: string }>) => {
    const newLignes = { ...lignes };
    for (const [catId, val] of Object.entries(vals)) {
      newLignes[catId] = { anticipe: val.prevision, reel: val.reel };
    }
    setLignes(newLignes);
    if (!data?.anneeId) return;
    await fetch('/api/budget', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ anneeId: data.anneeId, mois, lignes: newLignes }),
    });
    charger();
  };

  const ajouterLigneBanque = () => {
    setLignesBanque(prev => [
      ...prev,
      { id: `lb-${Date.now()}`, banqueId: banques[0]?.id ?? '', anticipe: 0, reel: '' },
    ]);
  };

  const supprimerLigneBanque = (id: string) => {
    setLignesBanque(prev => prev.filter(l => l.id !== id));
  };

  const updateLigneBanque = (id: string, field: keyof LigneBanque, val: any) => {
    setLignesBanque(prev => prev.map(l => l.id === id ? { ...l, [field]: val } : l));
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="spinner scale-150" />
    </div>
  );

  const cats = data?.categories ?? [];

  const catsPrecaution = cats.filter((c: any) => c.type === 'epargne_precaution');
  const totalAnticipePrecaution = catsPrecaution.reduce((s: number, c: any) => {
    const b = data?.budget?.find((b: any) => b.categorieId === c.id);
    return s + (b?.montantAnticipe ?? 0);
  }, 0);
  const totalReelBanques = lignesBanque.reduce((s, l) => s + (parseInt(l.reel) || 0), 0);

  const grouped = ORDRE_TYPES.map(type => ({
    type, items: cats.filter((c: any) => c.type === type),
  })).filter(g => g.items.length > 0);

  const revAnt      = cats.filter((c: any) => c.type === 'revenu').reduce((s: number, c: any) => s + (parseInt(lignes[c.id]?.anticipe) || 0), 0);
  const revReel     = cats.filter((c: any) => c.type === 'revenu').reduce((s: number, c: any) => s + (parseInt(lignes[c.id]?.reel)     || 0), 0);
  const sortiesAnt  = cats.filter((c: any) => c.type !== 'revenu' && c.type !== 'epargne_precaution').reduce((s: number, c: any) => s + (parseInt(lignes[c.id]?.anticipe) || 0), 0) + totalAnticipePrecaution;
  const sortiesReel = cats.filter((c: any) => c.type !== 'revenu' && c.type !== 'epargne_precaution').reduce((s: number, c: any) => s + (parseInt(lignes[c.id]?.reel)     || 0), 0) + totalReelBanques;
  const soldeAnt    = revAnt  - sortiesAnt;
  const soldeReel   = revReel - sortiesReel;
  const tauxExec    = revAnt  > 0 ? (revReel / revAnt)  * 100 : 0;
  const epReel      = cats.filter((c: any) => c.type?.startsWith('epargne') && c.type !== 'epargne_precaution').reduce((s: number, c: any) => s + (parseInt(lignes[c.id]?.reel) || 0), 0) + totalReelBanques;
  const tauxEp      = revReel > 0 ? (epReel  / revReel) * 100 : 0;

  const modalCats = cats.filter((c: any) => c.type === modalType);

  return (
    <div className="space-y-5 animate-fadeIn">

      {/* Bandeau mois antérieur */}
      <BandeauMoisAnterieur
        mois={mois} annee={annee}
        onMoisCourant={() => { setMois(moisCourantReel); setAnnee(anneeCouranteReelle); }}
      />

      {/* Modal KPI */}
      <ModalKPI
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={handleModalSave}
        titre={TYPE_LABELS[modalType as keyof typeof TYPE_LABELS] ?? ''}
        categories={modalCats}
        lignes={lignes}
        mode="both"
      />

      {/* En-tête */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text)]">Suivi mensuel</h1>
          <p className="text-[var(--text-muted)] text-sm">{MOIS_LABELS[mois]} {annee}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={collapseAll}
            className="flex items-center gap-1.5 border border-[var(--border)] bg-[var(--surface)] hover:bg-slate-50 dark:hover:bg-dark-card text-[var(--text-muted)] rounded-xl px-3 py-2 text-xs font-medium transition-all">
            <ChevronsUpDown size={13} />Tout plier
          </button>
          <button onClick={expandAll}
            className="flex items-center gap-1.5 border border-[var(--border)] bg-[var(--surface)] hover:bg-slate-50 dark:hover:bg-dark-card text-[var(--text-muted)] rounded-xl px-3 py-2 text-xs font-medium transition-all">
            <ChevronsDownUp size={13} />Tout déplier
          </button>
          <button onClick={copierMoisPrecedent} disabled={copying}
            className="flex items-center gap-2 border border-[var(--border)] bg-[var(--surface)] hover:bg-slate-50 dark:hover:bg-dark-card text-[var(--text-muted)] rounded-xl px-3.5 py-2 text-sm font-medium transition-all disabled:opacity-60">
            <Copy size={14} />{copying ? 'Copie...' : 'Mois précédent'}
          </button>
          <button onClick={sauvegarder} disabled={saving}
            className="flex items-center gap-2 bg-primary hover:bg-primary-dark text-white rounded-xl px-3.5 py-2 text-sm font-medium transition-all disabled:opacity-60">
            <Save size={14} />{saving ? 'Sauvegarde...' : saved ? 'Sauvegardé ✓' : 'Sauvegarder'}
          </button>
        </div>
      </div>

      {/* KPIs — bouton fixe ✏️ */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Revenus',  val: revReel,               type: 'revenu',        cls: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400' },
          { label: 'Épargne',  val: epReel,                type: 'epargne_precaution', cls: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400' },
          { label: 'Dépenses', val: sortiesReel - epReel,  type: 'depense_fixe',  cls: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400' },
          { label: 'Solde',    val: soldeReel,             type: '',              cls: soldeReel >= 0 ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-600 dark:text-red-400' },
        ].map(k => (
          <div key={k.label} className={clsx('rounded-2xl border p-3.5 transition-colors', k.cls)}>
            <div className="flex items-start justify-between">
              <p className="text-xs font-medium opacity-60">{k.label}</p>
              {k.type && (
                <button
                  onClick={() => { setModalType(k.type); setModalOpen(true); }}
                  className="p-1 rounded-lg hover:bg-white/40 dark:hover:bg-black/20 transition-colors flex-shrink-0 -mt-0.5 -mr-0.5"
                  title="Modifier">
                  <Pencil size={11} className="opacity-60" />
                </button>
              )}
            </div>
            <p className="text-lg font-bold mt-0.5">{formatFCFA(k.val)}</p>
          </div>
        ))}
      </div>

      {/* KPIs analytiques */}
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 flex items-center gap-3 transition-colors">
          <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center">
            <span className="text-primary text-lg">📊</span>
          </div>
          <div>
            <p className="text-xs text-[var(--text-muted)]">Taux d'exécution</p>
            <p className="text-xl font-bold text-primary">{tauxExec.toFixed(1)} %</p>
          </div>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 flex items-center gap-3 transition-colors">
          <div className="w-10 h-10 rounded-xl bg-green-50 dark:bg-green-900/30 flex items-center justify-center">
            <span className="text-lg">🐷</span>
          </div>
          <div>
            <p className="text-xs text-[var(--text-muted)]">Taux d'épargne</p>
            <p className={clsx('text-xl font-bold', tauxEp >= 30 ? 'text-green-600' : tauxEp >= 15 ? 'text-amber-500' : 'text-red-500')}>
              {tauxEp.toFixed(1)} %
            </p>
            <p className="text-xs text-[var(--text-muted)]">Objectif : 30 %</p>
          </div>
        </div>
      </div>

      {/* Tableau centré */}
      <div className="max-w-5xl mx-auto w-full">
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] overflow-hidden transition-colors">

          {/* En-tête fixe */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-dark-card border-b border-[var(--border)]">
                  <th className="text-left px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase tracking-wide">Catégorie</th>
                  <th className="text-right px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase">{LABEL_PREVISION}</th>
                  <th className="text-right px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase">{LABEL_REEL}</th>
                  <th className="text-right px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase">{LABEL_ECART}</th>
                  <th className="text-right px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase">{LABEL_EXEC}</th>
                </tr>
              </thead>
            </table>
          </div>

          {/* Groupes */}
          {grouped.map(({ type, items }) => {
            const isRevenu       = type === 'revenu';
            const isEpPrecaution = type === 'epargne_precaution';
            let gAnt: number;
            let gReel: number;
            if (isEpPrecaution) {
              gAnt  = totalAnticipePrecaution;
              gReel = totalReelBanques;
            } else {
              gAnt  = items.reduce((s: number, c: any) => s + (parseInt(lignes[c.id]?.anticipe) || 0), 0);
              gReel = items.reduce((s: number, c: any) => s + (parseInt(lignes[c.id]?.reel)     || 0), 0);
            }
            const gEcar      = gReel - gAnt;
            const gPct       = gAnt > 0 ? (gReel / gAnt) * 100 : 0;
            const badge      = `${formatFCFA(gReel)} réel`;
            const badgeColor = gEcar > 0 && !isRevenu ? 'text-red-500' : 'text-green-600 dark:text-green-400';

            return (
              <CollapsibleGroup
                key={type}
                id={`suivi-${type}`}
                label={TYPE_LABELS[type as keyof typeof TYPE_LABELS]}
                badge={badge}
                badgeColor={badgeColor}
                defaultOpen={TYPES_OUVERTS_PAR_DEFAUT.includes(type)}
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <tbody>
                      {isEpPrecaution ? (
                        <>
                          {lignesBanque.map(lb => (
                            <tr key={lb.id} className="border-t border-[var(--border)] hover:bg-slate-50/60 dark:hover:bg-dark-card/60 transition-colors">
                              <td className="px-4 py-2.5">
                                <select
                                  value={lb.banqueId}
                                  onChange={e => updateLigneBanque(lb.id, 'banqueId', e.target.value)}
                                  className="border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none w-44">
                                  <option value="">— Choisir banque —</option>
                                  {banques.map((b: any) => (
                                    <option key={b.id} value={b.id}>{b.nomBanque}</option>
                                  ))}
                                </select>
                              </td>
                              <td className="px-4 py-2.5 text-right text-[var(--text-muted)] text-sm">
                                {lb.anticipe > 0 ? formatFCFA(lb.anticipe) : '—'}
                              </td>
                              <td className="px-3 py-2 text-right">
                                <input
                                  type="number"
                                  value={lb.reel}
                                  onChange={e => updateLigneBanque(lb.id, 'reel', e.target.value)}
                                  placeholder="0"
                                  className="w-32 text-right border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none" />
                              </td>
                              <td className="px-4 py-2.5 text-right text-sm text-[var(--text-muted)]">—</td>
                              <td className="px-4 py-2.5 text-right">
                                <button onClick={() => supprimerLigneBanque(lb.id)}
                                  className="text-slate-300 hover:text-red-500 transition-colors">
                                  <Trash2 size={13} />
                                </button>
                              </td>
                            </tr>
                          ))}
                          <tr className="border-t border-[var(--border)]">
                            <td colSpan={5} className="px-4 py-2">
                              <button onClick={ajouterLigneBanque}
                                className="flex items-center gap-1.5 text-xs text-primary hover:text-primary-dark font-medium transition-colors">
                                <Plus size={13} />Ajouter une banque
                              </button>
                            </td>
                          </tr>
                          <tr className="bg-slate-50 dark:bg-dark-card border-t border-[var(--border)]">
                            <td className="px-4 py-2 text-xs font-bold text-[var(--text-muted)] uppercase">Sous-total</td>
                            <td className="px-4 py-2 text-right text-xs font-bold text-[var(--text)]">{formatFCFA(totalAnticipePrecaution)}</td>
                            <td className="px-4 py-2 text-right text-xs font-bold text-[var(--text)]">{formatFCFA(totalReelBanques)}</td>
                            <td className="px-4 py-2 text-right text-xs font-bold text-green-500">
                              {(totalReelBanques - totalAnticipePrecaution) !== 0
                                ? ((totalReelBanques - totalAnticipePrecaution) > 0 ? '+' : '') + formatFCFA(totalReelBanques - totalAnticipePrecaution)
                                : '—'}
                            </td>
                            <td className="px-4 py-2 text-right text-xs text-[var(--text-muted)]">
                              {totalAnticipePrecaution > 0 ? ((totalReelBanques / totalAnticipePrecaution) * 100).toFixed(0) + ' %' : '—'}
                            </td>
                          </tr>
                        </>
                      ) : (
                        <>
                          {items.map((cat: any) => {
                            const ant  = parseInt(lignes[cat.id]?.anticipe) || 0;
                            const reel = parseInt(lignes[cat.id]?.reel)     || 0;
                            const ecar = reel - ant;
                            const pct  = ant > 0 ? (reel / ant) * 100 : 0;
                            const over = !isRevenu && ant > 0 && reel > ant;
                            const ecarColor = isRevenu
                              ? reel > ant ? 'text-green-500' : reel < ant ? 'text-red-500' : 'text-[var(--text-muted)]'
                              : ecar > 0   ? 'text-red-500'  : ecar < 0   ? 'text-green-500' : 'text-[var(--text-muted)]';
                            return (
                              <tr key={cat.id}
                                className={clsx('border-t border-[var(--border)] hover:bg-slate-50/60 dark:hover:bg-dark-card/60 transition-colors', over && 'bg-red-50/30 dark:bg-red-900/10')}>
                                <td className="px-4 py-2.5 text-[var(--text)]">
                                  <span className="flex items-center gap-1.5">
                                    {over && <span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />}
                                    {cat.nom}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-right">
                                  <input type="number" value={lignes[cat.id]?.anticipe ?? ''}
                                    onChange={e => handleChange(cat.id, 'anticipe', e.target.value)}
                                    placeholder="0"
                                    className="w-32 text-right border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none" />
                                </td>
                                <td className="px-3 py-2 text-right">
                                  <input type="number" value={lignes[cat.id]?.reel ?? ''}
                                    onChange={e => handleChange(cat.id, 'reel', e.target.value)}
                                    placeholder="0"
                                    className="w-32 text-right border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none" />
                                </td>
                                <td className={clsx('px-4 py-2.5 text-right text-sm font-medium', ecarColor)}>
                                  {ecar !== 0 ? (ecar > 0 ? '+' : '') + formatFCFA(ecar) : '—'}
                                </td>
                                <td className="px-4 py-2.5 text-right text-sm">
                                  {ant > 0 ? (
                                    <span className={clsx('font-semibold',
                                      pct > 110 ? 'text-red-500' : pct > 100 ? 'text-orange-500' : pct >= 80 ? 'text-amber-500' : 'text-green-500')}>
                                      {pct.toFixed(0)} %
                                    </span>
                                  ) : '—'}
                                </td>
                              </tr>
                            );
                          })}
                          <tr className="bg-slate-50 dark:bg-dark-card border-t border-[var(--border)]">
                            <td className="px-4 py-2 text-xs font-bold text-[var(--text-muted)] uppercase">Sous-total</td>
                            <td className="px-4 py-2 text-right text-xs font-bold text-[var(--text)]">{formatFCFA(gAnt)}</td>
                            <td className="px-4 py-2 text-right text-xs font-bold text-[var(--text)]">{formatFCFA(gReel)}</td>
                            <td className={clsx('px-4 py-2 text-right text-xs font-bold', gEcar > 0 && !isRevenu ? 'text-red-500' : 'text-green-500')}>
                              {gEcar !== 0 ? (gEcar > 0 ? '+' : '') + formatFCFA(gEcar) : '—'}
                            </td>
                            <td className="px-4 py-2 text-right text-xs text-[var(--text-muted)]">
                              {gAnt > 0 ? gPct.toFixed(0) + ' %' : '—'}
                            </td>
                          </tr>
                        </>
                      )}
                    </tbody>
                  </table>
                </div>
              </CollapsibleGroup>
            );
          })}

          {/* Totaux */}
          <div className="border-t-2 border-primary/30 bg-primary/5 dark:bg-primary/10">
            <div className="px-4 py-2.5 flex items-center justify-between border-b border-primary/10">
              <span className="font-semibold text-[var(--text)] text-sm">Total sorties (épargne + dépenses)</span>
              <div className="flex gap-8">
                <span className="font-semibold text-[var(--text)] text-sm">{formatFCFA(sortiesAnt)}</span>
                <span className="font-semibold text-[var(--text)] text-sm">{formatFCFA(sortiesReel)}</span>
              </div>
            </div>
            <div className="px-4 py-3 flex items-center justify-between">
              <span className="font-bold text-[var(--text)]">Solde disponible</span>
              <div className="flex gap-8">
                <span className={clsx('font-bold', soldeAnt >= 0 ? 'text-green-600' : 'text-red-500')}>
                  {formatFCFA(soldeAnt)}
                </span>
                <span className={clsx('font-bold text-lg', soldeReel >= 0 ? 'text-green-600' : 'text-red-500')}>
                  {formatFCFA(soldeReel)}
                </span>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}