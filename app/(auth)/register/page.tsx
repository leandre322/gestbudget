'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff, UserPlus, AlertCircle, CheckCircle } from 'lucide-react';

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm]     = useState({ email: '', password: '', confirm: '', nom: '' });
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [success, setSuccess] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirm) { setError('Les mots de passe ne correspondent pas.'); return; }
    if (form.password.length < 8) { setError('Minimum 8 caractères.'); return; }
    setLoading(true);

    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: form.email, password: form.password, nom: form.nom }),
    });
    const data = await res.json();

    if (!res.ok) { setError(data.error ?? "Erreur lors de l'inscription."); setLoading(false); return; }

    setSuccess(true);
    setLoading(false);
  };

  if (success) return (
    <div className="min-h-screen bg-gradient-to-br from-primary-dark via-primary to-primary-light flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full text-center">
        <CheckCircle className="w-16 h-16 text-success mx-auto mb-4" />
        <h2 className="text-xl font-bold text-slate-800 mb-2">Compte créé avec succès !</h2>
        <p className="text-slate-500 mb-6 text-sm">Vos catégories et comptes ont été initialisés. Vous pouvez vous connecter.</p>
        <Link href="/login"
          className="inline-block bg-primary text-white font-medium rounded-xl px-6 py-2.5 hover:bg-primary-dark transition-all">
          Se connecter
        </Link>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-dark via-primary to-primary-light flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-2xl shadow-lg mb-4">
            <span className="text-3xl">💰</span>
          </div>
          <h1 className="text-3xl font-bold text-white">GestBudget</h1>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-xl font-semibold text-slate-800 mb-6">Créer un compte</h2>

          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-600 rounded-xl p-3 mb-5 text-sm">
              <AlertCircle size={16} className="flex-shrink-0" />{error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {[
              { name: 'nom',     label: 'Nom complet',     type: 'text',     placeholder: 'Prénom Nom' },
              { name: 'email',   label: 'Adresse email',   type: 'email',    placeholder: 'votre@email.com' },
            ].map(f => (
              <div key={f.name}>
                <label className="block text-sm font-medium text-slate-700 mb-1">{f.label}</label>
                <input type={f.type} name={f.name} value={(form as any)[f.name]} onChange={handleChange}
                  placeholder={f.placeholder} required={f.name === 'email'}
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:border-primary focus:ring-2 focus:ring-blue-100 outline-none transition-all" />
              </div>
            ))}

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Mot de passe</label>
              <div className="relative">
                <input type={showPwd ? 'text' : 'password'} name="password" value={form.password} onChange={handleChange}
                  placeholder="Minimum 8 caractères" required
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 pr-10 text-sm focus:border-primary focus:ring-2 focus:ring-blue-100 outline-none transition-all" />
                <button type="button" onClick={() => setShowPwd(!showPwd)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                  {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Confirmer le mot de passe</label>
              <input type="password" name="confirm" value={form.confirm} onChange={handleChange}
                placeholder="Répétez votre mot de passe" required
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:border-primary focus:ring-2 focus:ring-blue-100 outline-none transition-all" />
            </div>

            <button type="submit" disabled={loading}
              className="w-full bg-primary hover:bg-primary-dark text-white font-medium rounded-xl py-2.5 flex items-center justify-center gap-2 transition-all disabled:opacity-60">
              {loading ? <div className="spinner" /> : <><UserPlus size={17} />Créer mon compte</>}
            </button>
          </form>

          <p className="text-center text-sm text-slate-400 mt-6">
            Déjà un compte ?{' '}
            <Link href="/login" className="text-primary font-medium hover:text-primary-light">Se connecter</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
