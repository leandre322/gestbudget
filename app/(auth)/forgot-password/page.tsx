'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Mail, ArrowLeft, CheckCircle, AlertCircle } from 'lucide-react';

export default function ForgotPasswordPage() {
  const [email, setEmail]     = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent]       = useState(false);
  const [error, setError]     = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError('');

    const res = await fetch('/api/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    if (!res.ok) { setError("Erreur lors de l'envoi. Réessayez."); setLoading(false); return; }

    setSent(true); setLoading(false);
  };

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
          {sent ? (
            <div className="text-center">
              <CheckCircle className="w-14 h-14 text-success mx-auto mb-4" />
              <h2 className="text-xl font-bold text-slate-800 mb-2">Email envoyé !</h2>
              <p className="text-slate-500 text-sm mb-6">
                Un lien de réinitialisation a été envoyé à <strong>{email}</strong> via Brevo.
                Vérifiez votre boîte de réception.
              </p>
              <Link href="/login" className="inline-flex items-center gap-2 text-primary font-medium text-sm hover:text-primary-light">
                <ArrowLeft size={15} />Retour à la connexion
              </Link>
            </div>
          ) : (
            <>
              <h2 className="text-xl font-semibold text-slate-800 mb-2">Mot de passe oublié</h2>
              <p className="text-slate-500 text-sm mb-6">
                Saisissez votre email pour recevoir un lien de réinitialisation.
              </p>
              {error && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-600 rounded-xl p-3 mb-4 text-sm">
                  <AlertCircle size={16} />{error}
                </div>
              )}
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Adresse email</label>
                  <div className="relative">
                    <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                      placeholder="votre@email.com"
                      className="w-full border border-slate-200 rounded-xl pl-9 pr-4 py-2.5 text-sm focus:border-primary focus:ring-2 focus:ring-blue-100 outline-none transition-all" />
                  </div>
                </div>
                <button type="submit" disabled={loading}
                  className="w-full bg-primary hover:bg-primary-dark text-white font-medium rounded-xl py-2.5 flex items-center justify-center gap-2 transition-all disabled:opacity-60">
                  {loading ? <div className="spinner" /> : 'Envoyer le lien'}
                </button>
              </form>
              <div className="text-center mt-5">
                <Link href="/login" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-600">
                  <ArrowLeft size={13} />Retour à la connexion
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
