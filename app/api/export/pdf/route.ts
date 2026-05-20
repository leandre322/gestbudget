import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { MOIS_LABELS, TYPE_LABELS } from '@/types';

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
    const mois  = parseInt(searchParams.get('mois')  ?? String(new Date().getMonth() + 1));

    const anneeRec = await prisma.annee.findUnique({
      where: { userId_annee: { userId: session.user.id, annee } },
    });
    if (!anneeRec) return NextResponse.json({ error: 'Année non trouvée' }, { status: 404 });

    const categories = await prisma.categorie.findMany({
      where: { userId: session.user.id, isActive: true },
      orderBy: { ordre: 'asc' },
    });

    const budgets = await prisma.budgetMensuel.findMany({
      where: { userId: session.user.id, anneeId: anneeRec.id, mois },
      include: { categorie: true },
    });

    // ── Créer le PDF ───────────────────────────
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    // En-tête
    doc.setFillColor(30, 64, 175);
    doc.rect(0, 0, 210, 35, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.text('GestBudget', 15, 15);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text(`Rapport mensuel — ${MOIS_LABELS[mois]} ${annee}`, 15, 25);
    doc.setFontSize(9);
    doc.text(`Généré le ${new Date().toLocaleDateString('fr-FR')}`, 150, 25);

    doc.setTextColor(30, 41, 59);

    // KPIs
    const rev  = budgets.filter(b => b.categorie.type === 'revenu').reduce((s, b) => s + n(b.montantReel), 0);
    const dep  = budgets.filter(b => b.categorie.type.startsWith('depense') || b.categorie.type === 'remboursement_dette').reduce((s, b) => s + n(b.montantReel), 0);
    const ep   = budgets.filter(b => b.categorie.type.startsWith('epargne')).reduce((s, b) => s + n(b.montantReel), 0);
    const solde = rev - dep - ep;
    const tauxEp = rev > 0 ? ((ep / rev) * 100).toFixed(1) : '0';

    let y = 45;
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text('Résumé du mois', 15, y);
    y += 8;

    const kpis = [
      ['Revenus réels',   fmt(rev),   '#10B981'],
      ['Dépenses réelles',fmt(dep),   '#EF4444'],
      ['Épargne réelle',  fmt(ep),    '#3B82F6'],
      ['Solde du mois',   fmt(solde), solde >= 0 ? '#10B981' : '#EF4444'],
    ];

    const colW = 45;
    kpis.forEach(([label, val, color], i) => {
      const x = 15 + i * colW;
      const [r, g, b] = color === '#10B981' ? [16,185,129] : color === '#EF4444' ? [239,68,68] : [59,130,246];
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(x, y, 42, 22, 2, 2, 'F');
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      doc.text(label, x + 3, y + 7);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(r, g, b);
      doc.text(val, x + 3, y + 17);
    });
    doc.setTextColor(30, 41, 59);
    y += 30;

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`Taux d'épargne : ${tauxEp}% (objectif : 30%)`, 15, y);
    y += 10;

    // Tableau détaillé par type
    const typeOrder = ['revenu','epargne_precaution','epargne_investissement','epargne_autre','depense_fixe','depense_variable','depense_occasionnelle','remboursement_dette'];

    for (const type of typeOrder) {
      const catsDuType = categories.filter(c => c.type === type);
      if (catsDuType.length === 0) continue;

      const rows = catsDuType.map(cat => {
        const b = budgets.find(b => b.categorieId === cat.id);
        const ant  = b ? n(b.montantAnticipe) : 0;
        const reel = b ? n(b.montantReel)     : 0;
        const ecar = reel - ant;
        const pct  = ant > 0 ? `${((reel / ant) * 100).toFixed(0)}%` : '—';
        return [cat.nom, fmt(ant), fmt(reel), (ecar >= 0 ? '+' : '') + fmt(ecar), pct];
      });

      const totAnt  = catsDuType.reduce((s, c) => { const b = budgets.find(b => b.categorieId === c.id); return s + (b ? n(b.montantAnticipe) : 0); }, 0);
      const totReel = catsDuType.reduce((s, c) => { const b = budgets.find(b => b.categorieId === c.id); return s + (b ? n(b.montantReel) : 0); }, 0);
      rows.push(['SOUS-TOTAL', fmt(totAnt), fmt(totReel), (totReel - totAnt >= 0 ? '+' : '') + fmt(totReel - totAnt), '']);

      autoTable(doc, {
        startY: y,
        head: [[TYPE_LABELS[type as keyof typeof TYPE_LABELS] ?? type, 'Anticipé', 'Réel', 'Écart', '% Exéc.']],
        body: rows,
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [30, 64, 175], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        footStyles: { fontStyle: 'bold' },
        columnStyles: {
          0: { cellWidth: 70 },
          1: { cellWidth: 35, halign: 'right' },
          2: { cellWidth: 35, halign: 'right' },
          3: { cellWidth: 30, halign: 'right' },
          4: { cellWidth: 15, halign: 'right' },
        },
        didDrawPage: (data) => { y = data.cursor?.y ?? y; },
      });

      y = (doc as any).lastAutoTable.finalY + 5;
      if (y > 260) { doc.addPage(); y = 20; }
    }

    // Pied de page
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(`GestBudget — ${MOIS_LABELS[mois]} ${annee} — Page ${i}/${pages}`, 15, 290);
      doc.text('© 2026 LAWDIGITALS', 160, 290);
    }

    const pdfBuffer = Buffer.from(doc.output('arraybuffer'));

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="GestBudget-${annee}-${String(mois).padStart(2,'0')}.pdf"`,
      },
    });

  } catch (e: any) {
    console.error('Export PDF:', e?.message);
    return NextResponse.json({ error: e?.message ?? 'Erreur export PDF' }, { status: 500 });
  }
}
