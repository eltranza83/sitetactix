import React from 'react';
import { Image } from 'lucide-react';

export default function BlueprintSetupPrompt({ blueprintInputRef, onUploadBlueprint }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px', padding: '40px 20px', border: '1px dashed var(--color-zinc-800)', borderRadius: '12px', backgroundColor: 'var(--color-zinc-900)' }}>
      <div style={{ width: '48px', height: '48px', borderRadius: '50%', backgroundColor: 'rgba(241, 215, 167, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-amber-500)' }}>
        <Image size={24} style={{ margin: 'auto' }} />
      </div>
      <div style={{ textAlign: 'center' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '6px' }}>No Floor Plan Linked</h3>
        <p style={{ fontSize: '0.78rem', color: 'var(--color-zinc-400)', maxWidth: '280px', margin: '0 auto', lineHeight: 1.4 }}>
          Link your JPEG or PNG house blueprint. Drop pins on-site to log open-wall structural photos, HVAC duct layouts, and plumbing manifold runs.
        </p>
      </div>
      <button
        onClick={() => blueprintInputRef.current?.click()}
        className="btn btn-primary"
        style={{ width: 'auto', padding: '10px 20px', fontSize: '0.85rem' }}
      >
        Select Blueprint Image
      </button>
      <input
        type="file"
        ref={blueprintInputRef}
        onChange={onUploadBlueprint}
        accept="image/*"
        style={{ display: 'none' }}
      />
    </div>
  );
}
