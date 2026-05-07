import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from './AuthProvider';

export default function LoginPage() {
  const { session, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = (() => {
    if (!isSupabaseConfigured) return false;
    if (!email.trim()) return false;
    return true;
  })();

  if (loading) return null;
  if (session) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const trimmedEmail = email.trim();

    const res = await supabase.auth.signInWithOtp({
      email: trimmedEmail,
      options: { emailRedirectTo: window.location.origin },
    });

    setBusy(false);
    if (res.error) {
      setError(res.error.message);
      return;
    }
    setSent(true);
  };

  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-slate-800/60 border border-slate-700 rounded-2xl p-6 shadow-xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-brand-600 flex items-center justify-center text-white font-bold">
            H
          </div>
          <div>
            <h1 className="text-xl font-bold">HANDI</h1>
            <p className="text-xs text-slate-400">Speo Field</p>
          </div>
        </div>

        {!isSupabaseConfigured && (
          <div className="mb-4 p-3 rounded-lg bg-amber-900/40 border border-amber-700 text-amber-200 text-sm">
            Configureaza VITE_SUPABASE_URL si VITE_SUPABASE_ANON_KEY in fisierul .env (vezi
            .env.example).
          </div>
        )}

        {sent ? (
          <div className="text-center py-6">
            <div className="text-4xl mb-3">@</div>
            <h2 className="font-semibold mb-1">Verifica emailul</h2>
            <p className="text-sm text-slate-400">
              Ti-am trimis un link magic la <strong>{email}</strong>. Apasa-l ca sa intri.
            </p>
            <button
              type="button"
              className="mt-4 text-xs px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-700"
              onClick={() => setSent(false)}
            >
              Inapoi
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <label className="block">
              <span className="text-sm text-slate-300">Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="mt-1 w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg focus:outline-none focus:border-brand-500"
                placeholder="tu@example.com"
              />
            </label>

            {error && <div className="text-sm text-red-400">{error}</div>}
            <button
              type="submit"
              disabled={busy || !canSubmit}
              className="w-full py-2 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:bg-slate-700 disabled:text-slate-400 font-medium transition"
            >
              {busy ? 'Se trimite...' : 'Trimite link magic'}
            </button>

            <p className="text-xs text-slate-500 text-center pt-2">
              Fara parola - primesti un link prin email.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
