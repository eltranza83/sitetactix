import React, { useEffect } from 'react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';

export default function ToastNotification({ message, type = 'success', onClose, duration = 3500 }) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => {
      onClose();
    }, duration);
    return () => clearTimeout(timer);
  }, [message, duration, onClose]);

  if (!message) return null;

  const isSuccess = type === 'success';

  return (
    <div style={{
      position: 'fixed',
      top: '84px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 9999,
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '10px 18px',
      borderRadius: '30px',
      backgroundColor: isSuccess ? '#141416' : '#1c0a0c',
      border: isSuccess ? '1.5px solid #F1D7A7' : '1.5px solid #ef4444',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      boxShadow: isSuccess
        ? '0 12px 36px rgba(0, 0, 0, 0.85), 0 0 24px rgba(229, 193, 88, 0.45)'
        : '0 12px 36px rgba(0, 0, 0, 0.85), 0 0 24px rgba(239, 68, 68, 0.45)',
      color: isSuccess ? '#ffffff' : '#fca5a5',
      fontSize: '0.84rem',
      fontWeight: 800,
      maxWidth: '90vw',
      width: 'max-content',
      animation: 'toastSlideDown 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards'
    }}>
      {isSuccess ? (
        <div style={{
          backgroundColor: 'rgba(229, 193, 88, 0.18)',
          borderRadius: '50%',
          padding: '4px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0
        }}>
          <CheckCircle2 size={18} style={{ color: '#F1D7A7' }} />
        </div>
      ) : (
        <div style={{
          backgroundColor: 'rgba(239, 68, 68, 0.18)',
          borderRadius: '50%',
          padding: '4px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0
        }}>
          <AlertCircle size={18} style={{ color: '#f87171' }} />
        </div>
      )}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '0.01em' }}>
        {message}
      </span>
      <button
        type="button"
        onClick={onClose}
        style={{
          background: 'rgba(255, 255, 255, 0.08)',
          border: 'none',
          color: 'var(--color-zinc-400)',
          cursor: 'pointer',
          padding: '3px',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginLeft: '6px'
        }}
      >
        <X size={14} />
      </button>
    </div>
  );
}
