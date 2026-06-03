'use client';
import { useEffect, useState } from 'react';
import { signOut } from 'next-auth/react';

const LIMIT   = 30 * 60 * 1000;
const WARNING =  5 * 60 * 1000;

export function InactivityWarning() {
  const [show,      setShow]      = useState(false);
  const [countdown, setCountdown] = useState(300);

  useEffect(() => {
    let last = Date.now();
    const reset = () => { last = Date.now(); setShow(false); };
    const events = ['mousemove','keypress','click','scroll','touchstart'];
    events.forEach(e => window.addEventListener(e, reset, { passive: true }));

    const check = setInterval(() => {
      const elapsed = Date.now() - last;
      if (elapsed >= LIMIT) { signOut({ callbackUrl: '/login' }); return; }
      if (elapsed >= LIMIT - WARNING) {
        setShow(true);
        setCountdown(Math.round((LIMIT - elapsed) / 1000));
      }
    }, 10_000);

    const tick = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { signOut({ callbackUrl: '/login' }); return 0; }
        return show ? c - 1 : c;
      });
    }, 1_000);

    return () => {
      events.forEach(e => window.removeEventListener(e, reset));
      clearInterval(check);
      clearInterval(tick);
    };
  }, [show]);

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60"/>
      <div className="relative bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 max-w-sm mx-4 text-center">
        <div className="text-4xl mb-3">⏱</div>
        <h3 className="font-bold text-lg text-slate-800 dark:text-slate-200 mb-2">Session inactive</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
          Deconnexion automatique dans{' '}
          <strong className="text-red-500">{countdown}s</strong> pour securite.
        </p>
        <button onClick={() => setShow(false)}
          className="w-full py-2.5 rounded-xl bg-blue-500 text-white font-semibold hover:bg-blue-600 transition-colors">
          Rester connecte
        </button>
      </div>
    </div>
  );
}