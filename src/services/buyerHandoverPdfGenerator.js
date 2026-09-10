const ADEPEC_GOLD = [197, 160, 89];
const ADEPEC_DARK = [15, 15, 18];
const ZINC_500 = [113, 113, 122];

export async function generateBuyerHandoverPdf({
  projectName = 'Custom Home',
  projectAddress = '',
  specs = [],
  companyName = 'ADEPEC HOMES'
}) {
  const { jsPDF } = await import('jspdf');

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'letter'
  });

  const pageWidth = 215.9;
  const pageHeight = 279.4;
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;

  let cursorY = margin;

  // 1. Header Banner
  doc.setFillColor(ADEPEC_DARK[0], ADEPEC_DARK[1], ADEPEC_DARK[2]);
  doc.roundedRect(margin, cursorY, contentWidth, 32, 3, 3, 'F');

  // Gold accent bar
  doc.setFillColor(ADEPEC_GOLD[0], ADEPEC_GOLD[1], ADEPEC_GOLD[2]);
  doc.rect(margin, cursorY + 30, contentWidth, 2, 'F');

  // Header Titles
  doc.setTextColor(ADEPEC_GOLD[0], ADEPEC_GOLD[1], ADEPEC_GOLD[2]);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(companyName.toUpperCase(), margin + 8, cursorY + 11);

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.text('HOMEOWNER SELECTION & FINISH SPECIFICATIONS', margin + 8, cursorY + 18);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(ZINC_500[0], ZINC_500[1], ZINC_500[2]);
  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const addressStr = projectAddress ? `   |   ${projectAddress}` : '';
  doc.text(`Project / Lot: ${projectName}${addressStr}   |   Issued: ${dateStr}`, margin + 8, cursorY + 25);

  cursorY += 38;

  // 2. Overview / Welcome Note
  doc.setFillColor(248, 248, 250);
  doc.setDrawColor(220, 220, 225);
  doc.roundedRect(margin, cursorY, contentWidth, 18, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(ADEPEC_DARK[0], ADEPEC_DARK[1], ADEPEC_DARK[2]);
  doc.text('Welcome to your new Adepec custom home!', margin + 4, cursorY + 6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  doc.setTextColor(70, 70, 75);
  doc.text('This document contains the official finish schedule, paint codes, tile, grout, and fixtures selected for your home.', margin + 4, cursorY + 11);
  doc.text('Keep this binder for future maintenance, warranty reference, and paint touch-ups.', margin + 4, cursorY + 15);

  cursorY += 24;

  // Group specs by category
  const categories = [
    { key: 'Paint', label: '🎨 Paint & Stain Schedule' },
    { key: 'Tile & Grout', label: '🧱 Tile, Grout & Stone' },
    { key: 'Countertops & Flooring', label: '🪚 Countertops & Flooring' },
    { key: 'Fixtures & Hardware', label: '💡 Plumbing & Electrical Fixtures' },
    { key: 'Exterior', label: '🏡 Exterior & Roofing Finishes' },
    { key: 'Appliances & Custom', label: '📝 Appliances & Custom Specifications' },
    { key: 'General', label: '📋 General Project Notes & Specifications' }
  ];

  const grouped = {};
  categories.forEach((c) => { grouped[c.key] = []; });

  specs.forEach((s) => {
    const cat = s.category || 'General';
    const match = categories.find((c) => c.key.toLowerCase() === cat.toLowerCase());
    const targetKey = match ? match.key : 'General';
    grouped[targetKey].push(s);
  });

  // Render each category section
  categories.forEach((catObj) => {
    const items = grouped[catObj.key];
    if (!items || items.length === 0) return;

    // Check page space
    if (cursorY + 30 > pageHeight - margin) {
      doc.addPage();
      cursorY = margin + 5;
    }

    // Category Header
    doc.setFillColor(ADEPEC_GOLD[0], ADEPEC_GOLD[1], ADEPEC_GOLD[2]);
    doc.rect(margin, cursorY, 3, 7, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(ADEPEC_DARK[0], ADEPEC_DARK[1], ADEPEC_DARK[2]);
    doc.text(catObj.label.toUpperCase(), margin + 6, cursorY + 5.5);

    cursorY += 9;

    // Table Header
    doc.setFillColor(ADEPEC_DARK[0], ADEPEC_DARK[1], ADEPEC_DARK[2]);
    doc.rect(margin, cursorY, contentWidth, 6.5, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(255, 255, 255);

    const colLocation = margin + 3;
    const colBrand = margin + 45;
    const colCode = margin + 95;
    const colSpecs = margin + 145;

    doc.text('ROOM / LOCATION', colLocation, cursorY + 4.5);
    doc.text('BRAND / SUPPLIER', colBrand, cursorY + 4.5);
    doc.text('COLOR / CODE / MODEL', colCode, cursorY + 4.5);
    doc.text('SHEEN / SPECS / NOTES', colSpecs, cursorY + 4.5);

    cursorY += 6.5;

    // Table Rows
    items.forEach((item, rIdx) => {
      // Check page break
      if (cursorY + 12 > pageHeight - margin) {
        doc.addPage();
        cursorY = margin + 5;
      }

      const rowBg = rIdx % 2 === 0 ? [255, 255, 255] : [248, 248, 250];
      doc.setFillColor(rowBg[0], rowBg[1], rowBg[2]);
      doc.rect(margin, cursorY, contentWidth, 8, 'F');
      doc.setDrawColor(230, 230, 235);
      doc.line(margin, cursorY + 8, margin + contentWidth, cursorY + 8);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(ADEPEC_DARK[0], ADEPEC_DARK[1], ADEPEC_DARK[2]);
      const locText = doc.splitTextToSize(item.location || 'General', 38);
      doc.text(locText[0] || 'General', colLocation, cursorY + 5);

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(50, 50, 55);
      const brandText = doc.splitTextToSize(item.brand || item.supplier || '—', 45);
      doc.text(brandText[0] || '—', colBrand, cursorY + 5);

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(ADEPEC_GOLD[0], ADEPEC_GOLD[1], ADEPEC_GOLD[2]);
      const codeText = doc.splitTextToSize(item.code || item.title || '—', 45);
      doc.text(codeText[0] || '—', colCode, cursorY + 5);

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(70, 70, 75);
      const specsNotes = [item.sheen || item.specs, item.notes].filter(Boolean).join(' • ');
      const specsText = doc.splitTextToSize(specsNotes || '—', contentWidth - (colSpecs - margin) - 2);
      doc.text(specsText[0] || '—', colSpecs, cursorY + 5);

      cursorY += 8;
    });

    cursorY += 6;
  });

  // Footer on all pages
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setDrawColor(220, 220, 225);
    doc.line(margin, pageHeight - 12, margin + contentWidth, pageHeight - 12);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(ZINC_500[0], ZINC_500[1], ZINC_500[2]);
    doc.text(`${companyName} — Official Homeowner Warranty & Finishes Schedule`, margin, pageHeight - 7);
    doc.text(`Page ${i} of ${totalPages}`, margin + contentWidth - 18, pageHeight - 7);
  }

  return doc;
}
