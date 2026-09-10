import React from 'react';
import { Camera, Loader2, X } from 'lucide-react';

export default function BlueprintAddPinModal({
  isOpen,
  formData,
  tradeSectionsConfig,
  photoPreviews,
  savingPin,
  fileInputRef,
  isEditing,
  onCategoryChange,
  onFormDataChange,
  onPhotoSelect,
  onCancel,
  onSave
}) {
  if (!isOpen) return null;

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '20px' }}>
      <div style={{ backgroundColor: 'var(--color-zinc-900)', border: '1px solid var(--color-zinc-800)', borderRadius: '16px', padding: '20px', width: '100%', maxWidth: '400px', display: 'flex', flexDirection: 'column', gap: '16px', margin: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#fff' }}>{isEditing ? 'Edit Installation Pin' : 'Add Installation Pin'}</h3>
          <button
            type="button"
            onClick={onCancel}
            style={{ background: 'none', border: 'none', color: 'var(--color-zinc-500)', cursor: 'pointer' }}
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={onSave} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label className="form-label" style={{ fontSize: '0.72rem' }}>Subcontractor Category</label>
            <select
              value={formData.tradeCategory}
              onChange={onCategoryChange}
              className="form-input"
              style={{ width: '100%', height: '36px', borderRadius: '8px', padding: '0 10px', fontSize: '0.82rem', backgroundColor: 'var(--color-zinc-950)', border: '1px solid var(--color-zinc-800)', color: '#fff' }}
            >
              {Object.keys(tradeSectionsConfig).map(catKey => (
                <option key={catKey} value={catKey}>
                  {tradeSectionsConfig[catKey].label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="form-label" style={{ fontSize: '0.72rem' }}>Project Phase Block</label>
            <select
              value={formData.tradePhase}
              onChange={(e) => onFormDataChange(prev => ({ ...prev, tradePhase: e.target.value }))}
              className="form-input"
              style={{ width: '100%', height: '36px', borderRadius: '8px', padding: '0 10px', fontSize: '0.82rem', backgroundColor: 'var(--color-zinc-950)', border: '1px solid var(--color-zinc-800)', color: '#fff' }}
            >
              {tradeSectionsConfig[formData.tradeCategory]?.phases.map(ph => (
                <option key={ph} value={ph}>{ph}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '0.8fr 1.2fr', gap: '10px' }}>
            <div>
              <label className="form-label" style={{ fontSize: '0.72rem' }}>Level</label>
              <input
                value={formData.level}
                onChange={(e) => onFormDataChange(prev => ({ ...prev, level: e.target.value }))}
                placeholder="1st Floor"
                className="form-input"
                style={{ width: '100%', height: '36px', borderRadius: '8px', padding: '0 10px', fontSize: '0.82rem', backgroundColor: 'var(--color-zinc-950)', border: '1px solid var(--color-zinc-800)', color: '#fff' }}
              />
            </div>

            <div>
              <label className="form-label" style={{ fontSize: '0.72rem' }}>Room / Area</label>
              <input
                value={formData.room}
                onChange={(e) => onFormDataChange(prev => ({ ...prev, room: e.target.value }))}
                placeholder="Kitchen"
                className="form-input"
                style={{ width: '100%', height: '36px', borderRadius: '8px', padding: '0 10px', fontSize: '0.82rem', backgroundColor: 'var(--color-zinc-950)', border: '1px solid var(--color-zinc-800)', color: '#fff' }}
              />
            </div>
          </div>

          <div>
            <label className="form-label" style={{ fontSize: '0.72rem' }}>Wall / Zone</label>
            <input
              value={formData.wall}
              onChange={(e) => onFormDataChange(prev => ({ ...prev, wall: e.target.value }))}
              placeholder="Island wall, west shower wall, garage north wall..."
              className="form-input"
              style={{ width: '100%', height: '36px', borderRadius: '8px', padding: '0 10px', fontSize: '0.82rem', backgroundColor: 'var(--color-zinc-950)', border: '1px solid var(--color-zinc-800)', color: '#fff' }}
            />
          </div>

          <div>
            <label className="form-label" style={{ fontSize: '0.72rem' }}>Installation Note</label>
            <textarea
              value={formData.note}
              onChange={(e) => onFormDataChange(prev => ({ ...prev, note: e.target.value }))}
              placeholder="e.g. Master shower hot/cold manifold routing detail..."
              className="form-input"
              rows={3}
              style={{ width: '100%', borderRadius: '8px', padding: '8px 10px', fontSize: '0.82rem', backgroundColor: 'var(--color-zinc-950)', border: '1px solid var(--color-zinc-800)', color: '#fff', resize: 'none' }}
            />
          </div>

          <div>
            <label className="form-label" style={{ fontSize: '0.72rem' }}>Verification Photo (Optional)</label>
            {isEditing && !photoPreviews.length && (
              <div style={{ fontSize: '0.68rem', color: 'var(--color-zinc-500)', marginBottom: '6px' }}>
                Existing photo stays attached unless you choose a new one.
              </div>
            )}

            {photoPreviews.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px' }}>
                  {photoPreviews.map((preview, index) => (
                    <div key={`${preview}-${index}`} style={{ position: 'relative', width: '100%', height: '110px', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--color-zinc-800)' }}>
                      <img src={preview} alt={`Preview ${index + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="btn"
                  style={{ backgroundColor: 'var(--color-zinc-800)', border: 'none', color: '#fff', fontSize: '0.74rem', height: '34px' }}
                >
                  Add More Photos
                </button>
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                style={{ border: '1px dashed var(--color-zinc-700)', borderRadius: '8px', padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer', backgroundColor: 'var(--color-zinc-950)' }}
              >
                <Camera size={16} style={{ color: 'var(--color-zinc-400)' }} />
                <span style={{ fontSize: '0.78rem', color: 'var(--color-zinc-400)' }}>Take Photo / Upload Image</span>
              </div>
            )}
            <input
              type="file"
              ref={fileInputRef}
              onChange={onPhotoSelect}
              accept="image/*"
              capture="environment"
              multiple
              style={{ display: 'none' }}
            />
          </div>

          <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
            <button
              type="button"
              onClick={onCancel}
              className="btn"
              style={{ backgroundColor: 'var(--color-zinc-800)', border: 'none', color: '#fff', fontSize: '0.8rem', height: '36px' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingPin}
              className="btn btn-primary"
              style={{ flex: 1, border: 'none', fontSize: '0.8rem', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
            >
              {savingPin ? (
                <>
                  <Loader2 className="animate-spin" size={14} />
                  Saving...
                </>
              ) : (
                isEditing ? 'Update Pin' : 'Save Pin'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
