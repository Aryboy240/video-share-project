'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth, onAuthStateChangedHelper, signOut } from '../../firebase/firebase';
import { checkAdminStatus } from '../../firebase/functions';
import styles from './login.module.css';

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChangedHelper(async (user) => {
      if (user) {
        try {
          const { isAdmin } = await checkAdminStatus();
          if (isAdmin) {
            router.replace('/admin');
            return;
          }
        } catch {}
      }
      setChecking(false);
    });
    return () => unsub();
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      const { isAdmin } = await checkAdminStatus();
      if (!isAdmin) {
        await signOut();
        setError('This account does not have admin access.');
        setLoading(false);
        return;
      }
      router.replace('/admin');
    } catch (err: any) {
      const code = err?.code ?? '';
      if (
        code === 'auth/invalid-credential' ||
        code === 'auth/wrong-password' ||
        code === 'auth/user-not-found'
      ) {
        setError('Invalid email or password.');
      } else {
        setError(err?.message || 'Sign in failed.');
      }
      setLoading(false);
    }
  };

  if (checking) return null;

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Admin Sign In</h1>
        <form onSubmit={handleSubmit} className={styles.form}>
          <label className={styles.label} htmlFor="admin-email">Email</label>
          <input
            id="admin-email"
            type="email"
            className={styles.input}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
            autoComplete="email"
            required
          />
          <label className={styles.label} htmlFor="admin-password">Password</label>
          <input
            id="admin-password"
            type="password"
            className={styles.input}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            autoComplete="current-password"
            required
          />
          {error && <p className={styles.error}>{error}</p>}
          <button
            type="submit"
            className={styles.button}
            disabled={loading || !email || !password}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
