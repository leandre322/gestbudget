import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import * as XLSX from 'xlsx';

// Normalise une chaîne : minuscules, sans accents, sans parenthèses
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Table de correspondance Excel → DB
const ALIASES: Record<string, string> = {
  'salaire net 1':                          'Salaire NET 1',
  'salaire net 2':                          'Salaire NET 2',
  'aide sociale':                           'Aide sociale',
  'revenus irreguliers':                    'Revenus irréguliers',
  'revenus locatifs':                       'Revenus locatifs',
  'autres':                                 'Autres revenus',
  'autres revenus':                         'Autres revenus',
  'epargne precaution':                     'Épargne Précaution - Banque 1',
  'banque yvan':                            'Épargne Précaution - Banque 1',
  'banque naelle':                          'Épargne Précaution - Banque 2',
  'epargne investissement':                 'Épargne Investissement (Tontine)',
  'tontine':                                'Épargne Investissement (Tontine)',
  'rentree enfants':                        'Rentrée Enfants',
  'sante':                                  'Santé',
  'voiture':                                'Entretien Voiture',
  'entretien voiture':                      'Entretien Voiture',
  'fete vacances':                          'Fête / Vacances',
  'fete  vacances':                         'Fête / Vacances',
  'habitation':                             'Habitation (Total)',
  'electricite':                            'Électricité',
  'eau':                                    'Eau',
  'internet':                               'Internet',
  'telephone':                              'Téléphone',
  'television netflix':                     'Télévision / Netflix / Canal+',
  'entretien maison':                       'Entretien Maison',
  'transport':                              'Transport (Total)',
  'carburation':                            'Carburation (voiture / moto)',
  'frais bancaires':                        'Frais bancaires',
  'assurance medicale':                     'Assurance médicale',
  'assurance vie':                          'Assurance vie',
  'allocation alimentaire':                 'Allocation alimentaire (maman)',
  'menagere':                               'Ménagère',
  'epicerie':                               'Épicerie / Dîner',
  'epicerie diner':                         'Épicerie / Dîner',
  'boisson maison':                         'Boisson Maison',
  'enfants petit dejeuner':                 'Enfants - Petit Déjeuner',
  'enfants transport':                      'Enfants - Transport domestique',
  'allocation leo':                         'Allocation Leo',
  'vetements adultes':                      'Vêtements Adultes',
  'vetements enfants':                      'Vêtements Enfants',
  'vacances':                               'Vacances et voyages',
  'vacances voyages':                       'Vacances et voyages',
  'cinema':                                 'Cinéma',
  'dons charite':                           'Dons de charité',
  'dime':                                   'Dîme / Don église',
  'dime don':                               'Dîme / Don église',
  'cadeaux':                                'Cadeaux anniversaires',
  'cotisations':                            'Cotisations professionnelles',
  'remboursement 1':                        'Remboursement dette 1',
  'remboursement 2':                        'Remboursement dette 2',
  'remboursement 3':                        'Remboursement dette 3',
};

function trouverCategorie(nomExcel: string, categories: any[]): any | null {
  const norm = normalize(nomExcel);
  if (!norm || norm.length < 2) return null;

  // 1. Correspondance exacte via alias
  if (ALIASES[norm]) {
    const cible = ALIASES[norm];
    return categories.find(c => c.nom === cible) ?? null;
  }

  // 2. Correspondance partielle alias (si la clé est contenue dans norm)
  for (const [key, val] of Object.entries(ALIASES)) {
    if (norm.includes(key) || key.includes(norm)) {
      const found = categories.find(c => c.nom === val);
      if (found) return found;
    }
  }

  // 3. Correspondance directe sur le nom normalisé de la catégorie DB
  for (const cat of categories) {
    const normCat = normalize(cat.nom);
    if (normCat === norm) return cat;
    if (normCat.includes(norm) || norm.includes(normCat)) return cat;
    // Correspondance sur les premiers mots
    const wordsExcel = norm.split(' ').filter(w => w.length > 3);
    const wordsCat   = normCat.split(' ').filter(w => w.length > 3);
    const common = wordsExcel.filter(w => wordsCat.includes(w));
    if (common.length >= 2) return cat;
    if (common.length === 1 && wordsCat.length === 1) return cat;
  }

  return null;
}

function toNum(v: any): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : Math.round(n);
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const formData = await req.formData();
    const file = formData.get('file') as File;
    if (!file) return NextResponse.json({ error: 'Fichier manquant' }, { status: 400 });

    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array', cellDates: true });

    console.log('Onglets trouvés:', wb.SheetNames);

    const categories = await prisma.categorie.findMany({
      where: { userId: session.user.id },
    });

    const anneesAChercher = [2024, 2025, 2026, 2027];
    const results: Record<number, { imported: number; skipped: number; matched: string[]; unmatched: string[] }> = {};

    for (const annee of anneesAChercher) {
      // Chercher l'onglet par nom exact ou partiel
      const sheetName = wb.SheetNames.find(s => {
        const sn = s.toLowerCase().replace(/\s/g, '');
        return sn === `suivi-${annee}` || sn === `suivi${annee}` || sn === String(annee);
      });

      if (!sheetName) continue;

      console.log(`Traitement onglet: ${sheetName} pour année ${annee}`);

      const ws = wb.Sheets[sheetName];
      // Lire comme tableau 2D avec header:1
      const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: null });

      console.log(`Nombre de lignes: ${rows.length}`);
      if (rows.length < 5) continue;

      // Récupérer ou créer l'année en DB
      let anneeRec = await prisma.annee.findUnique({
        where: { userId_annee: { userId: session.user.id, annee } },
      });
      if (!anneeRec) {
        anneeRec = await prisma.annee.create({
          data: { userId: session.user.id, annee },
        });
      }

      let imported = 0, skipped = 0;
      const matched: string[] = [];
      const unmatched: string[] = [];

      // Structure : Col B (index 1) = nom catégorie
      // Col C (index 2) = Jan Ant, Col D (index 3) = Jan Réel
      // Col E (index 4) = Fév Ant, Col F (index 5) = Fév Réel
      // ...etc (2 colonnes par mois)
      // Les données commencent à la ligne 5 (index 4)

      for (let rowIdx = 4; rowIdx < rows.length; rowIdx++) {
        const row = rows[rowIdx];
        if (!row || row.length < 3) continue;

        const nomExcel = String(row[1] ?? '').trim();
        if (!nomExcel || nomExcel.length < 2) continue;

        // Ignorer les lignes de section (en-têtes sans données numériques)
        const hasNumericData = row.slice(2, 26).some(v => v !== null && v !== '' && !isNaN(Number(v)));
        if (!hasNumericData) {
          console.log(`  Ligne ignorée (pas de données): "${nomExcel}"`);
          continue;
        }

        const cat = trouverCategorie(nomExcel, categories);
        if (!cat) {
          console.log(`  Non trouvé: "${nomExcel}" (norm: "${normalize(nomExcel)}")`);
          if (!unmatched.includes(nomExcel)) unmatched.push(nomExcel);
          skipped++;
          continue;
        }

        if (!matched.includes(cat.nom)) matched.push(cat.nom);

        for (let mois = 1; mois <= 12; mois++) {
          const colAnt  = 2 + (mois - 1) * 2;
          const colReel = 3 + (mois - 1) * 2;

          const ant  = toNum(row[colAnt]);
          const reel = toNum(row[colReel]);

          if (ant === 0 && reel === 0) continue;

          await prisma.budgetMensuel.upsert({
            where: {
              userId_anneeId_categorieId_mois: {
                userId: session.user.id,
                anneeId: anneeRec!.id,
                categorieId: cat.id,
                mois,
              },
            },
            update:  { montantAnticipe: BigInt(ant), montantReel: BigInt(reel) },
            create:  {
              userId:          session.user.id,
              anneeId:         anneeRec!.id,
              categorieId:     cat.id,
              mois,
              montantAnticipe: BigInt(ant),
              montantReel:     BigInt(reel),
            },
          });
          imported++;
        }
      }

      results[annee] = { imported, skipped, matched, unmatched };
      console.log(`Année ${annee}: ${imported} importés, ${skipped} ignorés`);
    }

    return NextResponse.json({ success: true, results });

  } catch (e: any) {
    console.error('Import Excel:', e?.message, e?.stack);
    return NextResponse.json({ error: e?.message ?? 'Erreur import' }, { status: 500 });
  }
}
