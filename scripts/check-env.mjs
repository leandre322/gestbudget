// =============================================================================
//  scripts/check-env.mjs - C1 (S26) : controle des variables d'environnement
//
//  Lance automatiquement avant chaque build ("prebuild" dans package.json).
//  - Production Vercel et build local : une erreur BLOQUE le build.
//  - Preview Vercel : les erreurs deviennent des avertissements.
//  - Aucune valeur n'est jamais affichee : seulement le nom et la regle.
//  Les fichiers .env* sont charges par @next/env, comme le fait next build.
//  Fichier 100 % ASCII.
// =============================================================================
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { z } from 'zod';

const racine = process.cwd();

try {
  const nextEnv = (await import('@next/env')).default;
  nextEnv.loadEnvConfig(racine, false, { info() {}, error() {} });
} catch {
  console.warn('check-env : @next/env introuvable, seules les variables deja presentes sont lues');
}

const vercelEnv = process.env.VERCEL_ENV;          // production | preview | development | undefined
const surVercel = Boolean(process.env.VERCEL);
const enProduction = vercelEnv === 'production';
const bloquant = vercelEnv !== 'preview';

// ---- Regles ------------------------------------------------------------------
function baseDe(v) {
  try {
    const u = new URL(v);
    if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') return null;
    return u;
  } catch {
    return null;
  }
}
const urlGestbudget = z.string().refine((v) => {
  const u = baseDe(v);
  return u !== null && u.pathname.replace(/^\//, '') === 'gestbudget';
});
const secret32 = z.string().min(32);
// Meme validation que lib/csrf.ts (E) : les deux doivent rester alignees.
const urlRapportCsp = z.string().refine((v) => {
  try {
    const u = new URL(v.trim());
    return u.protocol === 'https:'
      && /^o\d+\.ingest\.de\.sentry\.io$/.test(u.hostname)
      && u.port === '' && u.username === '' && u.password === ''
      && u.pathname.indexOf('/security/') !== -1
      && !/[;,"\\\s]/.test(u.href);
  } catch {
    return false;
  }
});

const regles = [
  { nom: 'DATABASE_URL',        schema: urlGestbudget, texte: 'URL postgres vers la base gestbudget', requis: true },
  { nom: 'EDGE_DATABASE_URL',   schema: urlGestbudget, texte: 'URL postgres vers la base gestbudget', requis: true },
  { nom: 'NEXTAUTH_SECRET',     schema: secret32,      texte: '32 caracteres minimum', requis: true },
  { nom: 'CRON_SECRET',         schema: secret32,      texte: '32 caracteres minimum', requis: true },
  { nom: 'TOTP_ENCRYPTION_KEY', schema: secret32,      texte: '32 caracteres minimum', requis: true },
  { nom: 'CSP_REPORT_URI',      schema: urlRapportCsp, texte: 'https://oNNN.ingest.de.sentry.io/.../security/...', requis: enProduction },
];

const erreurs = [];
const avertissements = [];

for (const r of regles) {
  const v = process.env[r.nom];
  if (v === undefined || v.trim() === '') {
    if (r.requis) erreurs.push(r.nom + ' : absente');
    continue;
  }
  if (!r.schema.safeParse(v).success) erreurs.push(r.nom + ' : invalide (attendu : ' + r.texte + ')');
}

for (const nom of ['DATABASE_URL', 'EDGE_DATABASE_URL']) {
  const u = process.env[nom] ? baseDe(process.env[nom]) : null;
  const ssl = u ? u.searchParams.get('sslmode') : null;
  if (u && ['require', 'verify-ca', 'verify-full'].indexOf(ssl) === -1) {
    avertissements.push(nom + ' : sslmode=require absent de l URL');
  }
}

// ---- .env.example doit declarer toute variable utilisee par le code ----------
const plateforme = /^(CI|NODE_ENV|NEXT_RUNTIME|VERCEL|VERCEL_.+|NEXT_PUBLIC_VERCEL_.+)$/;
const implicites = ['NEXTAUTH_URL'];               // lue par next-auth, jamais citee
const ignores = new Set(['node_modules', '.next', '.git', 'public', 'out', 'build', 'coverage']);
const utilisees = new Set(implicites);

function parcourir(dossier) {
  for (const e of readdirSync(dossier, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!ignores.has(e.name)) parcourir(join(dossier, e.name));
      continue;
    }
    if (['.ts', '.tsx', '.js', '.mjs', '.cjs'].indexOf(extname(e.name)) === -1) continue;
    const src = readFileSync(join(dossier, e.name), 'utf8');
    for (const m of src.matchAll(/process\.env\.([A-Z0-9_]+)/g)) utilisees.add(m[1]);
  }
}
parcourir(racine);
const schemaPrisma = join(racine, 'prisma', 'schema.prisma');
if (existsSync(schemaPrisma)) {
  for (const m of readFileSync(schemaPrisma, 'utf8').matchAll(/env\("([A-Z0-9_]+)"\)/g)) utilisees.add(m[1]);
}

const exemple = join(racine, '.env.example');
const declarees = new Set();
if (existsSync(exemple)) {
  for (const l of readFileSync(exemple, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=/.exec(l);
    if (m) declarees.add(m[1]);
  }
}
const manquantes = [...utilisees].filter((n) => !plateforme.test(n) && !declarees.has(n)).sort();
if (manquantes.length > 0) {
  const msg = '.env.example : variable(s) non declaree(s) : ' + manquantes.join(', ');
  // Documentation : bloquant en local seulement, jamais pour un deploiement.
  if (surVercel) avertissements.push(msg); else erreurs.push(msg);
}

// ---- Verdict ------------------------------------------------------------------
const contexte = surVercel ? 'Vercel ' + (vercelEnv || '?') : 'local';
for (const a of avertissements) console.warn('check-env : AVERTISSEMENT ' + a);
if (erreurs.length > 0) {
  const niveau = bloquant ? 'ERREUR' : 'AVERTISSEMENT (Preview)';
  for (const e of erreurs) console.error('check-env : ' + niveau + ' ' + e);
  if (bloquant) {
    console.error('check-env : BUILD BLOQUE (' + contexte + ')');
    process.exit(1);
  }
}
console.log('check-env : OK (' + contexte + ', ' + regles.length + ' regles, ' + utilisees.size + ' variables vues dans le code)');
