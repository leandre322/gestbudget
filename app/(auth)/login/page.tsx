'use client';

import { useState, useEffect, useCallback } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Mail, Lock, TrendingUp, AlertCircle, CheckCircle2 } from 'lucide-react';
import { clsx } from 'clsx';

// ── P7 : Indicateur de force de mot de passe ─────────────────────
function PasswordStrength({ password }: { password: string }) {
  if (!password) return null;
  const rules = [
    { label: '8 caractères',        ok: password.length >= 8 },
    { label: 'Majuscule',           ok: /[A-Z]/.test(password) },
    { label: 'Chiffre',             ok: /\d/.test(password) },
    { label: 'Caractère spécial',   ok: /[^a-zA-Z0-9]/.test(password) },
  ];
  const score = rules.filter(r => r.ok).length;
  const levels = ['', 'Faible', 'Moyen', 'Bon', 'Fort'];
  const colors = ['', 'bg-red-500', 'bg-orange-500', 'bg-amber-400', 'bg-green-500'];
  const textColors = ['', 'text-red-400', 'text-orange-400', 'text-amber-400', 'text-green-400'];

  return (
    <div className="mt-1.5 space-y-1.5">
      {/* Barre de progression */}
      <div className="flex gap-1">
        {[1,2,3,4].map(i => (
          <div key={i} className={clsx(
            'flex-1 h-1 rounded-full transition-all duration-300',
            i <= score ? colors[score] : 'bg-white/10'
          )} />
        ))}
      </div>
      {/* Label */}
      {score > 0 && (
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            {rules.map((r, i) => (
              <span key={i} className={clsx(
                'text-[10px] transition-colors',
                r.ok ? 'text-green-400' : 'text-white/30'
              )}>
                {r.ok ? '✓' : '·'} {r.label}
              </span>
            ))}
          </div>
          <span className={clsx('text-xs font-semibold', textColors[score])}>
            {levels[score]}
          </span>
        </div>
      )}
    </div>
  );
}

// ── P6 : Particules SVG légères (background cinématographique) ────
function Particles() {
  return (
    <svg
      className="fixed inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 0 }}
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="p1" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#3B82F6" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="p2" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#F59E0B" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="p3" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#8B5CF6" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#8B5CF6" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* Orbes principaux */}
      <ellipse cx="15%" cy="20%" rx="30vw" ry="25vh" fill="url(#p1)" opacity="0.18">
        <animate attributeName="opacity" values="0.12;0.22;0.12" dur="8s" repeatCount="indefinite" />
        <animate attributeName="cx" values="15%;18%;15%" dur="20s" repeatCount="indefinite" />
      </ellipse>
      <ellipse cx="85%" cy="80%" rx="25vw" ry="22vh" fill="url(#p2)" opacity="0.14">
        <animate attributeName="opacity" values="0.10;0.18;0.10" dur="11s" repeatCount="indefinite" />
        <animate attributeName="cy" values="80%;77%;80%" dur="25s" repeatCount="indefinite" />
      </ellipse>
      <ellipse cx="70%" cy="15%" rx="20vw" ry="18vh" fill="url(#p3)" opacity="0.10">
        <animate attributeName="opacity" values="0.08;0.14;0.08" dur="14s" repeatCount="indefinite" />
      </ellipse>
      {/* Petites étoiles/points */}
      {[
        [12,15],[88,22],[45,8],[75,92],[22,78],[55,55],[33,42],[68,35],
        [90,65],[8,58],[48,85],[80,48],[15,92],[60,18],[35,70],
      ].map(([cx, cy], i) => (
        <circle key={i} cx={`${cx}%`} cy={`${cy}%`} r="1.5"
          fill="white" opacity="0.15">
          <animate attributeName="opacity"
            values={`0.05;0.30;0.05`}
            dur={`${3 + (i % 4)}s`}
            begin={`${i * 0.3}s`}
            repeatCount="indefinite" />
        </circle>
      ))}
      {/* Lignes de connexion subtiles */}
      {[[12,15,45,8],[45,8,80,48],[88,22,75,92],[22,78,55,55]].map(([x1,y1,x2,y2], i) => (
        <line key={i}
          x1={`${x1}%`} y1={`${y1}%`}
          x2={`${x2}%`} y2={`${y2}%`}
          stroke="white" strokeWidth="0.5" opacity="0.04"
        />
      ))}
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [email,       setEmail]       = useState('');
  const [password,    setPassword]    = useState('');
  const [showPwd,     setShowPwd]     = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');
  const [mounted,     setMounted]     = useState(false);

  useEffect(() => {
    // Petite animation d'entrée
    const t = setTimeout(() => setMounted(true), 80);
    return () => clearTimeout(t);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) { setError('Veuillez remplir tous les champs.'); return; }
    setLoading(true);
    setError('');

    const result = await signIn('credentials', {
      email: email.trim(),
      password,
      redirect: false,
    });

    if (result?.ok) {
      router.push('/dashboard');
    } else {
      setError(result?.error === 'CredentialsSignin'
        ? 'Email ou mot de passe incorrect.'
        : 'Erreur de connexion. Réessayez.');
      setLoading(false);
    }
  };

  const inputCls = clsx(
    'w-full pl-10 pr-4 py-3 rounded-xl text-sm',
    'bg-white/8 dark:bg-white/5',
    'border border-white/15 dark:border-white/10',
    'text-white placeholder-white/40',
    'focus:border-blue-400/80 focus:bg-white/10',
    'focus:shadow-[0_0_0_3px_rgba(59,130,246,0.20)]',
    'transition-all duration-200 outline-none',
    'backdrop-blur-sm'
  );

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden">

      {/* Background sombre luxe */}
      <div className="fixed inset-0 bg-[#060914]" style={{ zIndex: -2 }} />

      {/* Particules animées — P6 */}
      <Particles />

      {/* Grille subtile */}
      <div className="fixed inset-0 pointer-events-none" style={{
        zIndex: 0,
        backgroundImage: `
          linear-gradient(rgba(59,130,246,0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(59,130,246,0.03) 1px, transparent 1px)
        `,
        backgroundSize: '60px 60px',
      }} />

      {/* ── Carte glass principale ── */}
      <div
        className={clsx(
          'relative z-10 w-full max-w-md mx-4',
          'transition-all duration-700 ease-out',
          mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
        )}
      >
        {/* Halo derrière la carte */}
        <div className="absolute -inset-4 rounded-3xl bg-gradient-to-r from-blue-600/15 via-purple-600/10 to-amber-500/10 blur-2xl" />

        <div className={clsx(
          'relative rounded-2xl overflow-hidden',
          'border border-white/10',
          'shadow-[0_25px_60px_rgba(0,0,0,0.60),inset_0_1px_0_rgba(255,255,255,0.07)]',
        )}
          style={{
            background: 'rgba(12, 18, 36, 0.80)',
            backdropFilter: 'blur(24px) saturate(160%)',
            WebkitBackdropFilter: 'blur(24px) saturate(160%)',
          }}
        >
          {/* Gradient top de la carte */}
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-blue-400/40 to-transparent" />

          <div className="p-8">
            {/* Logo */}
            <div className="flex flex-col items-center mb-8">
              <div className={clsx(
                'w-14 h-14 rounded-2xl mb-4',
                'flex items-center justify-center',
                'bg-gradient-to-br from-blue-500 to-blue-700',
                'shadow-[0_8px_24px_rgba(59,130,246,0.50)]',
                'ring-1 ring-blue-400/20',
                'animate-float'
              )}>
                <TrendingUp size={26} className="text-white" />
              </div>
              <h1 className="text-2xl font-bold text-white tracking-tight">
                GestBudget
              </h1>
              <p className="text-sm text-white/40 mt-1">
                Gestion budgétaire personnelle
              </p>
              {/* Ligne décorative dorée */}
              <div className="mt-3 flex items-center gap-2">
                <div className="h-px w-12 bg-gradient-to-r from-transparent to-amber-400/50" />
                <div className="w-1.5 h-1.5 rounded-full bg-amber-400/60" />
                <div className="h-px w-12 bg-gradient-to-l from-transparent to-amber-400/50" />
              </div>
            </div>

            {/* Formulaire */}
            <form onSubmit={handleSubmit} className="space-y-4">

              {/* Email */}
              <div>
                <label className="block text-xs font-medium text-white/50 mb-1.5 uppercase tracking-wide">
                  Adresse email
                </label>
                <div className="relative">
                  <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30" />
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="vous@example.com"
                    autoComplete="email"
                    required
                    className={inputCls}
                  />
                </div>
              </div>

              {/* Mot de passe */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-white/50 uppercase tracking-wide">
                    Mot de passe
                  </label>
                  <a href="/forgot-password"
                    className="text-xs text-blue-400/80 hover:text-blue-300 transition-colors">
                    Oublié ?
                  </a>
                </div>
                <div className="relative">
                  <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30" />
                  <input
                    type={showPwd ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    required
                    className={clsx(inputCls, 'pr-10')}
                  />
                  <button type="button" onClick={() => setShowPwd(!showPwd)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors">
                    {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {/* P7 : Force du mot de passe */}
                <PasswordStrength password={password} />
              </div>

              {/* Erreur */}
              {error && (
                <div className="flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm
                  bg-red-500/10 border border-red-500/20 text-red-300">
                  <AlertCircle size={15} className="flex-shrink-0" />
                  {error}
                </div>
              )}

              {/* Bouton connexion */}
              <button
                type="submit"
                disabled={loading}
                className={clsx(
                  'w-full py-3 rounded-xl text-sm font-semibold',
                  'bg-gradient-to-r from-blue-600 to-blue-500',
                  'text-white',
                  'shadow-[0_4px_20px_rgba(59,130,246,0.45)]',
                  'border border-blue-400/20',
                  'hover:from-blue-500 hover:to-blue-400',
                  'hover:shadow-[0_6px_28px_rgba(59,130,246,0.60)]',
                  'hover:-translate-y-0.5',
                  'transition-all duration-200',
                  'disabled:opacity-60 disabled:cursor-not-allowed disabled:transform-none',
                  'flex items-center justify-center gap-2'
                )}
              >
                {loading ? (
                  <><div className="spinner w-4 h-4" />Connexion...</>
                ) : (
                  <>Se connecter</>
                )}
              </button>
            </form>

            {/* Séparateur */}
            <div className="my-6 flex items-center gap-3">
              <div className="flex-1 h-px bg-white/8" />
              <span className="text-xs text-white/25">ou</span>
              <div className="flex-1 h-px bg-white/8" />
            </div>

            {/* Lien inscription */}
            <p className="text-center text-sm text-white/40">
              Pas encore de compte ?{' '}
              <a href="/register"
                className="text-blue-400 hover:text-blue-300 font-medium transition-colors">
                Créer un compte
              </a>
            </p>
          </div>

          {/* Gradient bas de la carte */}
          <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/8 to-transparent" />
        </div>

        {/* Badge sécurité */}
        <div className="flex items-center justify-center gap-1.5 mt-4">
          <CheckCircle2 size={12} className="text-green-400/60" />
          <span className="text-[11px] text-white/25">Connexion sécurisée · Données chiffrées</span>
        </div>
      </div>
    </div>
  );
}
