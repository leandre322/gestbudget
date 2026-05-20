// =============================================
// GestBudget — Initialisation compte utilisateur
// Appelé à la création d'un nouveau compte
// =============================================

import prisma from './prisma';
import { TypeCategorie } from '@prisma/client';

export async function initUserData(userId: string) {
  // ── Catégories par défaut ──────────────────
  const categories = [
    // REVENUS
    { nom: 'Salaire NET 1',                    type: TypeCategorie.revenu,                  sousType: 'Revenus',                  ordre: 1   },
    { nom: 'Salaire NET 2',                    type: TypeCategorie.revenu,                  sousType: 'Revenus',                  ordre: 2   },
    { nom: 'Aide sociale',                     type: TypeCategorie.revenu,                  sousType: 'Revenus',                  ordre: 3   },
    { nom: 'Revenus irréguliers',              type: TypeCategorie.revenu,                  sousType: 'Revenus',                  ordre: 4   },
    { nom: 'Revenus locatifs',                 type: TypeCategorie.revenu,                  sousType: 'Revenus',                  ordre: 5   },
    { nom: 'Autres revenus',                   type: TypeCategorie.revenu,                  sousType: 'Revenus',                  ordre: 6   },
    // ÉPARGNE PRÉCAUTION
    { nom: 'Épargne Précaution - Banque 1',    type: TypeCategorie.epargne_precaution,      sousType: 'Épargne Précaution',       ordre: 10  },
    { nom: 'Épargne Précaution - Banque 2',    type: TypeCategorie.epargne_precaution,      sousType: 'Épargne Précaution',       ordre: 11  },
    // ÉPARGNE AUTRES
    { nom: 'Rentrée Enfants',                  type: TypeCategorie.epargne_autre,           sousType: 'Épargne Autres',           ordre: 20  },
    { nom: 'Santé',                            type: TypeCategorie.epargne_autre,           sousType: 'Épargne Autres',           ordre: 21  },
    { nom: 'Entretien Voiture',                type: TypeCategorie.epargne_autre,           sousType: 'Épargne Autres',           ordre: 22  },
    { nom: 'Fête / Vacances',                  type: TypeCategorie.epargne_autre,           sousType: 'Épargne Autres',           ordre: 23  },
    { nom: 'Assur / Visite Tech / TVM Voiture',type: TypeCategorie.epargne_autre,           sousType: 'Épargne Autres',           ordre: 24  },
    // ÉPARGNE INVESTISSEMENT
    { nom: 'Épargne Investissement (Tontine)', type: TypeCategorie.epargne_investissement,  sousType: 'Épargne Investissement',   ordre: 30  },
    { nom: 'Projet spécial 1',                 type: TypeCategorie.epargne_investissement,  sousType: 'Épargne Investissement',   ordre: 31  },
    { nom: 'Projet spécial 2',                 type: TypeCategorie.epargne_investissement,  sousType: 'Épargne Investissement',   ordre: 32  },
    // DÉPENSES FIXES — Habitation
    { nom: 'Habitation (Total)',               type: TypeCategorie.depense_fixe,            sousType: 'Habitation',               ordre: 40  },
    { nom: 'Électricité',                      type: TypeCategorie.depense_fixe,            sousType: 'Habitation',               ordre: 41  },
    { nom: 'Eau',                              type: TypeCategorie.depense_fixe,            sousType: 'Habitation',               ordre: 42  },
    { nom: 'Internet',                         type: TypeCategorie.depense_fixe,            sousType: 'Habitation',               ordre: 43  },
    { nom: 'Téléphone',                        type: TypeCategorie.depense_fixe,            sousType: 'Habitation',               ordre: 44  },
    { nom: 'Télévision / Netflix / Canal+',    type: TypeCategorie.depense_fixe,            sousType: 'Habitation',               ordre: 45  },
    { nom: 'Entretien Maison',                 type: TypeCategorie.depense_fixe,            sousType: 'Habitation',               ordre: 46  },
    // DÉPENSES FIXES — Transport
    { nom: 'Transport (Total)',                type: TypeCategorie.depense_fixe,            sousType: 'Transport',                ordre: 50  },
    { nom: 'Carburation (voiture / moto)',     type: TypeCategorie.depense_fixe,            sousType: 'Transport',                ordre: 51  },
    // DÉPENSES FIXES — Frais
    { nom: 'Frais bancaires',                  type: TypeCategorie.depense_fixe,            sousType: 'Frais et assurances',      ordre: 60  },
    { nom: 'Assurance médicale',               type: TypeCategorie.depense_fixe,            sousType: 'Frais et assurances',      ordre: 61  },
    { nom: 'Assurance vie',                    type: TypeCategorie.depense_fixe,            sousType: 'Frais et assurances',      ordre: 62  },
    // DÉPENSES FIXES — Personnes à charge
    { nom: 'Allocation alimentaire (maman)',   type: TypeCategorie.depense_fixe,            sousType: 'Personnes à charge',       ordre: 70  },
    { nom: 'Ménagère',                         type: TypeCategorie.depense_fixe,            sousType: 'Personnes à charge',       ordre: 71  },
    // DÉPENSES VARIABLES — Alimentation
    { nom: 'Épicerie / Dîner',                 type: TypeCategorie.depense_variable,        sousType: 'Alimentation',             ordre: 80  },
    { nom: 'Boisson Maison',                   type: TypeCategorie.depense_variable,        sousType: 'Alimentation',             ordre: 81  },
    { nom: 'Enfants - Petit Déjeuner',         type: TypeCategorie.depense_variable,        sousType: 'Alimentation',             ordre: 82  },
    { nom: 'Enfants - Transport domestique',   type: TypeCategorie.depense_variable,        sousType: 'Alimentation',             ordre: 83  },
    { nom: 'Allocation Leo',                   type: TypeCategorie.depense_variable,        sousType: 'Alimentation',             ordre: 84  },
    // DÉPENSES VARIABLES — Vêtements
    { nom: 'Vêtements Adultes',                type: TypeCategorie.depense_variable,        sousType: 'Vêtements & Shopping',     ordre: 90  },
    { nom: 'Vêtements Enfants',                type: TypeCategorie.depense_variable,        sousType: 'Vêtements & Shopping',     ordre: 91  },
    // DÉPENSES VARIABLES — Sorties
    { nom: 'Vacances et voyages',              type: TypeCategorie.depense_variable,        sousType: 'Sorties & Loisirs',        ordre: 100 },
    { nom: 'Cinéma',                           type: TypeCategorie.depense_variable,        sousType: 'Sorties & Loisirs',        ordre: 101 },
    // DÉPENSES VARIABLES — Dons
    { nom: 'Dons de charité',                  type: TypeCategorie.depense_variable,        sousType: 'Dons & Cadeaux',           ordre: 110 },
    { nom: 'Dîme / Don église',                type: TypeCategorie.depense_variable,        sousType: 'Dons & Cadeaux',           ordre: 111 },
    { nom: 'Cadeaux anniversaires',            type: TypeCategorie.depense_variable,        sousType: 'Dons & Cadeaux',           ordre: 112 },
    // DÉPENSES OCCASIONNELLES
    { nom: 'Cotisations professionnelles',     type: TypeCategorie.depense_occasionnelle,   sousType: 'Dépenses occasionnelles',  ordre: 120 },
    { nom: 'Autre dépense 1',                  type: TypeCategorie.depense_occasionnelle,   sousType: 'Dépenses occasionnelles',  ordre: 121 },
    { nom: 'Autre dépense 2',                  type: TypeCategorie.depense_occasionnelle,   sousType: 'Dépenses occasionnelles',  ordre: 122 },
    // REMBOURSEMENTS
    { nom: 'Remboursement dette 1',            type: TypeCategorie.remboursement_dette,     sousType: 'Remboursements',           ordre: 130 },
    { nom: 'Remboursement dette 2',            type: TypeCategorie.remboursement_dette,     sousType: 'Remboursements',           ordre: 131 },
    { nom: 'Remboursement dette 3',            type: TypeCategorie.remboursement_dette,     sousType: 'Remboursements',           ordre: 132 },
  ];

  await prisma.categorie.createMany({
    data: categories.map(c => ({ ...c, userId })),
    skipDuplicates: true,
  });

  // ── Comptes de fonds de roulement ──────────
  await prisma.compteFonds.createMany({
    data: [
      { userId, nom: 'Rentrée Enfants', ordre: 1 },
      { userId, nom: 'Santé',           ordre: 2 },
      { userId, nom: 'Voiture',         ordre: 3 },
      { userId, nom: 'Fête / Vacances', ordre: 4 },
      { userId, nom: 'Yvan',            ordre: 5 },
      { userId, nom: 'Naelle',          ordre: 6 },
    ],
    skipDuplicates: true,
  });

  // ── Paramètres par défaut ──────────────────
  await prisma.parametres.upsert({
    where:  { userId },
    update: {},
    create: { userId },
  });
}
