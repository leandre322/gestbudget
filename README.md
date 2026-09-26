# GestBudget

Application web de gestion de budget mensuel personnel.

## Stack technique
- **Frontend + Backend** : Next.js 14 (App Router) → Vercel
- **Base de données** : Neon PostgreSQL (base dédiée `gestbudget`)
- **ORM** : Prisma (migrations + types TypeScript auto)
- **Auth** : NextAuth.js (email/password + reset via Brevo)
- **Email** : Brevo SMTP (reset mot de passe + bienvenue)
- **PWA** : Installable sur mobile (Android + iOS)

---

## 🚀 Installation

### 1. Prérequis
- Node.js 18+
- Compte Neon (base `gestbudget` créée)
- Compte Brevo (SMTP configuré)

### 2. Cloner et installer
```bash
git clone <votre-repo>
cd gestbudget
npm install
```

### 3. Variables d'environnement
```bash
cp .env.example .env.local
# Remplissez les valeurs dans .env.local
```

### 4. Base de données Neon
```bash
# Créer les tables et l'enum
npx prisma db push

# Vérifier dans Prisma Studio
npx prisma studio
```

### 5. Lancer en développement
```bash
npm run dev
# → http://localhost:3000
```

---

## ⚠️ Action requise — Base de données

Votre connection string actuelle pointe vers `neondb`.
Une fois la base `gestbudget` créée sur Neon, mettez à jour `.env.local` :
```
DATABASE_URL="...../gestbudget?sslmode=require..."
DATABASE_URL_UNPOOLED="...../gestbudget?sslmode=require..."
```

---

## 📦 Déploiement Vercel

1. Pousser le code sur GitHub
2. Importer sur [vercel.com](https://vercel.com)
3. Ajouter toutes les variables d'environnement dans Vercel
4. Changer `NEXTAUTH_URL` par votre URL Vercel
5. Déployer → ✅

---

## 📱 Pages

| Route | Description |
|---|---|
| `/login` | Connexion |
| `/register` | Inscription (initialise catégories) |
| `/forgot-password` | Reset mot de passe |
| `/dashboard` | Tableau de bord KPIs + graphiques |
| `/suivi` | Saisie budget anticipé/réel |
| `/recapitulatif` | Récapitulatif annuel |
| `/budget` | Budget mensuel de référence |
| `/decaissements` | Journal des transactions multi-comptes |
| `/parametres` | Gestion catégories, comptes, paramètres |

---

## 🗄️ Tables Neon (via Prisma)

| Table | Description |
|---|---|
| `users` | Utilisateurs (email + password bcrypt) |
| `password_reset_tokens` | Tokens de reset (1h de validité) |
| `annees` | Années de budget avec objectif fonds urgence |
| `categories` | Catégories personnalisables |
| `budget_mensuel` | Budget anticipé + réel par mois |
| `comptes_fonds` | Comptes de fonds de roulement |
| `decaissements` | Journal des transactions |
| `decaissement_comptes` | Répartition multi-comptes |
| `banques` | Détails comptes bancaires |
| `parametres` | Paramètres utilisateur |

---

## 📊 Score financier /20

| Critère | Points | Condition |
|---|---|---|
| Respect budget dépenses | 0–5 | Réel ≤ anticipé |
| Taux d'épargne | 0–5 | Épargne ≥ 30% revenus |
| Solde positif | 0–5 | Solde ≥ 0 |
| Fonds d'urgence | 0–5 | Fonds ≥ 50% objectif |

---

## 🔒 Sécurité

- Mots de passe hashés avec **bcrypt** (12 rounds)
- Sessions JWT via **NextAuth.js**
- Reset tokens à usage unique, valides 1h
- Chaque utilisateur voit uniquement ses données (isolation par `userId`)

---

© 2026 GestBudget — Contact : Contact@lawdigitals.com
