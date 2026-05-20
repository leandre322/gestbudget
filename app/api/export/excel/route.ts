import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import * as XLSX from 'xlsx';
import { MOIS_LABELS, MOIS_COURTS, TYPE_LABELS } from '@/types';

function n(v: any) { return typeof v === 'bigint' ? Number(v) : (Number(v) || 0); }

function fmt(v: number) {
  return new Intl.NumberFormat('fr-FR').format(v) + ' FCFA';
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const annee = parseInt(searchParams.get('annee') ?? String(new Date().getFullYear()));

    // Récupérer les données
    const anneeRec = await prisma.annee.findUnique({
      where: { userId_annee: { userId: session.user.id, annee } },
    });
    if (!anneeRec) {
      return NextResponse.json({ error: 'Année non trouvée' }, { status: 404 });
    }

    const categories = await prisma.categorie.findMany({
      where: { userId: session.user.id, isActive: true },
      orderBy: { ordre: 'asc' },
    });

    const budgets = await prisma.budgetMensuel.findMany({
      where: { userId: session.user.id, anneeId: anneeRec.id },
      include: { categorie: true },
    });

    const decaissements = await prisma.decaissement.findMany({
      where: { userId: session.user.id, anneeId: anneeRec.id },
      include: { repartitions: { include: { compte: true } } },
      orderBy: { dateOperation: 'desc' },
    });

    const comptes = await prisma.compteFonds.findMany({
      where: { userId: session.user.id, isActive: true },
      orderBy: { ordre: 'asc' },
    });

    const wb = XLSX.utils.book_new();

    // ── ONGLET 1 : Tableau de bord ─────────────
    const dash: any[][] = [];
    dash.push([`GESTBUDGET — TABLEAU DE BORD ${annee}`]);
    dash.push([]);
    dash.push(['Mois', 'Revenus Réels', 'Dépenses Réelles', 'Épargne Réelle', 'Solde']);

    for (let m = 1; m <= 12; m++) {
      const mBudgets = budgets.filter(b => b.mois === m);
      const rev = mBudgets.filter(b => b.categorie.type === 'revenu').reduce((s, b) => s + n(b.montantReel), 0);
      const dep = mBudgets.filter(b => b.categorie.type.startsWith('depense') || b.categorie.type === 'remboursement_dette').reduce((s, b) => s + n(b.montantReel), 0);
      const ep  = mBudgets.filter(b => b.categorie.type.startsWith('epargne')).reduce((s, b) => s + n(b.montantReel), 0);
      dash.push([MOIS_LABELS[m], rev, dep, ep, rev - dep - ep]);
    }

    dash.push([]);
    dash.push(['DÉCAISSEMENTS']);
    dash.push(['Date', 'Description', 'Montant', ...comptes.map(c => c.nom)]);
    for (const d of decaissements) {
      const row = [
        new Date(d.dateOperation).toLocaleDateString('fr-FR'),
        d.description,
        n(d.montantTotal),
        ...comptes.map(c => {
          const r = d.repartitions.find(r => r.compteId === c.id);
          return r ? n(r.montant) : 0;
        }),
      ];
      dash.push(row);
    }

    const wsDash = XLSX.utils.aoa_to_sheet(dash);
    wsDash['!cols'] = [{ wch: 15 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(wb, wsDash, 'Tableau de bord');

    // ── ONGLET 2 : Suivi ───────────────────────
    const suivi: any[][] = [];
    suivi.push([`SUIVI BUDGÉTAIRE ${annee}`]);
    suivi.push([]);

    const headers = ['Catégorie', 'Type'];
    for (let m = 1; m <= 12; m++) {
      headers.push(`${MOIS_COURTS[m]} Anticipé`);
      headers.push(`${MOIS_COURTS[m]} Réel`);
    }
    headers.push('Total Anticipé', 'Total Réel', 'Écart');
    suivi.push(headers);

    for (const cat of categories) {
      const row: any[] = [cat.nom, TYPE_LABELS[cat.type as keyof typeof TYPE_LABELS]];
      let totAnt = 0, totReel = 0;
      for (let m = 1; m <= 12; m++) {
        const b = budgets.find(b => b.categorieId === cat.id && b.mois === m);
        const ant  = b ? n(b.montantAnticipe) : 0;
        const reel = b ? n(b.montantReel)     : 0;
        row.push(ant, reel);
        totAnt  += ant;
        totReel += reel;
      }
      row.push(totAnt, totReel, totReel - totAnt);
      suivi.push(row);
    }

    const wsSuivi = XLSX.utils.aoa_to_sheet(suivi);
    wsSuivi['!cols'] = [{ wch: 35 }, { wch: 25 }, ...Array(26).fill({ wch: 14 })];
    XLSX.utils.book_append_sheet(wb, wsSuivi, `Suivi-${annee}`);

    // ── ONGLET 3 : Récapitulatif ───────────────
    const recap: any[][] = [];
    recap.push([`RÉCAPITULATIF ANNUEL ${annee}`]);
    recap.push([]);
    recap.push(['Catégorie', 'Type', 'Moy. Anticipée/mois', 'Moy. Réelle/mois', 'Total Annuel', '% des Revenus']);

    const totalRevAnnuel = budgets
      .filter(b => b.categorie.type === 'revenu')
      .reduce((s, b) => s + n(b.montantReel), 0);

    for (const cat of categories) {
      const catBudgets = budgets.filter(b => b.categorieId === cat.id);
      const totAnt  = catBudgets.reduce((s, b) => s + n(b.montantAnticipe), 0);
      const totReel = catBudgets.reduce((s, b) => s + n(b.montantReel), 0);
      const moisAvecData = catBudgets.filter(b => n(b.montantReel) > 0).length || 1;
      const pct = totalRevAnnuel > 0 ? ((totReel / totalRevAnnuel) * 100).toFixed(1) + '%' : '0%';
      recap.push([
        cat.nom,
        TYPE_LABELS[cat.type as keyof typeof TYPE_LABELS],
        Math.round(totAnt / 12),
        Math.round(totReel / moisAvecData),
        totReel,
        pct,
      ]);
    }

    const wsRecap = XLSX.utils.aoa_to_sheet(recap);
    wsRecap['!cols'] = [{ wch: 35 }, { wch: 25 }, { wch: 20 }, { wch: 20 }, { wch: 18 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wsRecap, 'Récapitulatif');

    // ── ONGLET 4 : Budget mensuel ──────────────
    const budgetRef: any[][] = [];
    budgetRef.push(['BUDGET MENSUEL DE RÉFÉRENCE']);
    budgetRef.push([]);
    budgetRef.push(['Catégorie', 'Type', 'Montant Anticipé (référence)']);

    for (const cat of categories) {
      const derniereValeur = budgets
        .filter(b => b.categorieId === cat.id && n(b.montantAnticipe) > 0)
        .sort((a, b) => b.mois - a.mois)[0];
      budgetRef.push([
        cat.nom,
        TYPE_LABELS[cat.type as keyof typeof TYPE_LABELS],
        derniereValeur ? n(derniereValeur.montantAnticipe) : 0,
      ]);
    }

    const wsBudget = XLSX.utils.aoa_to_sheet(budgetRef);
    wsBudget['!cols'] = [{ wch: 35 }, { wch: 25 }, { wch: 25 }];
    XLSX.utils.book_append_sheet(wb, wsBudget, 'Budget mensuel');

    // Générer le fichier
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="GestBudget-${annee}.xlsx"`,
      },
    });

  } catch (e: any) {
    console.error('Export Excel:', e?.message);
    return NextResponse.json({ error: e?.message ?? 'Erreur export' }, { status: 500 });
  }
}
