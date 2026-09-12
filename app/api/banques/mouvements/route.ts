import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import prisma from '@/lib/prisma';
import { authOptions } from '@/lib/auth';
import { serial } from '@/lib/serial';
import { logAudit } from '@/lib/audit';
import { csrfCheck, validateBody } from '@/lib/api-helpers';
import { BanqueMouvementSchema, MouvementListeSchema } from '@/lib/validators';
import { appliquerMouvementBanque } from '@/lib/journal-banque';
import { verrouMois, derogationDemandee } from '@/lib/verrou-ecriture';
import { estMoisVerrouille, messageVerrou, MOTIF_DEROGATION } from '@/lib/periode';

// ─────────────────────────────────────────────────────────────────────────────
// S25 / F17 — modifications de ce fichier
//   I66  Le POST ne lit plus le solde pour le reecrire : il delegue a
//        lib/journal-banque.ts, seul ecrivain de banques.solde pour un
//        mouvement. Verrou FOR UPDATE : deux requetes simultanees sur le meme
//        compte ne peuvent plus se perdre l une l autre (double tap mobile).
//   Q22-a  Le GET masque par defaut les lignes nees d un decaissement
//        (decaissementId non nul) : l historique fusionne d Ajout / Retrait
//        Fonds affiche deja le decaissement lui-meme, la ligne de journal y
//        ferait doublon. ?inclureLies=1 les reaffiche (historique par compte).
//   Q24-b  Le DELETE refuse (409) une ligne liee a un decaissement. La
//        supprimer recrediterait la banque alors que le decaissement existe
//        toujours, puis son annulation recrediterait une seconde fois.
//        L annulation passe par DELETE /api/decaissements.
//   P171  limit / offset / banqueId valides par Zod (?limit=abc donnait
//        take: NaN, donc une erreur Prisma et un 500).
//   Verrou au DELETE : le rollback par delta lisait lui aussi le solde sans
//        verrou.
//
// S26 / I69-P177 — verrou de mois, en DEUX temps, meme regle et meme helper
//   que /api/decaissements :
//   POST : meme convention que /api/decaissements et /api/budget
//        (lib/verrou-ecriture.ts, forcerMoisVerrouille:true sur le body brut).
//   DELETE : verrou sur le mois de dateOperation du MOUVEMENT annule (pas la
//        date du jour), derogation possible via forcerMoisVerrouille=1 en
//        query param (pas de body sur ce DELETE).
//
// Le DELETE reste une suppression reelle pour les mouvements SAISIS a la main
// (aucun decaissement derriere) : c est le comportement existant, et la
// compensation Q14-b ne concerne que les lignes liees, desormais protegees.
// ─────────────────────────────────────────────────────────────────────────────

const ZERO = BigInt(0);
const fmt = (v: bigint) => Number(v).toLocaleString('fr-FR');

function erreur(message: string, code: number, details?: string): Error {
  return Object.assign(new Error(message), { code, details });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/banques/mouvements?limit=100&offset=0&banqueId=xxx&inclureLies=1
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: 'Non authentifie' }, { status: 401 });

    const userId = session.user.id;
    const sp = new URL(req.url).searchParams;
    const q = MouvementListeSchema.safeParse({
      limit:       sp.get('limit')       ?? undefined,
      offset:      sp.get('offset')      ?? undefined,
      banqueId:    sp.get('banqueId')    ?? undefined,
      inclureLies: sp.get('inclureLies') ?? undefined,
    });
    if (!q.success)
      return NextResponse.json({ error: 'Parametres de liste invalides' }, { status: 400 });
    const { limit, offset, banqueId, inclureLies } = q.data;

    const where = {
      userId,
      ...(banqueId ? { banqueId } : {}),
      ...(inclureLies === '1' ? {} : { decaissementId: null }),   // Q22-a
    };

    const [mouvements, total] = await Promise.all([
      prisma.mouvementBanque.findMany({
        where,
        include: { banque: { select: { nomBanque: true } } },
        orderBy: { dateOperation: 'desc' },
        take:    limit,
        skip:    offset,
      }),
      prisma.mouvementBanque.count({ where }),
    ]);

    return NextResponse.json(serial({ mouvements, total }));
  } catch (e: any) {
    // S7 : detail logue cote serveur, jamais renvoye au client
    console.error('GET /api/banques/mouvements:', e?.message, e?.stack);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/banques/mouvements
// Impact : banques.solde + mouvements_banque, dans une seule transaction
// Types supportes : ajout | retrait | set
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const csrfErr = csrfCheck(req);
    if (csrfErr) return csrfErr;

    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: 'Non authentifie' }, { status: 401 });

    const userId = session.user.id;

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return NextResponse.json({ error: 'Body JSON invalide' }, { status: 400 });
    }

    const parsed = validateBody(BanqueMouvementSchema, rawBody);
    if (parsed.error) return parsed.error;
    const { banqueId, typeMouvement, montant, motif, dateOperation } = parsed.data;

    const mt      = BigInt(Math.round(Math.max(0, Number(montant) || 0)));
    const opDate  = dateOperation ? new Date(dateOperation) : new Date();
    const opAnnee = opDate.getUTCFullYear();
    const opMois  = opDate.getUTCMonth() + 1;

    // I69/P177 : meme regle et meme helper que /api/decaissements.
    const verrou = verrouMois(opAnnee, opMois, derogationDemandee(rawBody));
    if (verrou.reponse423) return verrou.reponse423;

    let res: { mouvementId: string; nomBanque: string };

    try {
      res = await prisma.$transaction(async (tx) => {
        // I66 : verrou, ecriture du solde et journal, tout dans le helper.
        // exigerActive absent : une correction sur un compte desactive reste
        // possible, comportement historique de cette route.
        const m = await appliquerMouvementBanque(tx, {
          userId,
          banqueId,
          type:          typeMouvement,
          montant:       mt,
          motif:         motif?.trim() || null,
          dateOperation: opDate,
        });
        return { mouvementId: m.mouvementId, nomBanque: m.nomBanque };
      });
    } catch (txErr: any) {
      if (txErr.message === 'SOLDE_BANQUE_INSUFFISANT' || txErr.message === 'MONTANT_INVALIDE')
        return NextResponse.json({ error: txErr.details }, { status: 422 });
      if (txErr.message === 'BANQUE_INTROUVABLE')
        return NextResponse.json({ error: 'Banque introuvable' }, { status: 404 });
      throw txErr;
    }

    // S7 : cette route modifiait des soldes bancaires sans laisser de trace
    await logAudit({
      userId,
      action:     typeMouvement === 'set' ? 'update' : 'create',
      entityType: 'mouvement_banque',
      entityId:   res.mouvementId,
      entityNom:  motif?.trim() || typeMouvement,
      details:    { banqueId, nomBanque: res.nomBanque, typeMouvement, montant: Number(mt), ...verrou.derogationDetails },
      req,
    });

    return NextResponse.json(serial({ success: true, id: res.mouvementId }), { status: 201 });
  } catch (e: any) {
    console.error('POST /api/banques/mouvements:', e?.message, e?.stack);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/banques/mouvements?id=xxx&forcerMoisVerrouille=1
// S7 FIX CRITIQUE — rollback par DELTA.
//
// L'ancienne version restaurait `mvt.soldeAvant` en absolu. Ce snapshot n'est
// exact que pour le DERNIER mouvement du compte. Exemple :
//   solde 100 000 -> A (retrait 10 000, soldeAvant=100 000) -> B (ajout 50 000)
//   solde reel 140 000. Supprimer A ecrasait le solde a 100 000 :
//   l'ajout B de 50 000 disparaissait purement et simplement.
//
// Le delta compose correctement quel que soit l'ordre, et couvre les trois
// types (ajout / retrait / set) sans distinction de cas :
//   nouveauSolde = soldeActuel - (soldeApres - soldeAvant)
//
// S25 / Q24-b : refus 409 si la ligne vient d'un decaissement.
// S26 / I69-P177 : verrou sur le mois de dateOperation du MOUVEMENT annule,
//   derogation possible via forcerMoisVerrouille=1 en query param.
// ─────────────────────────────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  try {
    const csrfErr = csrfCheck(req);
    if (csrfErr) return csrfErr;

    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: 'Non authentifie' }, { status: 401 });

    const userId = session.user.id;
    const searchParams = new URL(req.url).searchParams;
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID manquant' }, { status: 400 });
    const derogationQ = searchParams.get('forcerMoisVerrouille') === '1';

    const { nomBanque, derogationDetails } = await prisma.$transaction(async (tx) => {
      const mvt = await tx.mouvementBanque.findFirst({ where: { id, userId } });
      if (!mvt) throw erreur('NOT_FOUND', 404);

      if (mvt.decaissementId) {
        throw erreur('LIGNE_LIEE', 409,
          'Cette ligne provient d un decaissement. Annulez le decaissement depuis la page Decaissements : le compte sera recredite et la trace conservee.');
      }

      // I69/P177 : le mois du MOUVEMENT annule fait foi, pas la date du jour.
      const mvtDate  = new Date(mvt.dateOperation);
      const mvtAnnee = mvtDate.getUTCFullYear();
      const mvtMois  = mvtDate.getUTCMonth() + 1;
      const moisVerrouille = estMoisVerrouille(mvtAnnee, mvtMois);
      if (moisVerrouille && !derogationQ) {
        throw erreur('MOIS_VERROUILLE', 423, messageVerrou(mvtAnnee, mvtMois));
      }

      // Verrou de ligne avant lecture du solde (I66).
      const lignes = await tx.$queryRaw<{ solde: bigint; nomBanque: string }[]>`
        SELECT solde, "nomBanque"
          FROM banques
         WHERE id = ${mvt.banqueId}
           AND "userId" = ${userId}
           FOR UPDATE`;
      if (lignes.length === 0) throw erreur('BANQUE_INTROUVABLE', 404);

      const soldeActuel = BigInt(lignes[0].solde);
      const delta       = BigInt(mvt.soldeApres ?? ZERO) - BigInt(mvt.soldeAvant ?? ZERO);
      const rawApres    = soldeActuel - delta;

      if (rawApres < ZERO) {
        throw erreur('ROLLBACK_NEGATIF', 422,
          `Annulation impossible : ${lignes[0].nomBanque} tomberait a ${fmt(rawApres)} FCFA. Des operations posterieures ont deja consomme ce montant.`);
      }

      await tx.banque.update({
        where: { id: mvt.banqueId, userId },
        data:  { solde: rawApres, updatedAt: new Date() },
      });

      await tx.mouvementBanque.delete({ where: { id } });

      return {
        nomBanque: lignes[0].nomBanque,
        derogationDetails: moisVerrouille ? { motif: MOTIF_DEROGATION, moisVerrouille: true } : {},
      };
    });

    await logAudit({
      userId,
      action:     'delete',
      entityType: 'mouvement_banque',
      entityId:   id,
      entityNom:  nomBanque,
      details:    derogationDetails,
      req,
    });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e.message === 'NOT_FOUND')
      return NextResponse.json({ error: 'Mouvement introuvable' }, { status: 404 });
    if (e.message === 'BANQUE_INTROUVABLE')
      return NextResponse.json({ error: 'Banque introuvable' }, { status: 404 });
    if (e.message === 'LIGNE_LIEE')
      return NextResponse.json({ error: e.details }, { status: 409 });
    if (e.message === 'MOIS_VERROUILLE')
      return NextResponse.json({ error: e.details }, { status: 423 });
    if (e.message === 'ROLLBACK_NEGATIF')
      return NextResponse.json({ error: e.details }, { status: 422 });
    console.error('DELETE /api/banques/mouvements:', e?.message, e?.stack);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
