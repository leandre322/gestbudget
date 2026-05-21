// =============================================
// GestBudget — Types TypeScript
// =============================================

export type TypeCategorie =
  | 'revenu'
  | 'epargne_precaution'
  | 'epargne_investissement'
  | 'epargne_autre'
  | 'depense_fixe'
  | 'depense_variable'
  | 'depense_occasionnelle'
  | 'remboursement_dette';

export const ORDRE_TYPES: TypeCategorie[] = [
  'revenu', 'epargne_precaution', 'epargne_investissement', 'epargne_autre',
  'depense_fixe', 'depense_variable', 'depense_occasionnelle', 'remboursement_dette',
];

export const TYPE_LABELS: Record<TypeCategorie, string> = {
  revenu:                 'Revenus',
  epargne_precaution:     'Épargne Précaution',
  epargne_investissement: 'Épargne Investissement',
  epargne_autre:          'Épargne de Fonctionnement',
  depense_fixe:           'Dépenses Fixes',
  depense_variable:       'Dépenses Variables',
  depense_occasionnelle:  'Dépenses Occasionnelles',
  remboursement_dette:    'Remboursements de Dettes',
};

export const TYPE_COLORS: Record<TypeCategorie, string> = {
  revenu:                 'bg-blue-50 text-blue-800 border-blue-200',
  epargne_precaution:     'bg-green-50 text-green-800 border-green-200',
  epargne_investissement: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  epargne_autre:          'bg-teal-50 text-teal-800 border-teal-200',
  depense_fixe:           'bg-red-50 text-red-800 border-red-200',
  depense_variable:       'bg-orange-50 text-orange-800 border-orange-200',
  depense_occasionnelle:  'bg-amber-50 text-amber-800 border-amber-200',
  remboursement_dette:    'bg-purple-50 text-purple-800 border-purple-200',
};

export const MOIS_LABELS = [
  '', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

export const MOIS_COURTS = [
  '', 'Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun',
  'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc',
];

// Label colonne "Anticipé" → "Prévision"
export const LABEL_PREVISION = 'Prévision';
export const LABEL_REEL      = 'Réel';
export const LABEL_ECART     = 'Écart';
export const LABEL_EXEC      = '% Exéc.';

// Format FCFA : 150 000 FCFA
export const formatFCFA = (montant: number | bigint): string => {
  const n = typeof montant === 'bigint' ? Number(montant) : montant;
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n) + ' FCFA';
};

// Calcul du score financier /20
export function calculerScore(params: {
  totalDepenses:     number;
  totalDepAnt:       number;
  totalEpargne:      number;
  totalRevenus:      number;
  solde:             number;
  fondsUrgence:      number;
  fondsObjectif:     number;
}): { score: number; details: ScoreDetail[] } {
  const { totalDepenses, totalDepAnt, totalEpargne, totalRevenus, solde, fondsUrgence, fondsObjectif } = params;

  const details: ScoreDetail[] = [];

  // Critère 1 : Respect budget dépenses (0–5)
  const ratio1 = totalDepAnt > 0
    ? Math.max(0, 1 - Math.max(0, totalDepenses - totalDepAnt) / totalDepAnt)
    : 1;
  const pts1 = Math.round(Math.min(5, ratio1 * 5));
  details.push({ label: 'Respect budget dépenses', pts: pts1, max: 5, icone: '💸' });

  // Critère 2 : Taux épargne ≥ 30% (0–5)
  const tauxEpargne = totalRevenus > 0 ? totalEpargne / totalRevenus : 0;
  const pts2 = Math.round(Math.min(5, (tauxEpargne / 0.30) * 5));
  details.push({ label: "Taux d'épargne (objectif 30%)", pts: pts2, max: 5, icone: '🐷' });

  // Critère 3 : Solde positif (0–5)
  const pts3 = solde >= 0
    ? 5
    : Math.max(0, Math.round(5 + (solde / Math.max(1, totalRevenus)) * 10));
  details.push({ label: 'Solde positif', pts: Math.min(5, pts3), max: 5, icone: '⚖️' });

  // Critère 4 : Fonds urgence ≥ 50% objectif (0–5)
  const ratio4 = fondsObjectif > 0 ? fondsUrgence / fondsObjectif : 0;
  const pts4 = Math.round(Math.min(5, (ratio4 / 0.5) * 5));
  details.push({ label: "Avancement fonds d'urgence", pts: pts4, max: 5, icone: '🛡️' });

  const score = details.reduce((s, d) => s + d.pts, 0);
  return { score, details };
}

export interface ScoreDetail {
  label:  string;
  pts:    number;
  max:    number;
  icone:  string;
}

// Couleur du score
export function couleurScore(score: number): string {
  if (score >= 16) return 'text-green-600';
  if (score >= 12) return 'text-blue-600';
  if (score >= 8)  return 'text-amber-500';
  return 'text-red-500';
}