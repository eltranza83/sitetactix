import React, { useState, useEffect } from 'react';
import { CheckCircle, ShieldAlert, LogIn } from 'lucide-react';
import { doc, runTransaction, getDoc } from 'firebase/firestore/lite';
import { getFirebaseDb, getFirebaseAuthInstance } from '../services/firebase';
import { APP_STORAGE_KEYS, setStoredBoolean } from '../services/appStorage';
import { buildUserAccessRecord, getUserAccessDocId } from '../services/inviteAccess';
import { isBuiltInAdmin } from '../config/appConfig';

export default function InviteScreen({ onUnlocked, googleUser, authError, signingIn, onGoogleSignIn, onSignOut }) {
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const [checkingAuth, setCheckingAuth] = useState(false);

  const db = getFirebaseDb();

  // Read URL query parameter for invite code on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const codeParam = params.get('code');
    if (codeParam) {
      setInviteCode(codeParam.toUpperCase());
    }
  }, []);

  // Check Firestore if Google User is already authorized
  useEffect(() => {
    const checkAuth = async () => {
      const auth = getFirebaseAuthInstance();
      const resolvedEmail = googleUser?.email || auth?.currentUser?.email;
      if (!resolvedEmail) return;

      if (isBuiltInAdmin(resolvedEmail)) {
        onUnlocked(resolvedEmail);
        return;
      }
      
      setCheckingAuth(true);
      setError(null);
      
      const db = getFirebaseDb();
      if (!db) {
        setCheckingAuth(false);
        return;
      }
      
      try {
        const emailClean = resolvedEmail.toLowerCase();
        const adminSnap = await getDoc(doc(db, 'admins', emailClean));
        if (adminSnap.exists()) {
          onUnlocked(resolvedEmail);
          return;
        }

        const accessUser = googleUser || (auth?.currentUser ? { email: resolvedEmail, firebaseUid: auth.currentUser.uid } : null);
        const accessDocId = accessUser ? getUserAccessDocId(accessUser) : null;
        if (accessDocId) {
          const accessSnap = await getDoc(doc(db, 'user_access', accessDocId));
          if (accessSnap.exists()) {
            onUnlocked(resolvedEmail);
            return;
          }
        }

      } catch (err) {
        console.error('Failed to verify user authorization:', err);
        if (err?.code === 'permission-denied') {
          setError('Database security rules are not active yet, or this account is not listed as an admin.');
        } else {
          setError('Failed to check database authorization. Please try again.');
        }
      } finally {
        setCheckingAuth(false);
      }
    };

    checkAuth();
  }, [googleUser]);

  const handleVerify = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!db) {
      setError('Database connection is not configured yet. Please configure Firebase settings.');
      return;
    }

    if (!googleUser || !googleUser.email) {
      setError('You must sign in with your Google account first.');
      return;
    }

    if (!googleUser.firebaseUid) {
      setError('Firebase account session is not ready. Please sign out and sign in again.');
      return;
    }

    if (!inviteCode.trim()) {
      setError('Please enter a valid Invite Code.');
      return;
    }

    setLoading(true);
    try {
      const codeId = inviteCode.trim().toUpperCase();
      const docRef = doc(db, 'invites', codeId);

      await runTransaction(db, async (transaction) => {
        const inviteDoc = await transaction.get(docRef);
        if (!inviteDoc.exists()) {
          throw new Error('This invite code does not exist. Check spelling and try again.');
        }

        const data = inviteDoc.data();
        if (data.used) {
          throw new Error('This invite code has already been used.');
        }

        // Atomically mark code as claimed
        transaction.update(docRef, {
          used: true,
          usedAt: new Date(),
          claimedByUid: googleUser.firebaseUid,
          claimedByEmail: googleUser.email.toLowerCase()
        });
        transaction.set(
          doc(db, 'user_access', googleUser.firebaseUid),
          buildUserAccessRecord(googleUser, codeId)
        );
      });

      setStoredBoolean(APP_STORAGE_KEYS.invited, true);
      setSuccess('Access activated successfully! Launching scanner...');
      
      setTimeout(() => {
        onUnlocked(googleUser.email);
      }, 1500);

    } catch (err) {
      console.error(err);
      if (err?.code === 'permission-denied') {
        setError('This invite code is unavailable or has already been used.');
      } else {
        setError(err.message || 'Verification failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#0a0a0a',
      color: '#f5f5f5',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
      fontFamily: 'var(--font-sans)'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '400px',
        backgroundColor: '#121212',
        border: '1px solid #1a1a1a',
        borderRadius: '12px',
        padding: '30px 24px',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.7)',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px'
      }}>
        {/* Header Logo */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', textAlign: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
            <h1 style={{ 
              fontFamily: 'var(--font-syne)', 
              fontSize: '2rem', 
              fontWeight: 800, 
              letterSpacing: '0.04em',
              color: '#ffffff',
              margin: 0
            }}>
              SiteT<span style={{ color: 'var(--color-amber-500)', textShadow: '0 0 14px rgba(197, 160, 89, 0.7)' }}>A</span>ct<span style={{ color: 'var(--color-amber-500)', textShadow: '0 0 14px rgba(197, 160, 89, 0.7)' }}>I</span>x
            </h1>
            <span style={{ 
              fontSize: '0.9rem', 
              fontWeight: 600, 
              color: 'var(--color-amber-400)', 
              fontStyle: 'italic'
            }}>
              by
            </span>
          </div>

          <svg style={{ width: '38px', height: '38px', marginTop: '4px' }} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <defs>
              <linearGradient id="invite-gold" x1="0%" y1="100%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#C5A059" />
                <stop offset="50%" stopColor="#F1D7A7" />
                <stop offset="100%" stopColor="#B28741" />
              </linearGradient>
            </defs>
            <path d="M50 15 L80 45 V85 H71 V45 L50 24 L29 45 V85 H20 V45 Z" fill="url(#invite-gold)" />
            <path fillRule="evenodd" d="M50 33.5 L66.5 50 V85 H50.5 V73 H49.5 V85 H33.5 V50 Z M50 42.5 L57.5 50 V63 H42.5 V50 Z" fill="url(#invite-gold)" />
          </svg>
          <div className="logo-text-group" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '160px', marginTop: '2px' }}>
            <span className="logo-main-text" style={{ fontSize: '1.1rem' }}>ADEPEC</span>
            <div className="header-logo-homes" style={{ fontSize: '0.48rem', marginTop: '1px' }}>HOMES</div>
          </div>
          <span style={{ fontSize: '0.85rem', color: 'var(--color-zinc-400)', marginTop: '6px', fontWeight: 500 }}>
            Jobsite Intelligence & Field Operations
          </span>
        </div>

        {(error || authError) && (
          <div className="alert-box alert-error" style={{ fontSize: '0.82rem', padding: '10px 12px', borderRadius: '8px', display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
            <ShieldAlert size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
            <span>{error || authError}</span>
          </div>
        )}

        {success && (
          <div className="alert-box alert-success" style={{ fontSize: '0.82rem', padding: '10px 12px', borderRadius: '8px', display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
            <CheckCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
            <span>{success}</span>
          </div>
        )}

        {checkingAuth ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', padding: '20px 0' }}>
              <div className="spinner" style={{ width: '28px', height: '28px', borderWidth: '3px', margin: '0 auto' }}></div>
              <span style={{ fontSize: '0.85rem', color: 'var(--color-zinc-400)' }}>Checking account authorization...</span>
            </div>
          ) : !googleUser ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '10px 0' }}>
              <p style={{ fontSize: '0.82rem', color: 'var(--color-zinc-400)', textAlign: 'center', lineHeight: '1.5', marginBottom: '8px' }}>
                Please sign in with your Google account first to verify your scanner invitation status.
              </p>
              <button 
                type="button" 
                onClick={onGoogleSignIn} 
                className="btn btn-primary" 
                style={{ backgroundColor: '#fff', color: '#18181b', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', width: '100%' }}
                disabled={signingIn}
              >
                <LogIn size={18} /> {signingIn ? 'Signing in...' : 'Sign In with Google'}
              </button>
            </div>
          ) : (
            <form onSubmit={handleVerify} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ 
                fontSize: '0.8rem', 
                backgroundColor: 'rgba(197, 160, 89, 0.05)',
                border: '1px solid rgba(197, 160, 89, 0.15)',
                borderRadius: '8px', 
                padding: '10px 12px',
                color: 'var(--color-zinc-300)',
                lineHeight: '1.4'
              }}>
                Signed in as <strong style={{ color: 'var(--color-amber-400)' }}>{googleUser.email}</strong>. 
                Enter your invite code below to unlock scanner access for this account.
              </div>

              {/* Invite Code */}
              <div className="form-group">
                <label className="form-label" htmlFor="invite-code">Invite Code</label>
                <input 
                  type="text" 
                  id="invite-code" 
                  className="form-input" 
                  value={inviteCode} 
                  onChange={(e) => setInviteCode(e.target.value)} 
                  placeholder="e.g. ADPC-XXXX-XXXX" 
                  style={{ textTransform: 'uppercase', textAlign: 'center', letterSpacing: '2px', fontWeight: 700 }}
                  disabled={loading}
                />
              </div>

              <button 
                type="submit" 
                className="btn btn-primary" 
                style={{ marginTop: '6px' }}
                disabled={loading}
              >
                {loading ? 'Activating Access...' : 'Activate Access'}
              </button>

              <button 
                type="button" 
                onClick={onSignOut}
                className="btn btn-secondary"
                style={{ fontSize: '0.78rem', padding: '6px 12px', marginTop: '4px', borderColor: 'var(--color-zinc-800)', color: 'var(--color-zinc-400)', width: '100%' }}
                disabled={loading}
              >
                Sign Out / Use Different Account
              </button>
            </form>
          )}
      </div>
    </div>
  );
}
