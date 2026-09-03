import { NextRequest, NextResponse } from 'next/server';
import { logAudit } from '@/lib/audit';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { toNum } from '@/lib/serial';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import { MOIS_LABELS, MOIS_COURTS, TYPE_LABELS } from '@/types';

// =============================================================================
//  S7 / F11 — Export Excel annuel
//
//  Corrections apportees :
//   1. Erreur 500 sanitisee — le message Prisma brut etait renvoye au client
//      (noms de tables, UUID, structure). Detail journalise cote serveur.
//   2. Validation Zod du parametre `annee` (parseInt sans radix ni borne).
//   3. Les categories desactivees ne sont plus perdues : l'export couvre une
//      annee entiere, une categorie retiree en cours d'annee a des montants en
//      base. Le filtre isActive faussait les totaux de l'onglet Suivi.
//   4. Decaissements sortis dans leur propre feuille (deux tables de largeurs
//      differentes se disputaient les largeurs de colonnes).
//   5. Trois feuilles ajoutees : Recurrentes, Comptes & Banques, et formats
//      monetaires appliques aux cellules numeriques.
//   6. Fonction fmt() morte supprimee.
//
//  Note securite : xlsx@0.18.5 porte des CVE de pollution de prototype et de
//  ReDoS, mais uniquement a la LECTURE de fichiers arbitraires. Cette route
//  n'ecrit que des fichiers, elle n'est pas exposee. Le point a auditer est
//  /api/import s'il parse des .xlsx uploades.
// =============================================================================

const MOIS_PAR_AN = 12;

// Format monetaire Excel : separateur de milliers + suffixe FCFA
const FORMAT_FCFA = '#,##0 "F"';

const anneeSchema = z.coerce.number().int().min(2000).max(2100);

// Applique un format numerique a une plage de colonnes d'une feuille.
// Les cellules non numeriques (en-tetes, libelles) sont laissees intactes.
function formaterMontants(
  ws: XLSX.WorkSheet,
  colonnesDebut: number,
  ligneDebut: number,
) {
  const ref = ws['!ref'];
  if (!ref) return;
  const plage = XLSX.utils.decode_range(ref);

  for (let l = ligneDebut; l <= plage.e.r; l++) {
    for (let c = colonnesDebut; c <= plage.e.c; c++) {
      const adresse = XLSX.utils.encode_cell({ r: l, c });
      const cellule = ws[adresse];
      if (cellule && cellule.t === 'n') cellule.z = FORMAT_FCFA;
    }
  }
}

export async function GET(req: NextRequest) {
  let userId: string | null = null;

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    userId = session.user.id;

    const { searchParams } = new URL(req.url);
    const parsed = anneeSchema.safeParse(
      searchParams.get('annee') ?? new Date().getFullYear()
    );
    if (!parsed.success)
      return NextResponse.json({ error: 'Année invalide' }, { status: 400 });

    const annee = parsed.data;

    const anneeRec = await prisma.annee.findUnique({
      where: { userId_annee: { userId, annee } },
    });
    if (!anneeRec)
      return NextResponse.json({ error: 'Année non trouvée' }, { status: 404 });

    // ── Chargement ────────────────────────────────────────────────────────
    const budgets = await prisma.budgetMensuel.findMany({
      where:   { userId, anneeId: anneeRec.id },
      include: { categorie: true },
    });

    // S7 FIX : union des categories actives ET de celles presentes dans les
    // budgets de l'annee. Une categorie desactivee en cours d'annee garde ses
    // montants : l'exclure fausserait les totaux.
    const categoriesActives = await prisma.categorie.findMany({
      where:   { userId, isActive: true },
      orderBy: { ordre: 'asc' },
    });

    const catParId = new Map(categoriesActives.map(c => [c.id, c]));
    for (const b of budgets) {
      if (!catParId.has(b.categorieId)) catParId.set(b.categorieId, b.categorie);
    }
    const categories = Array.from(catParId.values())
      .sort((a, b) => a.ordre - b.ordre || a.nom.localeCompare(b.nom));

    const decaissements = await prisma.decaissement.findMany({
      where:   { userId, anneeId: anneeRec.id },
      include: { repartitions: { include: { compte: true } }, banque: true },
      orderBy: { dateOperation: 'desc' },
    });

    const comptes = await prisma.compteFonds.findMany({
      where:   { userId, isActive: true },
      orderBy: { ordre: 'asc' },
    });

    const banques = await prisma.banque.findMany({
      where:   { userId, isActive: true },
      orderBy: { ordre: 'asc' },
    });

    const recurrentes = await prisma.recurrente.findMany({
      where:   { userId },
      include: { categorie: true },
      orderBy: { montant: 'desc' },
    });

    const wb = XLSX.utils.book_new();

    // ── FEUILLE 1 : Tableau de bord ──────────────────────────────────────
    const dash: any[][] = [];
    dash.push([`GESTBUDGET — TABLEAU DE BORD ${annee}`]);
    dash.push([]);
    dash.push(['Mois', 'Revenus réels', 'Dépenses réelles', 'Épargne réelle', 'Solde']);

    let cumRev = 0, cumDep = 0, cumEp = 0;

    for (let m = 1; m <= MOIS_PAR_AN; m++) {
      const mBudgets = budgets.filter(b => b.mois === m);
      const rev = mBudgets
        .filter(b => b.categorie.type === 'revenu')
        .reduce((s, b) => s + toNum(b.montantReel), 0);
      const dep = mBudgets
        .filter(b => b.categorie.type.startsWith('depense') || b.categorie.type === 'remboursement_dette')
        .reduce((s, b) => s + toNum(b.montantReel), 0);
      const ep = mBudgets
        .filter(b => b.categorie.type.startsWith('epargne'))
        .reduce((s, b) => s + toNum(b.montantReel), 0);

      cumRev += rev; cumDep += dep; cumEp += ep;
      dash.push([MOIS_LABELS[m], rev, dep, ep, rev - dep - ep]);
    }

    dash.push(['TOTAL', cumRev, cumDep, cumEp, cumRev - cumDep - cumEp]);

    const wsDash = XLSX.utils.aoa_to_sheet(dash);
    wsDash['!cols'] = [{ wch: 15 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 16 }];
    formaterMontants(wsDash, 1, 3);
    XLSX.utils.book_append_sheet(wb, wsDash, 'Tableau de bord');

    // ── FEUILLE 2 : Suivi mensuel ────────────────────────────────────────
    const suivi: any[][] = [];
    suivi.push([`SUIVI BUDGÉTAIRE ${annee}`]);
    suivi.push([]);

    const enTetes = ['Catégorie', 'Type'];
    for (let m = 1; m <= MOIS_PAR_AN; m++) {
      enTetes.push(`${MOIS_COURTS[m]} anticipé`);
      enTetes.push(`${MOIS_COURTS[m]} réel`);
    }
    enTetes.push('Total anticipé', 'Total réel', 'Écart');
    suivi.push(enTetes);

    for (const cat of categories) {
      const ligne: any[] = [
        cat.nom,
        TYPE_LABELS[cat.type as keyof typeof TYPE_LABELS],
      ];
      let totAnt = 0, totReel = 0;

      for (let m = 1; m <= MOIS_PAR_AN; m++) {
        const b    = budgets.find(x => x.categorieId === cat.id && x.mois === m);
        const ant  = b ? toNum(b.montantAnticipe) : 0;
        const reel = b ? toNum(b.montantReel)     : 0;
        ligne.push(ant, reel);
        totAnt  += ant;
        totReel += reel;
      }

      ligne.push(totAnt, totReel, totReel - totAnt);
      suivi.push(ligne);
    }

    const wsSuivi = XLSX.utils.aoa_to_sheet(suivi);
    wsSuivi['!cols'] = [{ wch: 35 }, { wch: 25 }, ...Array(27).fill({ wch: 14 })];
    formaterMontants(wsSuivi, 2, 3);
    XLSX.utils.book_append_sheet(wb, wsSuivi, `Suivi-${annee}`);

    // ── FEUILLE 3 : Récapitulatif ────────────────────────────────────────
    const recap: any[][] = [];
    recap.push([`RÉCAPITULATIF ANNUEL ${annee}`]);
    recap.push([]);
    recap.push(['Catégorie', 'Type', 'Moy. anticipée/mois', 'Moy. réelle/mois', 'Total annuel', '% des revenus']);

    const totalRevAnnuel = budgets
      .filter(b => b.categorie.type === 'revenu')
      .reduce((s, b) => s + toNum(b.montantReel), 0);

    for (const cat of categories) {
      const catBudgets   = budgets.filter(b => b.categorieId === cat.id);
      const totAnt       = catBudgets.reduce((s, b) => s + toNum(b.montantAnticipe), 0);
      const totReel      = catBudgets.reduce((s, b) => s + toNum(b.montantReel), 0);
      const moisAvecData = catBudgets.filter(b => toNum(b.montantReel) > 0).length || 1;

      recap.push([
        cat.nom,
        TYPE_LABELS[cat.type as keyof typeof TYPE_LABELS],
        Math.round(totAnt / MOIS_PAR_AN),
        Math.round(totReel / moisAvecData),
        totReel,
        totalRevAnnuel > 0 ? Number(((totReel / totalRevAnnuel) * 100).toFixed(1)) : 0,
      ]);
    }

    const wsRecap = XLSX.utils.aoa_to_sheet(recap);
    wsRecap['!cols'] = [{ wch: 35 }, { wch: 25 }, { wch: 20 }, { wch: 20 }, { wch: 18 }, { wch: 15 }];
    formaterMontants(wsRecap, 2, 3);
    // La colonne % ne doit pas porter le suffixe FCFA
    {
      const ref = wsRecap['!ref'];
      if (ref) {
        const plage = XLSX.utils.decode_range(ref);
        for (let l = 3; l <= plage.e.r; l++) {
          const cell = wsRecap[XLSX.utils.encode_cell({ r: l, c: 5 })];
          if (cell && cell.t === 'n') cell.z = '0.0"%"';
        }
        wsRecap['!autofilter'] = { ref: `A3:F${plage.e.r + 1}` };
      }
    }
    XLSX.utils.book_append_sheet(wb, wsRecap, 'Récapitulatif');

    // ── FEUILLE 4 : Budget de référence ──────────────────────────────────
    const budgetRef: any[][] = [];
    budgetRef.push(['BUDGET MENSUEL DE RÉFÉRENCE']);
    budgetRef.push([]);
    budgetRef.push(['Catégorie', 'Type', 'Montant anticipé (référence)']);

    for (const cat of categories) {
      const derniere = budgets
        .filter(b => b.categorieId === cat.id && toNum(b.montantAnticipe) > 0)
        .sort((a, b) => b.mois - a.mois)[0];
      budgetRef.push([
        cat.nom,
        TYPE_LABELS[cat.type as keyof typeof TYPE_LABELS],
        derniere ? toNum(derniere.montantAnticipe) : 0,
      ]);
    }

    const wsBudget = XLSX.utils.aoa_to_sheet(budgetRef);
    wsBudget['!cols'] = [{ wch: 35 }, { wch: 25 }, { wch: 26 }];
    formaterMontants(wsBudget, 2, 3);
    XLSX.utils.book_append_sheet(wb, wsBudget, 'Budget mensuel');

    // ── FEUILLE 5 : Décaissements (sortie de la feuille 1) ───────────────
    const dec: any[][] = [];
    dec.push([`DÉCAISSEMENTS ${annee}`]);
    dec.push([]);
    dec.push([
      'Date', 'Description', 'Type', 'Montant total', 'Part fonds', 'Part banque', 'Banque',
      ...comptes.map(c => c.nom),
    ]);

    for (const d of decaissements) {
      dec.push([
        new Date(d.dateOperation).toLocaleDateString('fr-FR'),
        d.description,
        d.typeMouvement,
        toNum(d.montantTotal),
        toNum(d.montantFond),
        toNum(d.montantBanque),
        d.banque?.nomBanque ?? '',
        ...comptes.map(c => {
          const r = d.repartitions.find(x => x.compteId === c.id);
          return r ? toNum(r.montant) : 0;
        }),
      ]);
    }

    const wsDec = XLSX.utils.aoa_to_sheet(dec);
    wsDec['!cols'] = [
      { wch: 12 }, { wch: 34 }, { wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 22 },
      ...comptes.map(() => ({ wch: 18 })),
    ];
    formaterMontants(wsDec, 3, 3);
    XLSX.utils.book_append_sheet(wb, wsDec, 'Décaissements');

    // ── FEUILLE 6 : Récurrentes (S7 / F10 — coût annualisé) ──────────────
    const rec: any[][] = [];
    rec.push(['RÉCURRENTES']);
    rec.push([]);
    rec.push(['Libellé', 'Catégorie', 'Flux', 'Montant / mois', 'Coût annuel', 'Statut']);

    let recDecAn = 0, recEncAn = 0;

    for (const r of recurrentes) {
      const montant = toNum(r.montant);
      const annuel  = montant * MOIS_PAR_AN;
      if (r.isActive) {
        if (r.typeFlux === 'encaissement') recEncAn += annuel;
        else                               recDecAn += annuel;
      }
      rec.push([
        r.libelle,
        r.categorie?.nom ?? '',
        r.typeFlux === 'encaissement' ? 'Encaissement' : 'Décaissement',
        montant,
        annuel,
        r.isActive ? 'Active' : 'Inactive',
      ]);
    }

    rec.push([]);
    rec.push(['Total décaissements / an (actives)', '', '', '', recDecAn, '']);
    rec.push(['Total encaissements / an (actives)', '', '', '', recEncAn, '']);
    rec.push(['Net récurrent / an',                 '', '', '', recEncAn - recDecAn, '']);

    const wsRec = XLSX.utils.aoa_to_sheet(rec);
    wsRec['!cols'] = [{ wch: 34 }, { wch: 28 }, { wch: 16 }, { wch: 18 }, { wch: 18 }, { wch: 12 }];
    formaterMontants(wsRec, 3, 3);
    XLSX.utils.book_append_sheet(wb, wsRec, 'Récurrentes');

    // ── FEUILLE 7 : Comptes & Banques ────────────────────────────────────
    const soldes: any[][] = [];
    soldes.push(['COMPTES & BANQUES']);
    soldes.push([`Photographie au ${new Date().toLocaleDateString('fr-FR')}`]);
    soldes.push([]);
    soldes.push(['FONDS DE FONCTIONNEMENT']);
    soldes.push(['Nom', 'Solde actuel', 'Objectif', 'Seuil d\u2019alerte']);

    let totalFonds = 0;
    for (const c of comptes) {
      totalFonds += toNum(c.soldeActuel);
      soldes.push([c.nom, toNum(c.soldeActuel), toNum(c.objectif), toNum(c.seuilAlerte)]);
    }
    soldes.push(['Total fonds', totalFonds, '', '']);

    soldes.push([]);
    soldes.push(['COMPTES BANCAIRES']);
    soldes.push(['Banque', 'Type de compte', 'Solde', 'Seuil d\u2019alerte']);

    let totalBanques = 0;
    for (const b of banques) {
      totalBanques += toNum(b.solde);
      soldes.push([b.nomBanque, b.typeCompte ?? '', toNum(b.solde), toNum(b.seuilAlerte)]);
    }
    soldes.push(['Total banques', '', totalBanques, '']);

    soldes.push([]);
    soldes.push(['PATRIMOINE TOTAL', '', totalFonds + totalBanques, '']);

    const wsSoldes = XLSX.utils.aoa_to_sheet(soldes);
    wsSoldes['!cols'] = [{ wch: 32 }, { wch: 22 }, { wch: 18 }, { wch: 18 }];
    formaterMontants(wsSoldes, 1, 4);
    XLSX.utils.book_append_sheet(wb, wsSoldes, 'Comptes & Banques');

    // ── Génération ───────────────────────────────────────────────────────
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    await logAudit({ userId, action: 'export', entityType: 'excel', entityNom: String(annee), req });

    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="GestBudget-${annee}.xlsx"`,
        'Cache-Control':       'no-store',
      },
    });

  } catch (e) {
    // S7 FIX : le message brut (noms de tables, UUID) n'est plus renvoyé au client
    console.error('[export/excel] GET:', userId ? `user=${userId}` : '', e);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
