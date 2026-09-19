import React from 'react';
import { FileText, Folder, ExternalLink, AlertTriangle, FileSpreadsheet, Image as ImageIcon } from 'lucide-react';

export default function DocumentCard({ file, folderName, error, onOpen }) {
  if (!file && !error) return null;

  const fileName = file?.name || 'Document';
  const isPdf = fileName.toLowerCase().endsWith('.pdf');
  const isSheet = fileName.toLowerCase().includes('.sheet') || fileName.toLowerCase().endsWith('.xlsx') || fileName.toLowerCase().endsWith('.csv');
  const isImage = /\.(jpg|jpeg|png|webp|gif)$/i.test(fileName);
  const link = file?.webViewLink || (file?.id ? `https://drive.google.com/file/d/${file.id}/view` : null);

  const getIcon = () => {
    if (error) return <AlertTriangle size={18} style={{ color: '#ef4444' }} />;
    if (isSheet) return <FileSpreadsheet size={18} style={{ color: '#22c55e' }} />;
    if (isImage) return <ImageIcon size={18} style={{ color: '#a855f7' }} />;
    if (isPdf) return <FileText size={18} style={{ color: '#C5A059' }} />;
    return <FileText size={18} style={{ color: '#60a5fa' }} />;
  };

  return (
    <div
      style={{
        marginTop: '10px',
        marginBottom: '6px',
        padding: '12px 14px',
        backgroundColor: 'var(--color-zinc-950)',
        border: '1px solid var(--color-zinc-800)',
        borderRadius: '10px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
        <div
          style={{
            width: '34px',
            height: '34px',
            borderRadius: '8px',
            backgroundColor: 'rgba(255, 255, 255, 0.05)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}
        >
          {getIcon()}
        </div>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: '0.85rem',
              fontWeight: 700,
              color: 'var(--color-zinc-100)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
            title={fileName}
          >
            {fileName}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px', fontSize: '0.72rem', color: 'var(--color-zinc-400)' }}>
            <Folder size={12} />
            <span>{folderName || 'Google Drive'}</span>
            {error && <span style={{ color: '#f87171' }}>• {error}</span>}
          </div>
        </div>
      </div>

      {link && !error && (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => {
            if (onOpen) onOpen(file);
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            backgroundColor: 'var(--color-amber-500)',
            color: '#000',
            fontSize: '0.75rem',
            fontWeight: 800,
            borderRadius: '6px',
            textDecoration: 'none',
            flexShrink: 0,
            transition: 'opacity 0.2s'
          }}
        >
          <span>Open</span>
          <ExternalLink size={13} />
        </a>
      )}
    </div>
  );
}
