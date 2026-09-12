import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import type { Prisma } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { serial } from '@/lib/serial';
import { sendPushToUser } from '@/lib/push';
import { logAudit } from '@/lib/audit';
import { csrfCheck, validateBody } from '@/lib/api-helpers';
import { DecaissementSchema, DecaissementListeSchema } from '@/lib/validators';
import { appliquerMouvementBanque } from '@/lib/journal-banque';

// ─────────────────────────────────────────────────────────────────────────────
// S25 / F17 — modifications de ce fichier
//   Mode 'banque' (Q7, Q13) : depense payee depuis un compte bancaire, sans
//     fonds. Retrait uniquement ; le compte doit etre actif.
//   Journal (Q7) : toute jambe bancaire (modes 'banque' ET 'transfert') passe
//     par lib/journal-banque.ts, qui ecrit mouvements_banque dans la meme
//     transaction, avec decaissementId (Q19-a). Fin des ecritures non
//     journalisees de cette route (P10).
//   Colonne mode (Q8) : ecrite explicitement, relue par le DELETE. Aucune
//     deduction a partir des montants.
//   Verrous (I66) : fonds et banques sont verrouilles (SELECT ... FOR UPDATE)
//     avant lecture du solde. Ordre constant : fonds, puis banque, dans le
//     POST comme dans le DELETE, pour ecarter tout interblocage.
//   Annulation (Q14-b) : la jambe bancaire est compensee par une ligne de
//     type inverse, liee au decaissement ; la ligne d origine reste.
//   P175 : l annulation d une correction ('set', ecrite par
//     /api/comptes/correction) se fait par l ecart SIGNE
//     soldeApresFond - soldeAvantFond. L ancienne regle recreditait le fonds
//     et doublait donc une correction a la hausse au lieu de l annuler.
//   P170 : la notification affichait fond + banque, soit le double d un
//     transfert.
//   P171 : limit / offset / annee valides par Zod. Une annee sans ligne
//     Annee renvoie une liste vide (elle renvoyait toutes les annees).
//   Date : annee de l operation en UTC (alignement quick-add S24).
//
// Regle absolue inchangee : cette route n ecrit JAMAIS dans budget_mensuel.
// ─────────────────────────────────────────────────────────────────────────────

const ZERO = BigInt(0);
const fmt = (v: bigint) => Number(v).toLocaleString('fr-FR');

function erreur(message: string, code: number, details?: string): Error {
  return Object.assign(new Error(message), { code, details });
}

// ── Trouver ou creer l'enregistrement Annee ──────────────────────────────────
async function getOrCreateAnnee(tx: any, userId: string, annee: number) {
  let rec = await tx.annee.findUnique({
    where: { userId_annee: { userId, annee } },
  });
  if (!rec) rec = await tx.annee.create({ data: { userId, annee } });
  return rec;
}

// ── Verrou de ligne sur un fonds (I66) ───────────────────────────────────────
type FondVerrouille = { soldeActuel: bigint; nom: string };

async function verrouillerFond(
  tx: Prisma.TransactionClient,
  userId: string,
  compteId: string,
): Promise<FondVerrouille | null> {
  const lignes = await tx.$queryRaw<FondVerrouille[]>`
    SELECT "soldeActuel", nom
      FROM comptes_fonds
     WHERE id = ${compteId}
       AND "userId" = ${userId}
       FOR UPDATE`;
  return lignes[0] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/decaissements?annee=2026&limit=100&offset=0
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: 'Non authentifie' }, { status: 401 });

    const userId = session.user.id;
    const sp = new URL(req.url).searchParams;
    const q = DecaissementListeSchema.safeParse({
      limit:  sp.get('limit')  ?? undefined,
      offset: sp.get('offset') ?? undefined,
      annee:  sp.get('annee')  ?? undefined,
    });
    if (!q.success)
      return NextResponse.json({ error: 'Parametres de liste invalides' }, { status: 400 });
    const { limit, offset, annee } = q.data;

    let anneeId: string | null = null;
    if (annee !== undefined) {
      const anneeRec = await prisma.annee.findUnique({
        where: { userId_annee: { userId, annee } },
      });
      if (!anneeRec)
        return NextResponse.json(serial({ decaissements: [], total: 0, anneeId: null }));
      anneeId = anneeRec.id;
    }

    const where = { userId, ...(anneeId ? { anneeId } : {}) };

    const [decaissements, total] = await Promise.all([
      prisma.decaissement.findMany({
        where,
        include: {
          repartitions: { include: { compte: true } },
          banque:       { select: { nomBanque: true } },
        },
        orderBy: { dateOperation: 'desc' },
        take:    limit,
        skip:    offset,
      }),
      prisma.decaissement.count({ where }),
    ]);

    return NextResponse.json(serial({ decaissements, total, anneeId }));
  } catch (e: any) {
    // S7 : on logue le detail cote serveur, on ne le renvoie PAS au client
    console.error('GET /api/decaissements:', e?.message, e?.stack);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/decaissements
// Impact exclusif : comptes_fonds.soldeActuel et/ou banques.solde
// (+ mouvements_banque pour toute jambe bancaire)
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    // S7 : CSRF en defense en profondeur (le middleware couvre deja /api/*)
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

    const parsed = validateBody(DecaissementSchema, rawBody);
    if (parsed.error) return parsed.error;
    const {
      mode,
      description,
      dateOperation,
      notes,
      typeMouvement,
      compteId,
      banqueId,
      montantFond,
      montantBanque,
      sourceVocale,   // D1 — dictee vocale
    } = parsed.data;

    const mouvType = typeMouvement ?? 'retrait';
    const isAjout  = mouvType === 'ajout';

    const mtFond   = BigInt(Math.round(Math.max(0, Number(montantFond)   || 0)));
    const mtBanque = BigInt(Math.round(Math.max(0, Number(montantBanque) || 0)));

    const opDate  = new Date(dateOperation);
    const opAnnee = opDate.getUTCFullYear();

    // L intention vient du `mode` explicite (S7, Q8). Zod garantit deja la
    // coherence mode / identifiants / montants.
    const doFond   = mode !== 'banque' && !!compteId && mtFond   > ZERO;
    const doBanque = mode !== 'fond'   && !!banqueId && mtBanque > ZERO;

    if (!doFond && !doBanque)
      return NextResponse.json({ error: 'Saisissez au moins un montant' }, { status: 400 });

    let result: { decId: string; mouvementId: string | null } | undefined;

    try {
      result = await prisma.$transaction(async (tx) => {
        let soldeAvantFond: bigint | null = null;
        let soldeApresFond: bigint | null = null;

        // ── 1. Impact sur le fond (verrouille) ──────────────────────────
        if (doFond) {
          const compte = await verrouillerFond(tx, userId, compteId!);
          if (!compte) throw erreur('COMPTE_INTROUVABLE', 404);

          const avant = BigInt(compte.soldeActuel);
          if (!isAjout && avant < mtFond) {
            throw erreur('SOLDE_INSUFFISANT', 422,
              `${compte.nom} : disponible ${fmt(avant)} FCFA, demande ${fmt(mtFond)} FCFA`);
          }
          const apres = isAjout ? avant + mtFond : avant - mtFond;

          await tx.compteFonds.update({
            where: { id: compteId!, userId },
            data:  { soldeActuel: apres, updatedAt: new Date() },
          });
          soldeAvantFond = avant;
          soldeApresFond = apres;
        }

        // ── 2. Jambe bancaire, journalisee (verrouillee par le helper) ──
        //   'banque'    : depense payee depuis le compte -> retrait.
        //   'transfert' : contrepartie du fond. Retrait du fond -> la banque
        //                 recoit (ajout) ; ajout au fond -> la banque paie.
        let mouvementId: string | null = null;
        let soldeAvantBanque: bigint | null = null;
        let soldeApresBanque: bigint | null = null;

        if (doBanque) {
          const typeBanque = mode === 'banque' ? 'retrait' : (isAjout ? 'retrait' : 'ajout');
          const m = await appliquerMouvementBanque(tx, {
            userId,
            banqueId:      banqueId!,
            type:          typeBanque,
            montant:       mtBanque,
            motif:         'Decaissement : ' + description,
            dateOperation: opDate,
            exigerActive:  true,
          });
          mouvementId      = m.mouvementId;
          soldeAvantBanque = m.soldeAvant;
          soldeApresBanque = m.soldeApres;
        }

        // ── 3. Creer le decaissement ────────────────────────────────────
        const anneeRec = await getOrCreateAnnee(tx, userId, opAnnee);

        const dec = await tx.decaissement.create({
          data: {
            userId,
            anneeId:          anneeRec.id,
            description,
            dateOperation:    opDate,
            mode,
            montantTotal:     mode === 'banque' ? mtBanque : mtFond,
            montantFond:      doFond   ? mtFond   : ZERO,
            montantBanque:    doBanque ? mtBanque : ZERO,
            banqueId:         doBanque ? banqueId! : null,
            notes:            notes ?? null,
            typeMouvement:    mouvType,
            sourceVocale:     sourceVocale ?? false, // D1
            // S7 FIX : un solde a 0 est une valeur legitime, pas un "absent"
            soldeAvantFond,
            soldeApresFond,
            soldeAvantBanque,
            soldeApresBanque,
          },
        });

        // ── 4. Lien journal -> decaissement (Q19-a) ─────────────────────
        if (mouvementId) {
          await tx.mouvementBanque.update({
            where: { id: mouvementId },
            data:  { decaissementId: dec.id },
          });
        }

        // ── 5. Repartition fond ────────────────────────────────────────
        if (doFond) {
          await tx.decaissementCompte.create({
            data: { decaissementId: dec.id, compteId: compteId!, montant: mtFond },
          });
        }

        // ══ AUCUNE ECRITURE DANS budget_mensuel ══
        return { decId: dec.id, mouvementId };
      });
    } catch (txErr: any) {
      if (txErr.message === 'SOLDE_INSUFFISANT' || txErr.message === 'SOLDE_BANQUE_INSUFFISANT'
          || txErr.message === 'BANQUE_INACTIVE' || txErr.message === 'MONTANT_INVALIDE')
        return NextResponse.json({ error: txErr.details }, { status: 422 });
      if (txErr.message === 'COMPTE_INTROUVABLE')
        return NextResponse.json({ error: 'Compte introuvable' }, { status: 404 });
      if (txErr.message === 'BANQUE_INTROUVABLE')
        return NextResponse.json({ error: 'Banque introuvable' }, { status: 404 });
      throw txErr;
    }

    if (!result) throw new Error('TRANSACTION_SANS_RESULTAT');

    try {
      const montantNotif = Number(mode === 'banque' ? mtBanque : mtFond);   // P170
      await sendPushToUser(userId, {
        title: 'Decaissement enregistre',
        body:  description + ' — ' + montantNotif.toLocaleString('fr-FR') + ' FCFA',
        icon:  '/icons/icon-192.png',
        url:   '/decaissements',
        tag:   'decaissement',
      });
    } catch (e: any) {
      console.error('POST /api/decaissements push:', e?.message);   // non bloquant
    }

    await logAudit({
      userId,
      action:     'create',
      entityType: 'decaissement',
      entityId:   result.decId,
      entityNom:  description,
      details: {
        mode,
        typeMouvement: mouvType,
        montantFond:   Number(doFond ? mtFond : ZERO),
        montantBanque: Number(doBanque ? mtBanque : ZERO),
        banqueId:      doBanque ? banqueId : null,
        mouvementId:   result.mouvementId,
      },
      req,
    });

    return NextResponse.json(serial({ success: true, id: result.decId }), { status: 201 });
  } catch (e: any) {
    console.error('POST /api/decaissements:', e?.message, e?.stack);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/decaissements?id=xxx
// Rollback atomique. Fonds : restauration directe (ecart signe pour 'set').
// Banque : ligne compensatoire de type inverse (Q14-b), liee au decaissement.
// Refus explicite plutot qu un solde negatif.
// ─────────────────────────────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  try {
    const csrfErr = csrfCheck(req);
    if (csrfErr) return csrfErr;

    const session = await getServerSession(authOptions);
    if (!session?.user?.id)
      return NextResponse.json({ error: 'Non authentifie' }, { status: 401 });

    const userId = session.user.id;
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID manquant' }, { status: 400 });

    const resume = await prisma.$transaction(async (tx) => {
      const dec = await tx.decaissement.findFirst({
        where:   { id, userId },
        include: { repartitions: true },
      });
      if (!dec) throw erreur('NOT_FOUND', 404);

      const isAjout = dec.typeMouvement === 'ajout';
      const isSet   = dec.typeMouvement === 'set';

      // ── Reverser l'impact sur les fonds (verrouilles) ─────────────────
      for (const rep of dec.repartitions) {
        const repMt = BigInt(Number(rep.montant ?? 0));
        if (repMt === ZERO) continue;

        const compte = await verrouillerFond(tx, userId, rep.compteId);
        if (!compte) continue;

        const solde = BigInt(compte.soldeActuel);
        let rawApres: bigint;

        if (isSet) {
          // P175 — correction : on retire l ecart signe qu elle avait produit.
          if (dec.soldeAvantFond === null || dec.soldeApresFond === null) {
            throw erreur('ROLLBACK_IMPOSSIBLE', 422,
              `Annulation impossible : la correction de ${compte.nom} n a pas d historique de solde.`);
          }
          const delta = BigInt(dec.soldeApresFond) - BigInt(dec.soldeAvantFond);
          rawApres = solde - delta;
        } else {
          rawApres = isAjout ? solde - repMt : solde + repMt;
        }

        if (rawApres < ZERO) {
          throw erreur('ROLLBACK_IMPOSSIBLE', 422,
            `Annulation impossible : le fond ${compte.nom} tomberait a ${fmt(rawApres)} FCFA. Des operations posterieures ont deja consomme ce montant.`);
        }

        await tx.compteFonds.update({
          where: { id: rep.compteId, userId },
          data:  { soldeActuel: rawApres, updatedAt: new Date() },
        });
      }

      // ── Compenser la jambe bancaire (Q14-b) ──────────────────────────
      let compensationId: string | null = null;
      const mtBanque = BigInt(Number(dec.montantBanque ?? 0));

      if (dec.banqueId && mtBanque > ZERO && (dec.mode === 'banque' || dec.mode === 'transfert')) {
        const origine = dec.mode === 'banque' ? 'retrait' : (isAjout ? 'retrait' : 'ajout');
        const inverse = origine === 'retrait' ? 'ajout' : 'retrait';
        try {
          const m = await appliquerMouvementBanque(tx, {
            userId,
            banqueId:       dec.banqueId,
            type:           inverse,
            montant:        mtBanque,
            motif:          'Annulation : ' + dec.description,
            dateOperation:  new Date(),
            decaissementId: dec.id,
            exigerActive:   false,   // un compte desactive depuis doit rester recreditable
          });
          compensationId = m.mouvementId;
        } catch (e: any) {
          if (e?.message === 'SOLDE_BANQUE_INSUFFISANT')
            throw erreur('ROLLBACK_IMPOSSIBLE', 422, 'Annulation impossible : ' + e.details);
          throw e;
        }
      }

      await tx.decaissement.delete({ where: { id, userId } });

      return { mode: dec.mode, typeMouvement: dec.typeMouvement, description: dec.description, compensationId };
    });

    await logAudit({
      userId,
      action:     'delete',
      entityType: 'decaissement',
      entityId:   id,
      entityNom:  resume.description,
      details:    { mode: resume.mode, typeMouvement: resume.typeMouvement, compensationId: resume.compensationId },
      req,
    });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e.message === 'NOT_FOUND')
      return NextResponse.json({ error: 'Decaissement introuvable' }, { status: 404 });
    if (e.message === 'ROLLBACK_IMPOSSIBLE')
      return NextResponse.json({ error: e.details }, { status: 422 });
    if (e.message === 'BANQUE_INTROUVABLE')
      return NextResponse.json({ error: 'Banque introuvable' }, { status: 404 });
    console.error('DELETE /api/decaissements:', e?.message, e?.stack);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
