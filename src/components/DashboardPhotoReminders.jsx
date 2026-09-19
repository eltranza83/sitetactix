import React from 'react';
import { Camera, Plus } from 'lucide-react';

export default function DashboardPhotoReminders({
  reminders,
  getPhaseReminderTip,
  onSnoozeReminder,
  onDismissReminder,
  onPhotoUpload
}) {
  if (!reminders.length) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {reminders.map(rem => (
        <div
          key={rem.id}
          style={{
            background: 'linear-gradient(135deg, rgba(197, 160, 89, 0.05) 0%, rgba(0,0,0,0) 100%)',
            border: '1px solid rgba(197, 160, 89, 0.2)',
            borderRadius: '10px',
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}
        >
          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
            <div style={{
              backgroundColor: 'rgba(197, 160, 89, 0.15)',
              color: 'var(--color-amber-500)',
              padding: '6px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}>
              <Camera size={16} />
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <h4 style={{ fontSize: '0.85rem', fontWeight: 800, color: '#fff', lineHeight: '1.2' }}>
                Photo reminder: {rem.phase} is active!
              </h4>
              <p style={{ fontSize: '0.72rem', color: 'var(--color-zinc-400)', marginTop: '4px', lineHeight: '1.3' }}>
                {getPhaseReminderTip(rem.phase)}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', borderTop: '1px solid rgba(197, 160, 89, 0.05)', paddingTop: '8px' }}>
            <button
              type="button"
              onClick={() => onSnoozeReminder(rem.phase)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--color-zinc-500)',
                fontSize: '0.72rem',
                cursor: 'pointer',
                padding: '4px 8px',
                borderRadius: '4px'
              }}
            >
              Snooze 24h
            </button>

            <button
              type="button"
              onClick={() => onDismissReminder(rem.phase)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--color-zinc-500)',
                fontSize: '0.72rem',
                cursor: 'pointer',
                padding: '4px 8px',
                borderRadius: '4px'
              }}
            >
              I've Taken Them
            </button>

            <label
              style={{
                backgroundColor: 'var(--color-amber-500)',
                border: 'none',
                color: '#0a0a0a',
                fontWeight: 700,
                fontSize: '0.72rem',
                padding: '4px 10px',
                borderRadius: '6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <Plus size={10} /> Snap Photo
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => onPhotoUpload(e, { category: rem.category, phase: rem.phase })}
                style={{ display: 'none' }}
              />
            </label>
          </div>
        </div>
      ))}
    </div>
  );
}
