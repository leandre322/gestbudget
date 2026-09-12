// =============================================================================
// lib/verrou-ecriture.ts  --  I69/P177 : verrou de mois centralise
// =============================================================================
// Meme regle que app/api/budget/route.ts (S15/⑩b v3), factorisee pour ne plus
// dependre de chaque route pour s en souvenir. estMoisVerrouille() reste la
// seule source de verite (lib/periode.ts) ; ce fichier n ajoute que la glue
// HTTP (423 pret a renvoyer) et la glue audit (details a etaler).
//
// Pas d appel logAudit ici : l appelant etale `derogationDetails` dans SON
// logAudit habituel, exactement comme budget/route.ts (une seule ecriture
// d audit par operation, pas une deuxieme dediee a la derogation).
//
// verrouMois() est pour les handlers qui peuvent `return` une NextResponse
// directement (POST/PUT hors transaction). Pour un refus a l interieur d un
// prisma.$transaction(), le retour de la transaction devient la VALEUR
// resolue, pas la reponse HTTP : ces call sites (DELETE de decaissements et
// banques/mouvements) importent estMoisVerrouille/messageVerrou/
// MOTIF_DEROGATION directement depuis lib/periode et font un throw local,
// capte par le catch existant de chaque route (meme idiome que NOT_FOUND,
// ROLLBACK_IMPOSSIBLE, etc.).
// =============================================================================

import { NextResponse } from 'next/server';
import { estMoisVerrouille, messageVerrou, MOTIF_DEROGATION } from '@/lib/periode';

/**
 * Lit forcerMoisVerrouille sur le body BRUT, avant Zod. Un schema qui ignore
 * ce champ le supprimerait silencieusement (meme defaut que P161) si on le
 * lisait sur le body parse.
 */
export function derogationDemandee(raw: unknown): boolean {
  return typeof raw === 'object' && raw !== null
    && (raw as Record<string, unknown>).forcerMoisVerrouille === true;
}

export interface VerrouResultat {
  verrouille: boolean;
  derogation: boolean;
  /** Pret a `return` tel quel si non-null : l ecriture doit s arreter la. */
  reponse423: NextResponse | null;
  /** A etaler dans les `details` du logAudit de l appelant. Objet vide si
   *  non concerne : aucun test supplementaire necessaire cote appelant. */
  derogationDetails: Record<string, unknown>;
}

export function verrouMois(annee: number, mois: number, derogation: boolean): VerrouResultat {
  const verrouille = estMoisVerrouille(annee, mois);

  if (!verrouille) {
    return { verrouille: false, derogation: false, reponse423: null, derogationDetails: {} };
  }

  if (!derogation) {
    return {
      verrouille, derogation: false,
      reponse423: NextResponse.json({ error: messageVerrou(annee, mois) }, { status: 423 }),
      derogationDetails: {},
    };
  }

  return {
    verrouille, derogation: true, reponse423: null,
    derogationDetails: { motif: MOTIF_DEROGATION, moisVerrouille: true },
  };
}
