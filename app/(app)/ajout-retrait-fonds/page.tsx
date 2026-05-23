'use client';

import { useEffect, useState, useCallback } from 'react';
import { Save, ArrowUpCircle, ArrowDownCircle, Trash2, Building2 } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { formatFCFA } from '@/types';
import { clsx } from 'clsx';

const MOIS_COURTS = ['','Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];

type Mouvement = 'ajout' | 'retrait';

export default function AjoutRetraitFondsPage() {
  const toast = useToast();

  // ── Données ──────────────────────────────────────────────────────────────
  const [comptes,      setComptes]      = useState<any[]>([]);
  const [banques,      setBanques]      = useState<any[]>([]);
  const [historique,   setHistorique]   = useState<any[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [saving,       setSaving]       = useState(false);
  const [suppId,       setSuppId]       = useState<string|null>(null);

  // ── Formulaire ───────────────────────────────────────────────────────────
  const today = new Date().toISOString().split('T')[0];
  const [type,          setType]          = useState<Mouvement>('ajout');
  const [compteId,      setCompteId]      = useState('');
  const [montant,       setMontant]       = useState('');
  const [dateOp,        setDateOp]        = useState(today);
  const [note,          setNote]          = useState('');
  const [banqueId,      setBanqueId]      = useState('');
  const [impacterBanque,setImpacterBanque]= useState(false);

  // ── Chargement ───────────────────────────────────────────────────────────
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

  // ── Soumission ────────────────────────────────────────────────────────────
  const enregistrer = async () => {
    if (!compteId || !montant || !dateOp) {
      toast.error('Fond, montant et date sont obligatoires');
      return;
    }
    const montantVal = parseInt(montant);
    if (isNaN(montantVal) || montantVal <= 0) {
      toast.error('Montant invalide');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/decaissements', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description:   note || (type === 'ajout' ? 'Ajout fond' : 'Retrait fond'),
          dateOperation: dateOp,
          montantTotal:  montantVal,
          typeMouvement: type,
          notes:         note || null,
          // Fond ciblé (pour mise à jour soldeActuel)
          compteId,
          // Banque (optionnel, pour mise à jour solde bancaire)
          banqueId:      impacterBanque && banqueId ? banqueId : null,
          impacterBanque: impacterBanque && !!banqueId,
          // Répartition = le fond entier
          repartitions:  { [compteId]: String(montantVal) },
        }),
      });

      if (res.ok) {
        toast.success(type === 'ajout' ? 'Ajout enregistré ✓' : 'Retrait enregistré ✓');
        // Reset form (garder type et compteId)
        setMontant('');
        setNote('');
        setDateOp(today);
        await charger();
      } else {
        const err = await res.json();
        toast.error(err.error ?? 'Erreur lors de l\'enregistrement');
      }
    } catch (e) {
      toast.error('Erreur réseau');
    }
    setSaving(false);
  };

  // ── Suppression ───────────────────────────────────────────────────────────
  const supprimer = async (id: string) => {
    if (!confirm('Supprimer ce mouvement ? Le solde du fond sera recalculé.')) return;
    setSuppId(id);
    try {
      const res = await fetch(`/api/decaissements?id=${id}`, { method: 'DELETE' });
      if (res.ok) { toast.success('Mouvement supprimé'); await charger(); }
      else toast.error('Erreur lors de la suppression');
    } catch { toast.error('Erreur réseau'); }
    setSuppId(null);
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  const fondSelectionne = comptes.find(c => c.id === compteId);
  const banqueSelectionnee = banques.find(b => b.id === banqueId);

  const formatDate = (d: string | Date) => {
    const dt = new Date(d);
    return `${String(dt.getDate()).padStart(2,'0')}/${MOIS_COURTS[dt.getMonth()+1]}/${dt.getFullYear()}`;
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64"><div className="spinner scale-150" /></div>
  );

  return (
    <div className="space-y-6 animate-fadeIn max-w-3xl mx-auto">

      {/* ── En-tête ── */}
      <div>
        <h1 className="text-2xl font-bold text-[var(--text)]">Ajout / Retrait — Fonds</h1>
        <p className="text-[var(--text-muted)] text-sm">Gérez les mouvements sur vos fonds de fonctionnement</p>
      </div>

      {/* ── Soldes actuels ── */}
      {comptes.filter(c => c.isActive).length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {comptes.filter(c => c.isActive).map((c: any) => (
            <div key={c.id}
              onClick={() => setCompteId(c.id)}
              className={clsx(
                'rounded-2xl border p-3.5 cursor-pointer transition-all',
                compteId === c.id
                  ? 'border-primary bg-primary/5 shadow-sm ring-1 ring-primary/20'
                  : 'border-[var(--border)] bg-[var(--surface)] hover:border-primary/40'
              )}>
              <p className="text-xs font-medium text-[var(--text-muted)] truncate mb-1">{c.nom}</p>
              <p className={clsx('text-base font-bold', compteId === c.id ? 'text-primary' : 'text-[var(--text)]')}>
                {formatFCFA(c.soldeActuel ?? 0)}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* ── Formulaire ── */}
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5 space-y-5 transition-colors">
        <h2 className="font-semibold text-[var(--text)]">Nouveau mouvement</h2>

        {/* Type Ajout / Retrait */}
        <div className="flex gap-2">
          <button
            onClick={() => setType('ajout')}
            className={clsx('flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border-2 font-semibold text-sm transition-all',
              type === 'ajout'
                ? 'border-green-500 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                : 'border-[var(--border)] text-[var(--text-muted)] hover:border-green-300')}>
            <ArrowUpCircle size={18} />Ajout
          </button>
          <button
            onClick={() => setType('retrait')}
            className={clsx('flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border-2 font-semibold text-sm transition-all',
              type === 'retrait'
                ? 'border-red-500 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
                : 'border-[var(--border)] text-[var(--text-muted)] hover:border-red-300')}>
            <ArrowDownCircle size={18} />Retrait
          </button>
        </div>

        {/* Fond cible */}
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

        {/* Montant + Date */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Montant * (FCFA)</label>
            <input type="number" value={montant} onChange={e => setMontant(e.target.value)}
              placeholder="Ex: 25 000" min="0"
              className="w-full border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none" />
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Date *</label>
            <input type="date" value={dateOp} onChange={e => setDateOp(e.target.value)}
              className="w-full border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none" />
          </div>
        </div>

        {/* Note */}
        <div>
          <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Note (optionnel)</label>
          <input type="text" value={note} onChange={e => setNote(e.target.value)}
            placeholder="Ex: Cotisation septembre, Urgence médicale..."
            className="w-full border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none" />
        </div>

        {/* Impact bancaire (optionnel) */}
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
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Banque concernée</label>
              <select value={banqueId} onChange={e => setBanqueId(e.target.value)}
                className="w-full border border-[var(--border)] rounded-xl px-3 py-2 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none">
                <option value="">— Choisir une banque —</option>
                {banques.map((b: any) => (
                  <option key={b.id} value={b.id}>{b.nomBanque} ({formatFCFA(b.solde ?? 0)})</option>
                ))}
              </select>
              {/* Explication du flux */}
              {banqueId && montant && parseInt(montant) > 0 && (
                <div className={clsx('mt-2 rounded-lg p-2.5 text-xs',
                  type === 'ajout'
                    ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                    : 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400')}>
                  {type === 'ajout' ? (
                    <>
                      <span className="font-semibold">Flux :</span> {banqueSelectionnee?.nomBanque ?? 'Banque'}{' '}
                      <span className="font-bold">−{formatFCFA(parseInt(montant))}</span>
                      {' → '}{fondSelectionne?.nom ?? 'Fond'}{' '}
                      <span className="font-bold">+{formatFCFA(parseInt(montant))}</span>
                    </>
                  ) : (
                    <>
                      <span className="font-semibold">Flux :</span> {fondSelectionne?.nom ?? 'Fond'}{' '}
                      <span className="font-bold">−{formatFCFA(parseInt(montant))}</span>
                      {' → '}{banqueSelectionnee?.nomBanque ?? 'Banque'}{' '}
                      <span className="font-bold">+{formatFCFA(parseInt(montant))}</span>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bouton enregistrer */}
        <button onClick={enregistrer} disabled={saving || !compteId || !montant || !dateOp}
          className={clsx(
            'w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-60',
            type === 'ajout'
              ? 'bg-green-600 hover:bg-green-700 text-white'
              : 'bg-red-500 hover:bg-red-600 text-white'
          )}>
          <Save size={16} />
          {saving ? 'Enregistrement...' : type === 'ajout' ? 'Enregistrer l\'ajout' : 'Enregistrer le retrait'}
        </button>
      </div>

      {/* ── Historique ── */}
      <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] overflow-hidden transition-colors">
        <div className="px-5 py-3 border-b border-[var(--border)] bg-slate-50 dark:bg-dark-card">
          <h3 className="font-semibold text-[var(--text)]">Historique des mouvements</h3>
        </div>
        {historique.length === 0 ? (
          <div className="px-5 py-8 text-center text-[var(--text-muted)] text-sm">Aucun mouvement enregistré</div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {historique.map((d: any) => {
              const fondNom = d.repartitions?.[0]?.compte?.nom ?? '—';
              const banqueNom = d.repartitions?.find((r: any) => r.compte?.type === 'banque')?.compte?.nomBanque;
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
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                      {fondNom} · {formatDate(d.dateOperation)}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={clsx('text-sm font-bold',
                      isAjout ? 'text-green-600' : 'text-red-500')}>
                      {isAjout ? '+' : '−'}{formatFCFA(d.montantTotal)}
                    </p>
                  </div>
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
    </div>
  );
}
