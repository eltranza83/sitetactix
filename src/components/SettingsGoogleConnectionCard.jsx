import React from 'react';
import { FolderOpen, LogOut } from 'lucide-react';

export default function SettingsGoogleConnectionCard({
  googleToken,
  googleUser,
  onSignIn,
  onSignOut
}) {
  if (!googleToken) {
    const isReconnecting = Boolean(googleUser?.email);
    return (
      <div className="settings-card" style={{ marginBottom: '16px' }}>
        <h3 className="settings-title">
          <FolderOpen size={18} className="logo-icon" style={{ color: 'var(--color-amber-500)' }} />
          {isReconnecting ? 'Reconnect Google Drive' : 'Connect Google Drive'}
        </h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--color-zinc-400)', lineHeight: '1.4', marginBottom: '12px' }}>
          {isReconnecting
            ? `Your SiteTactix account session is active as ${googleUser.email || googleUser.name}. Reconnect your Google Drive authorization to resume saving PDF reports and updating spreadsheets.`
            : 'Sign in to link your Google Drive. This allows you to save PDF reports and automatically log expense details into Google Sheets.'}
        </p>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button onClick={onSignIn} className="btn btn-primary" style={{ backgroundColor: '#fff', color: '#18181b', fontWeight: 700, flex: 1, minWidth: '180px' }}>
            {isReconnecting ? 'Reconnect Google Drive' : 'Sign In with Google'}
          </button>
          {isReconnecting && (
            <button onClick={onSignOut} className="btn btn-secondary" style={{ width: 'auto', padding: '6px 12px', fontSize: '0.8rem' }}>
              <LogOut size={14} /> Sign Out
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="settings-card" style={{ marginBottom: '16px' }}>
      <h3 className="settings-title">
        <FolderOpen size={18} className="logo-icon" style={{ color: 'var(--color-amber-500)' }} />
        Google Drive Connection
      </h3>
      <div style={{ padding: '12px', backgroundColor: 'var(--color-zinc-900)', borderRadius: '8px', border: '1px solid var(--color-zinc-800)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-zinc-500)', fontWeight: 600 }}>SIGNED IN AS</div>
          <div style={{ fontWeight: 600, color: 'var(--color-zinc-100)', fontSize: '0.9rem' }}>{googleUser?.name || 'Google User'}</div>
          {/* The account matters: receipts, folders and Sheets belong to it */}
          {googleUser?.email && (
            <div style={{ fontSize: '0.78rem', color: 'var(--color-zinc-400)', overflowWrap: 'anywhere' }}>{googleUser.email}</div>
          )}
        </div>
        <button onClick={onSignOut} className="btn btn-secondary" style={{ width: 'auto', padding: '6px 12px', fontSize: '0.8rem' }}>
          <LogOut size={14} /> Sign Out
        </button>
      </div>
    </div>
  );
}
