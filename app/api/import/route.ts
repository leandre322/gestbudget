import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import ExcelJS from 'exceljs';
import { logAudit } from '@/lib/audit';

// ─────────────────────────────────────────────────────────────────────────────
// S10 / S3 — Import Excel, migre de xlsx@0.18.5 vers exceljs.
//
// Motif : xlsx@0.18.5 porte une vulnerabilite qui affecte la LECTURE de fichier.
// L'import est la seule surface ou un fichier non maitrise est parse, c'est donc
// la seule qui doit changer de parseur. L'export (/api/export/excel) continue
// d'utiliser xlsx : il n'ecrit que des donnees deja en base, aucun fichier
// externe n'y entre.
//
// Le format .xls (BIFF/CFB) est ABANDONNE. Ce n'est pas une regression subie
// mais l'objectif : supprimer un parseur binaire entier de la surface d'attaque.
// exceljs ne lit que .xlsx (ZIP + XML). Un .xls est refuse en amont, sur son
// extension ET sur ses octets d'en-tete, avant toute tentative de parsing.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Un classeur de 4 annees x 89 categories represente plusieurs milliers
// d'upserts : le defaut de 10 s ne suffit pas.
export const maxDuration = 60;

// Garde-fous d'entree. Un classeur de budget personnel depasse rarement 2 Mo.
const TAILLE_MAX_OCTETS = 8 * 1024 * 1024;
const NB_COLONNES = 26;         // Col B (nom) + 12 mois x 2 colonnes
const PREMIERE_LIGNE_DONNEES = 5; // 1-indexe cote exceljs (etait rowIdx 4 en 0-indexe)
const TAILLE_LOT = 25;          // upserts par transaction

// Signature OLE2 / CFB : un .xls renomme en .xlsx commence par ces octets.
const SIGNATURE_CFB = [0xd0, 0xcf, 0x11, 0xe0];
// Signature ZIP : tout .xlsx valide commence par PK..
const SIGNATURE_ZIP = [0x50, 0x4b];

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

// ── Extraction d'une valeur de cellule exceljs ───────────────────────────────
// Difference majeure avec sheet_to_json : exceljs ne renvoie pas des scalaires
// mais des objets typés pour les formules, le texte riche et les hyperliens.
// Une cellule de total calculee ({ formula, result }) serait devenue NaN puis 0
// sans cette normalisation — donc un import silencieusement vide.
function valeurCellule(v: any): any {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v !== 'object') return v;

  if ('result' in v) return valeurCellule((v as any).result); // formule
  if ('richText' in v) {
    return ((v as any).richText ?? []).map((t: any) => t.text ?? '').join('');
  }
  if ('text' in v) return (v as any).text;      // hyperlien
  if ('error' in v) return null;                // #REF!, #DIV/0!…
  return null;
}

// Construit une ligne DENSE de NB_COLONNES valeurs, index 0 = colonne A.
// exceljs renvoie des tableaux creux (1-indexes, avec des trous) sur lesquels
// .some() saute les cases vides : la detection de ligne de section serait
// faussee sans densification explicite.
function ligneDense(ws: ExcelJS.Worksheet, numLigne: number): any[] {
  const row = ws.getRow(numLigne);
  const out: any[] = [];
  for (let c = 1; c <= NB_COLONNES; c++) {
    out.push(valeurCellule(row.getCell(c).value));
  }
  return out;
}

function commencePar(octets: Uint8Array, signature: number[]): boolean {
  if (octets.length < signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (octets[i] !== signature[i]) return false;
  }
  return true;
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'Fichier manquant' }, { status: 400 });

    // ── Garde 1 : taille ────────────────────────────────────────────────────
    if (file.size > TAILLE_MAX_OCTETS) {
      return NextResponse.json(
        { error: `Fichier trop volumineux (max ${Math.round(TAILLE_MAX_OCTETS / 1024 / 1024)} Mo)` },
        { status: 413 }
      );
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'Fichier vide' }, { status: 400 });
    }

    // ── Garde 2 : extension ─────────────────────────────────────────────────
    const nomFichier = typeof file.name === 'string' ? file.name : '';
    const nomBas = nomFichier.toLowerCase();
    if (nomBas.endsWith('.xls')) {
      return NextResponse.json(
        { error: 'Le format .xls n\u2019est plus accepté. Enregistrez le classeur au format .xlsx puis réessayez.' },
        { status: 415 }
      );
    }
    if (!nomBas.endsWith('.xlsx')) {
      return NextResponse.json({ error: 'Format non supporté. Utilisez un fichier .xlsx' }, { status: 415 });
    }

    const buffer = await file.arrayBuffer();
    const octets = new Uint8Array(buffer);

    // ── Garde 3 : octets d'en-tete ──────────────────────────────────────────
    // L'extension est declarative, les octets ne le sont pas. Un .xls renomme
    // en .xlsx est refuse ici, avant que le moindre parseur ne le touche.
    if (commencePar(octets, SIGNATURE_CFB)) {
      return NextResponse.json(
        { error: 'Ce fichier est un .xls renommé. Enregistrez-le réellement au format .xlsx.' },
        { status: 415 }
      );
    }
    if (!commencePar(octets, SIGNATURE_ZIP)) {
      return NextResponse.json({ error: 'Fichier .xlsx invalide ou corrompu' }, { status: 400 });
    }

    // ── Lecture ─────────────────────────────────────────────────────────────
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer);
    } catch (e) {
      console.error('[POST /api/import] lecture classeur', e);
      return NextResponse.json({ error: 'Fichier .xlsx illisible' }, { status: 400 });
    }

    const categories = await prisma.categorie.findMany({
      where: { userId: session.user.id },
    });

    const anneesAChercher = [2024, 2025, 2026, 2027];
    const results: Record<number, { imported: number; skipped: number; matched: string[]; unmatched: string[] }> = {};

    for (const annee of anneesAChercher) {
      // Chercher l'onglet par nom exact ou partiel
      const ws = wb.worksheets.find((w) => {
        const sn = (w.name ?? '').toLowerCase().replace(/\s/g, '');
        return sn === `suivi-${annee}` || sn === `suivi${annee}` || sn === String(annee);
      });

      if (!ws) continue;
      if (ws.rowCount < PREMIERE_LIGNE_DONNEES) continue;

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
      // ...etc (2 colonnes par mois)
      // Les données commencent à la ligne 5.
      //
      // Les upserts sont accumules puis executes par lots dans une transaction :
      // l'ancienne version faisait un aller-retour Neon par cellule non nulle,
      // soit jusqu'a 12 x 89 x 4 requetes sequentielles.
      let lot: any[] = [];
      const viderLot = async () => {
        if (!lot.length) return;
        await prisma.$transaction(lot);
        lot = [];
      };

      for (let numLigne = PREMIERE_LIGNE_DONNEES; numLigne <= ws.rowCount; numLigne++) {
        const row = ligneDense(ws, numLigne);

        const nomExcel = String(row[1] ?? '').trim();
        if (!nomExcel || nomExcel.length < 2) continue;

        // Ignorer les lignes de section (en-têtes sans données numériques)
        const hasNumericData = row.slice(2, NB_COLONNES).some(
          (v) => v !== null && v !== '' && v !== undefined && !isNaN(Number(v))
        );
        if (!hasNumericData) continue;

        const cat = trouverCategorie(nomExcel, categories);
        if (!cat) {
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

          lot.push(
            prisma.budgetMensuel.upsert({
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
            })
          );
          imported++;

          if (lot.length >= TAILLE_LOT) await viderLot();
        }
      }

      await viderLot();

      results[annee] = { imported, skipped, matched, unmatched };
    }

    // Trace : un import ecrase des montants budgetaires sans confirmation ligne
    // a ligne. Sans entree d'audit, une reecriture massive est indetectable.
    await logAudit({
      userId:     session.user.id,
      action:     'import',
      entityType: 'budget',
      entityNom:  nomFichier.slice(0, 100),
      details:    {
        annees: Object.keys(results).map(Number),
        importes: Object.values(results).reduce((s, r) => s + r.imported, 0),
        ignores:  Object.values(results).reduce((s, r) => s + r.skipped, 0),
      },
      req,
    });

    return NextResponse.json({ success: true, results });

  } catch (e: any) {
    // Le message d'erreur reste cote serveur : e.message peut exposer un chemin,
    // une requete SQL ou une structure interne.
    console.error('[POST /api/import]', e?.message, e?.stack);
    return NextResponse.json({ error: 'Erreur lors de l\u2019import' }, { status: 500 });
  }
}
