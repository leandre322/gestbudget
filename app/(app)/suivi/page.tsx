'use client';

import { useEffect, useState, useCallback, useRef, Fragment } from 'react';
import { Copy, Save, ChevronsDownUp, ChevronsUpDown, Plus, Trash2, Pencil,
         ChevronDown, ChevronRight } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
         PieChart, Pie, Cell, Legend } from 'recharts';
import BandeauMoisAnterieur from '@/components/BandeauMoisAnterieur';
import ModalKPI from '@/components/ModalKPI';
import { useToast } from '@/components/Toast';
import { useMois } from '../layout';
import { formatFCFA, MOIS_LABELS, ORDRE_TYPES, TYPE_LABELS,
         LABEL_PREVISION, LABEL_REEL, LABEL_ECART, LABEL_EXEC } from '@/types';
import { clsx } from 'clsx';

// ── Bloquer les caractères non numériques ─────────────────────────────────────
const onlyNumbers = (e: React.KeyboardEvent<HTMLInputElement>) => {
  const allowed = ['Backspace','Delete','Tab','Escape','Enter','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'];
  if (allowed.includes(e.key) || e.ctrlKey || e.metaKey) return;
  if (!/^\d$/.test(e.key)) e.preventDefault();
};

type Lignes      = Record<string, { anticipe: string; reel: string }>;
type LigneBanque = { id: string; banqueId: string; anticipe: number; reel: string };

const TYPES_OUVERTS_PAR_DEFAUT = ['revenu', 'epargne_precaution'];
const MOIS_COURTS  = ['','Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
const DONUT_COLORS = ['#1E40AF','#EF4444','#F59E0B','#10B981','#8B5CF6','#06B6D4','#F97316'];

// ── Normalisation pour matching robuste ──────────────────────────────────────
// Gère : "Fête / Vacances" = "Fête / Vacances", accents, espaces autour des /
function normaliser(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // supprime les accents
    .replace(/\s*\/\s*/g, '/')                         // normalise espaces autour de /
    .replace(/\s+/g, ' ');                             // espaces multiples → un seul
}

// ── Correspondance catégorie → CompteFonds par nom (Option A) ────────────────
function trouverCompteParNom(catNom: string, comptes: any[]): any | null {
  if (!catNom || !comptes.length) return null;
  const cat = normaliser(catNom);
  // 1. Correspondance exacte normalisée
  let match = comptes.find(c => normaliser(c.nom) === cat);
  if (match) return match;
  // 2. Le nom du fond est contenu dans la catégorie
  match = comptes.find(c => cat.includes(normaliser(c.nom)));
  if (match) return match;
  // 3. La catégorie est contenue dans le nom du fond
  match = comptes.find(c => normaliser(c.nom).includes(cat));
  return match ?? null;
}

export default function SuiviPage() {
  const { mois, annee, setMois, setAnnee } = useMois();
  const toast = useToast();

  const [data,         setData]         = useState<any>(null);
  const [lignes,       setLignes]       = useState<Lignes>({});
  const [banques,      setBanques]      = useState<any[]>([]);
  const [comptes,      setComptes]      = useState<any[]>([]);
  const [lignesBanque, setLignesBanque] = useState<LigneBanque[]>([]);
  const [hist,         setHist]         = useState<any[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [saving,       setSaving]       = useState(false);
  const [saved,        setSaved]        = useState(false);
  const [copying,      setCopying]      = useState(false);
  const [modalOpen,    setModalOpen]    = useState(false);
  const [modalType,    setModalType]    = useState<string>('');
  const [showTotals,   setShowTotals]   = useState(() => {
    try { return localStorage.getItem('suivi-show-totals') === 'true'; } catch { return false; }
  });

  const [groupsOpen, setGroupsOpen] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    ORDRE_TYPES.forEach(t => { init[t] = TYPES_OUVERTS_PAR_DEFAUT.includes(t); });
    return init;
  });

  const toggleGroup       = (type: string) => setGroupsOpen(p => ({ ...p, [type]: !p[type] }));
  const expandAllGroups   = () => { const n: Record<string,boolean> = {}; ORDRE_TYPES.forEach(t => { n[t] = true;  }); setGroupsOpen(n); };
  const collapseAllGroups = () => { const n: Record<string,boolean> = {}; ORDRE_TYPES.forEach(t => { n[t] = false; }); setGroupsOpen(n); };

  const timerRef            = useRef<NodeJS.Timeout>();
  const moisCourantReel     = new Date().getMonth() + 1;
  const anneeCouranteReelle = new Date().getFullYear();

  const toggleTotals = () => {
    const next = !showTotals;
    setShowTotals(next);
    try { localStorage.setItem('suivi-show-totals', String(next)); } catch {}
  };

  // ── Chargement ──────────────────────────────────────────────────────────
  const charger = useCallback(async () => {
    setLoading(true);
    const [resBudget, resBanques, resComptes] = await Promise.all([
      fetch(`/api/budget?annee=${annee}&mois=${mois}`),
      fetch('/api/banques'),
      fetch('/api/comptes'),
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

    if (resComptes.ok) {
      const dc = await resComptes.json();
      setComptes(dc.comptes ?? []);
    }

    if (resBanques.ok) {
      const db  = await resBanques.json();
      const bqs = db.banques ?? [];
      setBanques(bqs);
      // ── Init lignesBanque + lignes[catPrec] depuis DB ───────────────────────
      const catsPrecaution   = d.categories.filter((c: any) => c.type === 'epargne_precaution');
      const totalAnticipe    = catsPrecaution.reduce((s: number, c: any) => {
        const b = d.budget.find((b: any) => b.categorieId === c.id);
        return s + (b?.montantAnticipe ?? 0);
      }, 0);
      const anticipeParLigne = bqs.length > 0 ? Math.round(totalAnticipe / Math.min(2, bqs.length)) : 0;

      // Récupérer les réels DB par catégorie précaution (source de vérité)
      const dbReelByCatId: Record<string, string> = {};
      catsPrecaution.forEach((cat: any) => {
        const bBudget = d.budget.find((b: any) => b.categorieId === cat.id);
        dbReelByCatId[cat.id] = String(bBudget?.montantReel || '');
      });

      try {
        const key = `lignes-banque-${annee}-${mois}`;
        const sv  = localStorage.getItem(key);
        let finalLignesBanque: LigneBanque[];

        if (sv) {
          const parsed: LigneBanque[] = JSON.parse(sv);
          // Merger : garder localStorage si > 0, sinon prendre DB
          finalLignesBanque = parsed.map((lb: LigneBanque, idx: number) => {
            const catPrec = catsPrecaution[idx];
            const dbReel  = catPrec ? (dbReelByCatId[catPrec.id] ?? '') : '';
            return { ...lb, reel: (lb.reel && parseInt(lb.reel) > 0) ? lb.reel : dbReel };
          });
        } else {
          // Construire depuis banques + valeurs DB
          finalLignesBanque = bqs.map((bq: any, idx: number) => {
            const catPrec = catsPrecaution[idx];
            return {
              id:        `lb-${Date.now()}-${idx + 1}`,
              banqueId:  bq.id ?? '',
              anticipe:  anticipeParLigne,
              reel:      catPrec ? (dbReelByCatId[catPrec.id] ?? '') : '',
            };
          });
          if (finalLignesBanque.length === 0) {
            finalLignesBanque = [{ id: `lb-${Date.now()}-1`, banqueId: bqs[0]?.id ?? '', anticipe: 0, reel: '' }];
          }
        }

        setLignesBanque(finalLignesBanque);

        // ── Sync lignes[catPrec] depuis finalLignesBanque (SÉPARÉ de setLignesBanque) ──
        setLignes(prev => {
          const synced = { ...prev };
          catsPrecaution.forEach((cat: any, idx: number) => {
            const lb = finalLignesBanque[idx];
            synced[cat.id] = {
              anticipe: prev[cat.id]?.anticipe ?? '0',
              reel:     lb ? (lb.reel || '0') : '0',
            };
          });
          return synced;
        });

      } catch {
        const fallback: LigneBanque[] = [
          { id: `lb-${Date.now()}-1`, banqueId: bqs[0]?.id ?? '', anticipe: anticipeParLigne, reel: catsPrecaution[0] ? (dbReelByCatId[catsPrecaution[0]?.id] ?? '') : '' },
          { id: `lb-${Date.now()}-2`, banqueId: bqs[1]?.id ?? '', anticipe: anticipeParLigne, reel: catsPrecaution[1] ? (dbReelByCatId[catsPrecaution[1]?.id] ?? '') : '' },
        ];
        setLignesBanque(fallback);
        setLignes(prev => {
          const synced = { ...prev };
          catsPrecaution.forEach((cat: any, idx: number) => {
            synced[cat.id] = { anticipe: prev[cat.id]?.anticipe ?? '0', reel: dbReelByCatId[cat.id] ?? '0' };
          });
          return synced;
        });
      }
    }

    // Historique 6 mois
    const histData = [];
    for (let i = 5; i >= 0; i--) {
      let m = mois - i, a = annee;
      if (m <= 0) { m += 12; a--; }
      try {
        const hr = await fetch(`/api/budget?annee=${a}&mois=${m}`);
        if (!hr.ok) { histData.push({ mois: MOIS_COURTS[m], prev: 0, reel: 0 }); continue; }
        const hd = await hr.json();
        histData.push({
          mois: MOIS_COURTS[m],
          prev: hd.budget?.filter((b: any) => b.categorie?.type?.startsWith('depense')).reduce((s: number, b: any) => s + (b.montantAnticipe ?? 0), 0) ?? 0,
          reel: hd.budget?.filter((b: any) => b.categorie?.type?.startsWith('depense')).reduce((s: number, b: any) => s + (b.montantReel ?? 0), 0) ?? 0,
        });
      } catch {
        histData.push({ mois: MOIS_COURTS[m], prev: 0, reel: 0 });
      }
    }
    setHist(histData);
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
    if (!data?.anneeId) {
      toast.error('Aucune année sélectionnée — rechargez la page');
      return;
    }
    setSaving(true);
    (window as any).__setSaveStatus?.('saving');

    // 1. Sauvegarder le budget
    // S'assurer que TOUTES les catégories actives sont dans lignes
    // (y compris epargne_investissement, depense_occasionnelle, etc.)
    const allCats = data?.categories ?? [];
    const lignesComplet = { ...lignes };
    for (const cat of allCats) {
      if (!lignesComplet[cat.id]) {
        lignesComplet[cat.id] = { anticipe: '0', reel: '0' };
      }
    }

    const res = await fetch('/api/budget', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ anneeId: data.anneeId, mois, lignes: lignesComplet }),
    });

    const cats           = data?.categories ?? [];
    const catsPrecaution = cats.filter((c: any) => c.type === 'epargne_precaution');

    // 2. Répercuter banques → catégories epargne_precaution en DB
    // ── Toujours mettre à jour TOUTES les catsPrecaution (source de vérité DB) ──
    if (catsPrecaution.length > 0) {
      const newLignesPrecaution = { ...lignesComplet };

      // Calculer le réel par catégorie precaution depuis lignesBanque
      catsPrecaution.forEach((cat: any, idx: number) => {
        const lb = lignesBanque[idx]; // undefined si moins de banques que de catégories
        newLignesPrecaution[cat.id] = {
          anticipe: lignes[cat.id]?.anticipe ?? '0',
          reel:     lb ? (lb.reel || '0') : '0', // 0 si pas de lignesBanque → efface les valeurs stale
        };
      });

      // Si plus de lignesBanque que de catégories precaution : sommer le surplus dans la dernière
      if (lignesBanque.length > catsPrecaution.length && catsPrecaution.length > 0) {
        const lastCat  = catsPrecaution[catsPrecaution.length - 1];
        const surplus  = lignesBanque
          .slice(catsPrecaution.length)
          .reduce((s: number, lb: any) => s + (parseInt(lb.reel) || 0), 0);
        const current  = parseInt(newLignesPrecaution[lastCat.id]?.reel || '0');
        newLignesPrecaution[lastCat.id] = {
          ...newLignesPrecaution[lastCat.id],
          reel: String(current + surplus),
        };
      }

      await fetch('/api/budget', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ anneeId: data.anneeId, mois, lignes: newLignesPrecaution }),
      });
    }

    // 3. ── Incrémenter banques (epargne_precaution) ────────────────────────
    // Clé stable : banqueId (pas lb.id qui est volatile)
    // Référence : localStorage avec clé basée sur banqueId
    for (const lb of lignesBanque) {
      const reelVal = parseInt(lb.reel) || 0;
      if (!lb.banqueId) continue;

      // Clé stable basée sur banqueId (non volatile entre rechargements)
      const oldKey = `banque-saved-${annee}-${mois}-${lb.banqueId}`;
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

    // 4. ── Incrémenter CompteFonds (epargne_autre) — référence DB ──────────
    // Référence = data.budget (chargé depuis DB au dernier charger())
    // → pas de localStorage → pas de doublon si rechargement page
    const catsAutre = cats.filter((c: any) => c.type === 'epargne_autre');
    const budgetRef = data?.budget ?? [];

    for (const cat of catsAutre) {
      const newVal = parseInt(lignes[cat.id]?.reel) || 0;
      // Valeur de référence = ce qui était en DB au dernier chargement
      const oldVal = Number(budgetRef.find((b: any) => b.categorieId === cat.id)?.montantReel ?? 0);
      const diff   = newVal - oldVal;

      if (diff !== 0) {
        const compte = trouverCompteParNom(cat.nom, comptes);
        if (compte) {
          await fetch(`/api/comptes?id=${compte.id}`, {
            method:  'PUT',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ action: diff > 0 ? 'increment' : 'decrement', montant: Math.abs(diff) }),
          });
        }
      }
    }

    setSaving(false);
    if (res.ok) {
      setSaved(true);
      toast.success('Suivi mensuel sauvegardé ✓');
      (window as any).__setSaveStatus?.('saved');

      // ── Mettre à jour data.budget pour TOUTES les catégories (y compris nouvelles) ──
      // Important : les catégories jamais sauvegardées ne sont pas dans prev.budget
      // → on les ajoute pour que charger() ne les écrase pas lors d'un rechargement
      setData((prev: any) => {
        if (!prev?.budget) return prev;
        const existingIds = new Set(prev.budget.map((b: any) => b.categorieId));
        // Mettre à jour les entrées existantes
        const updatedBudget = prev.budget.map((b: any) => ({
          ...b,
          montantAnticipe: parseInt(lignes[b.categorieId]?.anticipe ?? '') || b.montantAnticipe,
          montantReel:     parseInt(lignes[b.categorieId]?.reel     ?? '') || b.montantReel,
        }));
        // Ajouter les nouvelles catégories qui n'avaient pas d'entrée DB
        const cats = prev.categories ?? [];
        for (const [catId, vals] of Object.entries(lignes as Record<string, { anticipe: string; reel: string }>)) {
          if (!existingIds.has(catId)) {
            const ant  = parseInt(vals.anticipe) || 0;
            const reel = parseInt(vals.reel)     || 0;
            if (ant > 0 || reel > 0) {
              const cat = cats.find((c: any) => c.id === catId);
              updatedBudget.push({
                categorieId:     catId,
                categorie:       cat ?? { id: catId, nom: '', type: '' },
                montantAnticipe: ant,
                montantReel:     reel,
              });
            }
          }
        }
        return { ...prev, budget: updatedBudget };
      });

      setTimeout(() => { setSaved(false); (window as any).__setSaveStatus?.('idle'); }, 3000);
    } else {
      try {
        const errBody = await res.clone().json();
        console.error('❌ PUT /api/budget error:', errBody);
        toast.error(`Erreur sauvegarde : ${errBody.error ?? res.status}`);
      } catch {
        toast.error(`Erreur sauvegarde HTTP ${res.status}`);
      }
      (window as any).__setSaveStatus?.('error');
    }
  };

  const copierMoisPrecedent = async () => {
    const pm = mois === 1 ? 12 : mois - 1;
    const pa = mois === 1 ? annee - 1 : annee;
    if (!window.confirm(`Copier les prévisions de ${MOIS_LABELS[pm]} ${pa} vers ce mois ?\nCela remplacera les prévisions actuelles.`)) return;
    setCopying(true);
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
      toast.info(`Prévisions de ${MOIS_LABELS[pm]} ${pa} copiées`);
    } else {
      toast.error('Erreur lors de la copie');
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
    toast.success('Données mises à jour ✓');
    charger();
  };

  const ajouterLigneBanque   = () => setLignesBanque(prev => [...prev, { id: `lb-${Date.now()}`, banqueId: banques[0]?.id ?? '', anticipe: 0, reel: '' }]);
  const supprimerLigneBanque = (id: string) => setLignesBanque(prev => prev.filter(l => l.id !== id));

  // updateLigneBanque — version PROPRE sans anti-pattern React
  // Appelle setLignes et setLignesBanque en top-level, jamais l'un dans l'autre
  const updateLigneBanque = (id: string, field: keyof LigneBanque, val: any) => {
    // 1. Mettre à jour lignesBanque
    setLignesBanque(prev => prev.map(l => l.id === id ? { ...l, [field]: val } : l));

    // 2. Si champ 'reel' modifié → sync lignes[catPrec] en top-level
    if (field === 'reel') {
      const cats = data?.categories ?? [];
      const catsPrecaution = cats.filter((c: any) => c.type === 'epargne_precaution');
      if (catsPrecaution.length === 0) return;

      // Calculer la liste banque mise à jour (appliquer le changement explicitement)
      const updatedBanque = lignesBanque.map(l => l.id === id ? { ...l, reel: String(val) } : l);

      // Mettre à jour lignes[catPrec] en top-level (pas dans un autre callback)
      setLignes(prev => {
        const synced = { ...prev }; // Inclut TOUTES les catégories (epargne_investissement etc.)
        catsPrecaution.forEach((cat: any, idx: number) => {
          const lb = updatedBanque[idx];
          synced[cat.id] = {
            anticipe: prev[cat.id]?.anticipe ?? '0',
            reel:     lb ? (String(lb.reel) || '0') : '0',
          };
        });
        // Surplus : sommer dans la dernière catégorie precaution
        if (updatedBanque.length > catsPrecaution.length && catsPrecaution.length > 0) {
          const lastCat = catsPrecaution[catsPrecaution.length - 1];
          const surplus = updatedBanque.slice(catsPrecaution.length)
            .reduce((s: number, lb: any) => s + (parseInt(lb.reel) || 0), 0);
          const current = parseInt(synced[lastCat.id]?.reel || '0');
          synced[lastCat.id] = { ...synced[lastCat.id], reel: String(current + surplus) };
        }
        return synced; // Toutes les autres catégories (epargne_investissement...) sont préservées
      });
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64"><div className="spinner scale-150" /></div>
  );

  const cats = data?.categories ?? [];

  // ── Totaux ──────────────────────────────────────────────────────────────
  const catsPrecaution          = cats.filter((c: any) => c.type === 'epargne_precaution');
  const totalAnticipePrecaution = catsPrecaution.reduce((s: number, c: any) => {
    const b = data?.budget?.find((b: any) => b.categorieId === c.id);
    return s + (b?.montantAnticipe ?? 0);
  }, 0);
  const totalReelBanques = lignesBanque.reduce((s, l) => s + (parseInt(l.reel) || 0), 0);

  const revAnt  = cats.filter((c: any) => c.type === 'revenu').reduce((s: number, c: any) => s + (parseInt(lignes[c.id]?.anticipe) || 0), 0);
  const revReel = cats.filter((c: any) => c.type === 'revenu').reduce((s: number, c: any) => s + (parseInt(lignes[c.id]?.reel)     || 0), 0);

  // Épargne = toute l'épargne depuis lignes (source unique, miroir DB)
  // lignes[catPrec] est initialisé depuis DB dans charger()
  const epAnt  = cats.filter((c: any) => c.type?.startsWith('epargne')).reduce((s: number, c: any) => s + (parseInt(lignes[c.id]?.anticipe) || 0), 0);
  const epReel = cats.filter((c: any) => c.type?.startsWith('epargne')).reduce((s: number, c: any) => s + (parseInt(lignes[c.id]?.reel)     || 0), 0);

  const depAnt  = cats.filter((c: any) => c.type?.startsWith('depense') || c.type === 'remboursement_dette').reduce((s: number, c: any) => s + (parseInt(lignes[c.id]?.anticipe) || 0), 0);
  const depReel = cats.filter((c: any) => c.type?.startsWith('depense') || c.type === 'remboursement_dette').reduce((s: number, c: any) => s + (parseInt(lignes[c.id]?.reel)     || 0), 0);

  const soldeAnt  = revAnt  - epAnt  - depAnt;
  const soldeReel = revReel - epReel - depReel;
  const tauxExec  = revAnt  > 0 ? (revReel / revAnt)  * 100 : 0;
  const tauxEp    = revReel > 0 ? (epReel  / revReel) * 100 : 0;

  const grouped = ORDRE_TYPES.map(type => ({
    type, items: cats.filter((c: any) => c.type === type),
  })).filter(g => g.items.length > 0);

  const modalCats = cats.filter((c: any) => c.type === modalType);

  const donutData = Object.entries(
    cats.filter((c: any) => c.type?.startsWith('depense') && (parseInt(lignes[c.id]?.reel) || 0) > 0)
        .reduce((acc: any, c: any) => { acc[c.nom] = (acc[c.nom] ?? 0) + (parseInt(lignes[c.id]?.reel) || 0); return acc; }, {})
  ).map(([name, value]) => ({ name, value }));

  return (
    <div className="space-y-5 animate-fadeIn">

      <BandeauMoisAnterieur mois={mois} annee={annee}
        onMoisCourant={() => { setMois(moisCourantReel); setAnnee(anneeCouranteReelle); }} />

      <ModalKPI isOpen={modalOpen} onClose={() => setModalOpen(false)} onSave={handleModalSave}
        titre={TYPE_LABELS[modalType as keyof typeof TYPE_LABELS] ?? ''}
        categories={modalCats} lignes={lignes} mode="both" />

      {/* ── En-tête ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text)]">Suivi mensuel</h1>
          <p className="text-[var(--text-muted)] text-sm">{MOIS_LABELS[mois]} {annee}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={collapseAllGroups}
            className="flex items-center gap-1.5 border border-[var(--border)] bg-[var(--surface)] hover:bg-slate-50 dark:hover:bg-dark-card text-[var(--text-muted)] rounded-xl px-3 py-2 text-xs font-medium transition-all">
            <ChevronsUpDown size={13} />Tout plier
          </button>
          <button onClick={expandAllGroups}
            className="flex items-center gap-1.5 border border-[var(--border)] bg-[var(--surface)] hover:bg-slate-50 dark:hover:bg-dark-card text-[var(--text-muted)] rounded-xl px-3 py-2 text-xs font-medium transition-all">
            <ChevronsDownUp size={13} />Tout déplier
          </button>
          <button onClick={toggleTotals}
            className="flex items-center gap-1.5 border border-[var(--border)] bg-[var(--surface)] hover:bg-slate-50 dark:hover:bg-dark-card text-[var(--text-muted)] rounded-xl px-3 py-2 text-xs font-medium transition-all">
            {showTotals ? '🙈 Masquer totaux' : '👁️ Afficher totaux'}
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

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Revenus',  val: revReel,   ant: revAnt,   type: 'revenu',       cls: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400' },
          { label: 'Épargne',  val: epReel,    ant: epAnt,    type: 'epargne_precaution', cls: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400' },
          { label: 'Dépenses', val: depReel,   ant: depAnt,   type: 'depense_fixe', cls: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400' },
          { label: 'Solde',    val: soldeReel, ant: soldeAnt, type: '',
            cls: soldeReel >= 0 ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-600 dark:text-red-400' },
        ].map(k => (
          <div key={k.label} className={clsx('rounded-2xl border p-3.5 flex flex-col gap-1 transition-colors', k.cls)}>
            <div className="flex items-start justify-between">
              <p className="text-xs font-medium opacity-60">{k.label}</p>
              {k.type && (
                <button onClick={() => { setModalType(k.type); setModalOpen(true); }}
                  className="p-1 rounded-lg hover:bg-white/40 dark:hover:bg-black/20 transition-colors flex-shrink-0 -mt-0.5 -mr-0.5" title="Modifier">
                  <Pencil size={11} className="opacity-60" />
                </button>
              )}
            </div>
            <p className="text-lg font-bold">{formatFCFA(k.val)}</p>
            <p className="text-xs opacity-55">Prévision : {formatFCFA(k.ant)}</p>
          </div>
        ))}
      </div>

      {/* ── KPIs analytiques ── */}
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

      {/* ── Tableau ── */}
      <div className="max-w-5xl mx-auto w-full">
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] overflow-hidden transition-colors">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]" style={{ tableLayout: 'fixed' }}>
              <colgroup>
                <col />
                <col style={{ width: '140px' }} />
                <col style={{ width: '140px' }} />
                <col style={{ width: '110px' }} />
                <col style={{ width: '70px'  }} />
              </colgroup>
              <thead>
                <tr className="bg-slate-50 dark:bg-dark-card border-b border-[var(--border)]">
                  <th className="text-left px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase tracking-wide">Catégorie</th>
                  <th className="text-right px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase">{LABEL_PREVISION}</th>
                  <th className="text-right px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase">{LABEL_REEL}</th>
                  <th className="text-right px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase">{LABEL_ECART}</th>
                  <th className="text-right px-4 py-3 font-semibold text-[var(--text-muted)] text-xs uppercase">{LABEL_EXEC}</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map(({ type, items }) => {
                  const isRevenu       = type === 'revenu';
                  const isEpPrecaution = type === 'epargne_precaution';
                  const isEpAutre      = type === 'epargne_autre';
                  const isOpen         = groupsOpen[type] !== false;

                  let gAnt: number, gReel: number;
                  if (isEpPrecaution) {
                    gAnt  = totalAnticipePrecaution;
                    gReel = totalReelBanques;
                  } else {
                    gAnt  = items.reduce((s: number, c: any) => s + (parseInt(lignes[c.id]?.anticipe) || 0), 0);
                    gReel = items.reduce((s: number, c: any) => s + (parseInt(lignes[c.id]?.reel)     || 0), 0);
                  }
                  const gEcar = gReel - gAnt;
                  const gPct  = gAnt > 0 ? (gReel / gAnt) * 100 : 0;

                  const gEcarColor = isRevenu
                    ? gEcar > 0 ? 'text-green-500' : gEcar < 0 ? 'text-red-500' : 'text-[var(--text-muted)]'
                    : gEcar > 0 ? 'text-red-500'  : gEcar < 0 ? 'text-green-500' : 'text-[var(--text-muted)]';
                  const gTauxColor = gPct > 110 ? 'text-red-500' : gPct > 100 ? 'text-orange-500' : gPct >= 80 ? 'text-amber-500' : 'text-green-500';

                  return (
                    <Fragment key={type}>
                      {/* Ligne de groupe */}
                      <tr className="bg-slate-50 dark:bg-dark-card border-t border-[var(--border)] cursor-pointer hover:bg-slate-100 dark:hover:bg-dark-card/80 transition-colors"
                          onClick={() => toggleGroup(type)}>
                        <td className="px-4 py-2.5 text-xs font-bold text-[var(--text-muted)] uppercase tracking-wide">
                          <div className="flex items-center gap-2">
                            {isOpen ? <ChevronDown size={14} className="text-slate-400 flex-shrink-0" /> : <ChevronRight size={14} className="text-slate-400 flex-shrink-0" />}
                            {TYPE_LABELS[type as keyof typeof TYPE_LABELS]}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs font-bold text-[var(--text)]">{gAnt > 0 ? formatFCFA(gAnt) : '—'}</td>
                        <td className="px-4 py-2.5 text-right text-xs font-bold text-[var(--text)]">{gReel > 0 ? formatFCFA(gReel) : '—'}</td>
                        <td className={clsx('px-4 py-2.5 text-right text-xs font-bold', gEcarColor)}>
                          {gEcar !== 0 ? (gEcar > 0 ? '+' : '') + formatFCFA(gEcar) : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {gAnt > 0 ? <span className={clsx('text-xs font-bold', gTauxColor)}>{gPct.toFixed(0)}%</span> : <span className="text-xs text-[var(--text-muted)]">—</span>}
                        </td>
                      </tr>

                      {isOpen && (
                        <>
                          {isEpPrecaution ? (
                            <>
                              {lignesBanque.map(lb => (
                                <tr key={lb.id} className="border-t border-[var(--border)] hover:bg-slate-50/60 dark:hover:bg-dark-card/60 transition-colors">
                                  <td className="px-4 py-2.5 pl-10">
                                    <select value={lb.banqueId} onChange={e => updateLigneBanque(lb.id, 'banqueId', e.target.value)}
                                      className="border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none w-full max-w-[180px]">
                                      <option value="">— Choisir banque —</option>
                                      {banques.map((b: any) => <option key={b.id} value={b.id}>{b.nomBanque}</option>)}
                                    </select>
                                  </td>
                                  <td className="px-4 py-2.5 text-right text-sm text-[var(--text-muted)]">
                                    {lb.anticipe > 0 ? formatFCFA(lb.anticipe) : '—'}
                                  </td>
                                  <td className="px-3 py-2">
                                    <input type="number" value={lb.reel} onChange={e => updateLigneBanque(lb.id, 'reel', e.target.value)}
                                      onKeyDown={onlyNumbers}
                                      placeholder="0"
                                      className="w-full text-right border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none" />
                                  </td>
                                  <td className="px-4 py-2.5 text-right text-sm text-[var(--text-muted)]">—</td>
                                  <td className="px-4 py-2.5 text-right">
                                    <button onClick={() => supprimerLigneBanque(lb.id)} className="text-slate-300 hover:text-red-500 transition-colors">
                                      <Trash2 size={13} />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                              <tr className="border-t border-[var(--border)]">
                                <td colSpan={5} className="px-4 py-2 pl-10">
                                  <button onClick={ajouterLigneBanque}
                                    className="flex items-center gap-1.5 text-xs text-primary hover:text-primary-dark font-medium transition-colors">
                                    <Plus size={13} />Ajouter une banque
                                  </button>
                                </td>
                              </tr>
                              {showTotals && (
                                <tr className="bg-blue-50/40 dark:bg-blue-900/10 border-t border-[var(--border)]">
                                  <td className="px-4 py-2 pl-10 text-xs font-bold text-[var(--text-muted)] uppercase">Sous-total</td>
                                  <td className="px-4 py-2 text-right text-xs font-bold text-[var(--text)]">{formatFCFA(totalAnticipePrecaution)}</td>
                                  <td className="px-4 py-2 text-right text-xs font-bold text-[var(--text)]">{formatFCFA(totalReelBanques)}</td>
                                  <td className="px-4 py-2 text-right text-xs font-bold text-green-500">
                                    {(totalReelBanques - totalAnticipePrecaution) !== 0
                                      ? ((totalReelBanques - totalAnticipePrecaution) > 0 ? '+' : '') + formatFCFA(totalReelBanques - totalAnticipePrecaution)
                                      : '—'}
                                  </td>
                                  <td className="px-4 py-2 text-right text-xs text-[var(--text-muted)]">
                                    {totalAnticipePrecaution > 0 ? ((totalReelBanques / totalAnticipePrecaution) * 100).toFixed(0) + '%' : '—'}
                                  </td>
                                </tr>
                              )}
                            </>
                          ) : (
                            <>
                              {items.map((cat: any) => {
                                const ant  = parseInt(lignes[cat.id]?.anticipe) || 0;
                                const reel = parseInt(lignes[cat.id]?.reel)     || 0;
                                const ecar = reel - ant;
                                const pct  = ant > 0 ? (reel / ant) * 100 : 0;
                                const over = !isRevenu && ant > 0 && reel > ant;
                                const fondLie = isEpAutre ? trouverCompteParNom(cat.nom, comptes) : null;
                                const ecarColor = isRevenu
                                  ? reel > ant ? 'text-green-500' : reel < ant ? 'text-red-500' : 'text-[var(--text-muted)]'
                                  : ecar > 0   ? 'text-red-500'  : ecar < 0   ? 'text-green-500' : 'text-[var(--text-muted)]';
                                return (
                                  <tr key={cat.id}
                                    className={clsx('border-t border-[var(--border)] hover:bg-slate-50/60 dark:hover:bg-dark-card/60 transition-colors',
                                      over && 'bg-red-50/30 dark:bg-red-900/10')}>
                                    <td className="px-4 py-2.5 pl-10 text-[var(--text)]">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        {over && <span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />}
                                        <span className="truncate">{cat.nom}</span>
                                        {fondLie && (
                                          <span className="text-xs px-1.5 py-0.5 rounded-md bg-primary/10 text-primary font-medium flex-shrink-0">
                                            → {fondLie.nom}
                                          </span>
                                        )}
                                        {isEpAutre && !fondLie && (
                                          <span className="text-xs px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-dark-card text-[var(--text-muted)] flex-shrink-0">
                                            non lié
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                    <td className="px-3 py-2">
                                      <input type="number" value={lignes[cat.id]?.anticipe ?? ''}
                                        onChange={e => handleChange(cat.id, 'anticipe', e.target.value)} onKeyDown={onlyNumbers} placeholder="0"
                                        className="w-full text-right border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none" />
                                    </td>
                                    <td className="px-3 py-2">
                                      <input type="number" value={lignes[cat.id]?.reel ?? ''}
                                        onChange={e => handleChange(cat.id, 'reel', e.target.value)} onKeyDown={onlyNumbers} placeholder="0"
                                        className="w-full text-right border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm bg-[var(--card)] text-[var(--text)] focus:border-primary outline-none" />
                                    </td>
                                    <td className={clsx('px-4 py-2.5 text-right text-sm font-medium', ecarColor)}>
                                      {ecar !== 0 ? (ecar > 0 ? '+' : '') + formatFCFA(ecar) : '—'}
                                    </td>
                                    <td className="px-4 py-2.5 text-right text-sm">
                                      {ant > 0 ? (
                                        <span className={clsx('font-semibold',
                                          pct > 110 ? 'text-red-500' : pct > 100 ? 'text-orange-500' : pct >= 80 ? 'text-amber-500' : 'text-green-500')}>
                                          {pct.toFixed(0)}%
                                        </span>
                                      ) : '—'}
                                    </td>
                                  </tr>
                                );
                              })}
                              {showTotals && (
                                <tr className="bg-slate-50/70 dark:bg-dark-card/70 border-t border-[var(--border)]">
                                  <td className="px-4 py-2 pl-10 text-xs font-bold text-[var(--text-muted)] uppercase">Sous-total</td>
                                  <td className="px-4 py-2 text-right text-xs font-bold text-[var(--text)]">{formatFCFA(gAnt)}</td>
                                  <td className="px-4 py-2 text-right text-xs font-bold text-[var(--text)]">{formatFCFA(gReel)}</td>
                                  <td className={clsx('px-4 py-2 text-right text-xs font-bold', gEcarColor)}>
                                    {gEcar !== 0 ? (gEcar > 0 ? '+' : '') + formatFCFA(gEcar) : '—'}
                                  </td>
                                  <td className="px-4 py-2 text-right text-xs">
                                    {gAnt > 0 ? <span className={clsx('font-bold', gTauxColor)}>{gPct.toFixed(0)}%</span> : '—'}
                                  </td>
                                </tr>
                              )}
                            </>
                          )}
                        </>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Totaux globaux */}
          <div className="border-t-2 border-primary/30 bg-primary/5 dark:bg-primary/10">
            <div className="px-4 py-2.5 flex items-center justify-between border-b border-primary/10">
              <span className="font-semibold text-[var(--text)] text-sm">Total sorties (épargne + dépenses)</span>
              <div className="flex gap-8">
                <span className="font-semibold text-[var(--text)] text-sm">{formatFCFA(epAnt + depAnt)}</span>
                <span className="font-semibold text-[var(--text)] text-sm">{formatFCFA(epReel + depReel)}</span>
              </div>
            </div>
            <div className="px-4 py-3 flex items-center justify-between">
              <span className="font-bold text-[var(--text)]">Solde disponible</span>
              <div className="flex gap-8">
                <span className={clsx('font-bold', soldeAnt >= 0 ? 'text-green-600' : 'text-red-500')}>{formatFCFA(soldeAnt)}</span>
                <span className={clsx('font-bold text-lg', soldeReel >= 0 ? 'text-green-600' : 'text-red-500')}>{formatFCFA(soldeReel)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Graphiques ── */}
      <div className="grid lg:grid-cols-2 gap-5">
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5 transition-colors">
          <h3 className="font-semibold text-[var(--text)] mb-3 text-sm">📊 Dépenses — 6 derniers mois</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={hist} barGap={3}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="mois" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickFormatter={v => (v/1000).toFixed(0)+'k'} />
              <Tooltip formatter={(v: number) => formatFCFA(v)} />
              <Legend />
              <Bar dataKey="prev" name="Prévision" fill="#DBEAFE" radius={[3,3,0,0]} />
              <Bar dataKey="reel" name="Réel"      fill="#1E40AF" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-5 transition-colors">
          <h3 className="font-semibold text-[var(--text)] mb-3 text-sm">🥧 Répartition dépenses ce mois</h3>
          {donutData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={150}>
                <PieChart>
                  <Pie data={donutData} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="value" paddingAngle={2}>
                    {donutData.map((_: any, i: number) => <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => formatFCFA(v)} />
                </PieChart>
              </ResponsiveContainer>
              {/* Légende triée par montant décroissant */}
              <div className="mt-2 space-y-1 max-h-32 overflow-y-auto pr-1">
                {donutData
                  .map((item: any, origIdx: number) => ({ ...item, origIdx }))
                  .sort((a: any, b: any) => (b.value as number) - (a.value as number))
                  .map((item: any) => {
                    const total = donutData.reduce((s: number, d: any) => s + (d.value as number), 0);
                    const pct = total > 0 ? ((item.value as number) / total * 100).toFixed(1) : '0';
                    return (
                      <div key={item.origIdx} className="flex items-center gap-1.5 text-xs">
                        <div className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: DONUT_COLORS[item.origIdx % DONUT_COLORS.length] }} />
                        <span className="flex-1 truncate text-[var(--text)]">{item.name}</span>
                        <span className="text-[var(--text-muted)] w-9 text-right flex-shrink-0">{pct}%</span>
                        <span className="font-semibold text-[var(--text)] w-24 text-right flex-shrink-0">
                          {formatFCFA(item.value as number)}
                        </span>
                      </div>
                    );
                  })}
              </div>
              <div className="mt-2 pt-2 border-t border-[var(--border)] flex justify-between text-xs font-bold">
                <span className="text-[var(--text-muted)]">Total</span>
                <span className="text-[var(--text)]">{formatFCFA(donutData.reduce((s: number, d: any) => s + (d.value as number), 0))}</span>
              </div>
            </>
          ) : (
            <div className="h-40 flex items-center justify-center text-[var(--text-muted)] text-sm">Aucune dépense ce mois</div>
          )}
        </div>
      </div>
    </div>
  );
}
