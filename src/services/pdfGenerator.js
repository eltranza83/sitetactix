import { getProjectPacketInfo } from './projectInfoFormatter.js';

const ADEPEC_GOLD = [197, 160, 89];
const ADEPEC_DARK = [10, 10, 10];
const ZINC_900 = [24, 24, 27];
const ZINC_600 = [82, 82, 91];
const ZINC_500 = [113, 113, 122];
const ZINC_200 = [228, 228, 231];
const ZINC_100 = [244, 244, 245];
const ROSE_500 = [244, 63, 94];

/**
 * Loads an image to get its width and height.
 */
function loadImageDimensions(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.width, height: img.height });
    };
    img.onerror = () => reject(new Error('Failed to load image for PDF.'));
    img.src = dataUrl;
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    if (!blob) {
      resolve('');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read image for PDF.'));
    reader.readAsDataURL(blob);
  });
}

function normalizeImageToJpegDataUrl(source) {
  return new Promise((resolve, reject) => {
    if (!source) {
      resolve('');
      return;
    }

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = () => reject(new Error('Failed to prepare image for PDF.'));
    img.src = source;
  });
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image.'));
    img.src = src;
  });
}

async function renderSvgAssetToPngDataUrl(assetUrl, width, height) {
  const response = await fetch(assetUrl);
  if (!response.ok) {
    throw new Error('Failed to load logo asset.');
  }

  const svgText = await response.text();
  const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
  const img = await loadImageElement(source);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL('image/png');
}

function formatIssueLabel(value) {
  return String(value || 'N/A').replace(/_/g, ' ');
}

function formatIssueDate(value) {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

function titleCase(value) {
  return formatIssueLabel(value).replace(/\b\w/g, letter => letter.toUpperCase());
}

async function drawAdepecHeader(pdf, title, subtitle) {
  const pageWidth = 210;
  const margin = 15;

  pdf.setFillColor(...ADEPEC_DARK);
  pdf.rect(0, 0, pageWidth, 38, 'F');

  try {
    const logoDataUrl = await renderSvgAssetToPngDataUrl('/logo-horizontal.svg', 600, 220);
    pdf.addImage(logoDataUrl, 'PNG', margin - 1, 7, 56, 20.5, undefined, 'FAST');
  } catch (err) {
    console.error('Failed to render Adepec logo asset in PDF:', err);
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(15);
    pdf.text('ADEPEC', margin, 17);
    pdf.setFontSize(7.5);
    pdf.setTextColor(...ADEPEC_GOLD);
    pdf.text('HOMES', margin, 24);
  }

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.setTextColor(255, 255, 255);
  pdf.text(title, pageWidth - margin, 17, { align: 'right' });

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(161, 161, 170);
  pdf.text(subtitle, pageWidth - margin, 24, { align: 'right' });
}

function drawBadge(pdf, x, y, label, fillColor) {
  pdf.setFillColor(...fillColor);
  pdf.roundedRect(x, y - 5, 27, 8, 2, 2, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7);
  pdf.text(String(label || 'OPEN').toUpperCase(), x + 13.5, y, { align: 'center' });
}

function addMetaRow(pdf, label, value, x, y, valueMaxWidth = 54) {
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7);
  pdf.setTextColor(...ZINC_500);
  pdf.text(label.toUpperCase(), x, y);

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9);
  pdf.setTextColor(...ZINC_900);
  const lines = pdf.splitTextToSize(String(value || 'N/A'), valueMaxWidth);
  pdf.text(lines.slice(0, 2), x, y + 5);
}

async function addImageSection(pdf, { title, blob, x, y, width, height, emptyText }) {
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8);
  pdf.setTextColor(...ZINC_500);
  pdf.text(title.toUpperCase(), x, y);

  pdf.setDrawColor(...ZINC_200);
  pdf.setFillColor(255, 255, 255);
  pdf.roundedRect(x, y + 4, width, height, 3, 3, 'FD');

  if (!blob) {
    pdf.setFont('helvetica', 'italic');
    pdf.setFontSize(9);
    pdf.setTextColor(...ZINC_500);
    const lines = pdf.splitTextToSize(emptyText, width - 12);
    pdf.text(lines, x + 6, y + 18);
    return;
  }

  try {
    const dataUrl = await normalizeImageToJpegDataUrl(await blobToDataUrl(blob));
    const dims = await loadImageDimensions(dataUrl);
    const innerPad = 4;
    const maxWidth = width - (innerPad * 2);
    const maxHeight = height - (innerPad * 2);
    const scale = Math.min(maxWidth / dims.width, maxHeight / dims.height);
    const imgWidth = dims.width * scale;
    const imgHeight = dims.height * scale;
    const imgX = x + innerPad + ((maxWidth - imgWidth) / 2);
    const imgY = y + 4 + innerPad + ((maxHeight - imgHeight) / 2);
    pdf.addImage(dataUrl, 'JPEG', imgX, imgY, imgWidth, imgHeight, undefined, 'FAST');
  } catch (err) {
    console.error('Failed to add issue packet image:', err);
    pdf.setFont('helvetica', 'italic');
    pdf.setFontSize(9);
    pdf.setTextColor(220, 38, 38);
    pdf.text('Image could not be embedded in this PDF.', x + 6, y + 18);
  }
}

export async function generateIssuePacketPDF({
  issue,
  projectName = '',
  selectedFolderName = '',
  projectInfo = null,
  issuePhotoBlob = null,
  floorPlanSnapshotBlob = null
}) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({
    orientation: 'p',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 15;
  const contentWidth = pageWidth - (margin * 2);
  const created = new Date().toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });

  await drawAdepecHeader(pdf, 'PUNCH ISSUE PACKET', `Generated ${created}`);
  const packetProject = getProjectPacketInfo(projectInfo, projectName, selectedFolderName);

  let currentY = 48;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(18);
  pdf.setTextColor(...ZINC_900);
  const titleLines = pdf.splitTextToSize(issue?.title || 'Punch Issue', contentWidth - 38);
  pdf.text(titleLines.slice(0, 2), margin, currentY);

  const priority = titleCase(issue?.priority || 'open');
  const status = titleCase(issue?.status || 'open');
  drawBadge(pdf, pageWidth - margin - 27, currentY - 1, priority, issue?.priority === 'high' ? ROSE_500 : ADEPEC_GOLD);
  currentY += titleLines.length > 1 ? 14 : 10;

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(...ZINC_600);
  pdf.text(`Project: ${packetProject.projectDisplayName}`, margin, currentY);
  pdf.text(`Status: ${status}`, pageWidth - margin, currentY, { align: 'right' });

  currentY += 10;
  const projectBoxHeight = 27;
  pdf.setFillColor(255, 255, 255);
  pdf.setDrawColor(...ZINC_200);
  pdf.roundedRect(margin, currentY, contentWidth, projectBoxHeight, 3, 3, 'S');

  addMetaRow(pdf, 'Subdivision', packetProject.subdivision, margin + 6, currentY + 10, 58);
  addMetaRow(pdf, 'Lot Number', packetProject.lotNumber, margin + 70, currentY + 10, 40);
  addMetaRow(pdf, 'Full Address', packetProject.fullAddress, margin + 118, currentY + 10, 56);

  if (packetProject.fullAddress && packetProject.fullAddress !== 'N/A') {
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(packetProject.fullAddress)}`;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7);
    pdf.setTextColor(22, 163, 74);
    pdf.textWithLink('OPEN IN GOOGLE MAPS', margin + 118, currentY + 24, { url: mapsUrl });
  }

  currentY += projectBoxHeight + 8;
  const metaHeight = 42;
  pdf.setFillColor(...ZINC_100);
  pdf.setDrawColor(...ZINC_200);
  pdf.roundedRect(margin, currentY, contentWidth, metaHeight, 3, 3, 'FD');

  const col1 = margin + 6;
  const col2 = margin + 68;
  const col3 = margin + 130;
  addMetaRow(pdf, 'Category', formatIssueLabel(issue?.category), col1, currentY + 11);
  addMetaRow(pdf, 'Phase', issue?.tradePhase || 'N/A', col2, currentY + 11);
  addMetaRow(pdf, 'Assigned', issue?.contractorName || 'N/A', col3, currentY + 11);
  addMetaRow(pdf, 'Phone', issue?.phoneNumber || 'N/A', col1, currentY + 29);
  addMetaRow(pdf, 'Created', formatIssueDate(issue?.createdAt), col2, currentY + 29);
  addMetaRow(
    pdf,
    'Floor Plan',
    Number.isFinite(Number(issue?.floorPlanX)) && Number.isFinite(Number(issue?.floorPlanY)) ? 'Pin attached' : 'No pin attached',
    col3,
    currentY + 29
  );

  currentY += metaHeight + 12;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8);
  pdf.setTextColor(...ZINC_500);
  pdf.text('DESCRIPTION', margin, currentY);
  currentY += 6;

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.setTextColor(...ZINC_900);
  const descriptionLines = pdf.splitTextToSize(issue?.description || 'No description provided.', contentWidth);
  pdf.text(descriptionLines.slice(0, 6), margin, currentY);
  currentY += Math.max(16, Math.min(descriptionLines.length, 6) * 5) + 6;

  const halfGap = 8;
  const halfWidth = (contentWidth - halfGap) / 2;
  const imageHeight = 82;
  await addImageSection(pdf, {
    title: 'Issue Photo',
    blob: issuePhotoBlob,
    x: margin,
    y: currentY,
    width: halfWidth,
    height: imageHeight,
    emptyText: 'No issue photo was attached to this punch item.'
  });
  await addImageSection(pdf, {
    title: 'Floor Plan Location',
    blob: floorPlanSnapshotBlob,
    x: margin + halfWidth + halfGap,
    y: currentY,
    width: halfWidth,
    height: imageHeight,
    emptyText: 'No floor plan pin was attached to this punch item.'
  });

  currentY += imageHeight + 18;
  pdf.setDrawColor(...ADEPEC_GOLD);
  pdf.setLineWidth(0.5);
  pdf.line(margin, currentY, pageWidth - margin, currentY);
  currentY += 7;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9);
  pdf.setTextColor(...ZINC_900);
  pdf.text('Contractor Note', margin, currentY);
  currentY += 6;

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(...ZINC_600);
  const note = 'Please review the issue photo and marked floor plan location. Reply when complete with a completion photo or update.';
  pdf.text(pdf.splitTextToSize(note, contentWidth), margin, currentY);

  pdf.setFillColor(...ZINC_900);
  pdf.rect(0, pageHeight - 13, pageWidth, 13, 'F');
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7);
  pdf.setTextColor(...ADEPEC_GOLD);
  pdf.text('SITETACTIX BY ADEPEC HOMES', margin, pageHeight - 5);
  pdf.setTextColor(212, 212, 216);
  pdf.text(`${packetProject.lotNumber || packetProject.projectDisplayName || 'Project'} - ${issue?.id || 'issue'}`, pageWidth - margin, pageHeight - 5, { align: 'right' });

  return pdf.output('blob');
}

/**
 * Generates a PDF document with metadata on top and attached image(s) below.
 * @param {Object} metadata The verified scanner details
 * @param {string[]} imageUrls Array of image data URLs (first is main document, second is optional receipt)
 * @returns {Promise<Blob>} The generated PDF as a Blob
 */
export async function generateDocumentPDF(metadata, imageUrls) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({
    orientation: 'p',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = 210; // A4 width
  const pageHeight = 297; // A4 height
  const margin = 15;
  const contentWidth = pageWidth - (margin * 2);

  // 1. Draw Title Header
  pdf.setFillColor(10, 10, 10); // Adepec Dark Background
  pdf.rect(0, 0, pageWidth, 40, 'F');

  // Adepec Gold Logo Accent
  pdf.setFillColor(197, 160, 89); // Adepec Gold
  pdf.rect(margin, 12, 4, 16, 'F');

  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(22);
  pdf.text('ADEPEC', margin + 8, 20);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.setTextColor(197, 160, 89); // Gold accent text
  pdf.text('CONSTRUCTION RECORD & EXPENSE REPORT', margin + 8, 26);

  // Date of Report Creation
  pdf.setTextColor(161, 161, 170); // Zinc 400
  pdf.setFontSize(9);
  const now = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
  pdf.text(`Created: ${now}`, pageWidth - margin - 50, 23, { align: 'right' });

  // 2. Draw Metadata Grid Block
  let currentY = 50;
  const hasCheck = !!metadata.checkNumber;
  const hasSplits = metadata.splits && metadata.splits.length > 0;
  
  // Calculate height needed for splits table
  const splitsHeight = hasSplits ? (15 + (metadata.splits.length * 6)) : 0;
  const boxHeight = (hasCheck ? 83 : 75) + splitsHeight;

  // Draw Box Container for Metadata
  pdf.setFillColor(244, 244, 245); // Zinc 100
  pdf.rect(margin, currentY, contentWidth, boxHeight, 'F');
  pdf.setDrawColor(228, 228, 231); // Zinc 200
  pdf.setLineWidth(0.5);
  pdf.rect(margin, currentY, contentWidth, boxHeight, 'S');

  // Text inside Grid
  pdf.setTextColor(82, 82, 91); // Zinc 600
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);

  // Row 1
  pdf.text('LOT NUMBER / ADDRESS:', margin + 5, currentY + 10);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(24, 24, 27); // Zinc 900
  pdf.text(metadata.lotNumber || 'N/A', margin + 55, currentY + 10);

  // Row 2
  pdf.setTextColor(82, 82, 91);
  pdf.setFont('helvetica', 'bold');
  pdf.text('JOB / ITEM DESCRIPTION:', margin + 5, currentY + 18);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(24, 24, 27);
  pdf.text(metadata.description || 'N/A', margin + 55, currentY + 18);

  // Row 3
  pdf.setTextColor(82, 82, 91);
  pdf.setFont('helvetica', 'bold');
  pdf.text('CONTACT / VENDOR:', margin + 5, currentY + 26);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(24, 24, 27);
  pdf.text(metadata.vendor || 'N/A', margin + 55, currentY + 26);

  // Row 4
  pdf.setTextColor(82, 82, 91);
  pdf.setFont('helvetica', 'bold');
  pdf.text('DATE OF TRANSACTION:', margin + 5, currentY + 34);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(24, 24, 27);
  pdf.text(metadata.date || 'N/A', margin + 55, currentY + 34);

  // Row 5
  pdf.setTextColor(82, 82, 91);
  pdf.setFont('helvetica', 'bold');
  pdf.text('COST CLASSIFICATION:', margin + 5, currentY + 42);
  pdf.setFont('helvetica', 'bold');
  if (hasSplits) {
    pdf.setTextColor(147, 107, 40); // Adepec Dark Gold
    pdf.text('MULTIPLE (SPLIT)', margin + 55, currentY + 42);
  } else if (metadata.costCategory === 'labor') {
    pdf.setTextColor(30, 64, 175); // Royal Blue
    pdf.text('LABOR COST', margin + 55, currentY + 42);
  } else {
    pdf.setTextColor(147, 107, 40); // Adepec Dark Gold
    pdf.text('MATERIAL COST', margin + 55, currentY + 42);
  }

  // Row 6
  pdf.setTextColor(82, 82, 91);
  pdf.setFont('helvetica', 'bold');
  pdf.text(hasSplits ? 'TOTAL AMOUNT (SPLIT):' : 'TOTAL AMOUNT:', margin + 5, currentY + 50);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(24, 24, 27);
  pdf.setFontSize(11);
  pdf.text(`$${Number(metadata.amount || 0).toFixed(2)}`, margin + 55, currentY + 50);
  pdf.setFontSize(10); // reset

  // Row 7 (Subcontractor Category)
  pdf.setTextColor(82, 82, 91);
  pdf.setFont('helvetica', 'bold');
  pdf.text('SUBCONTRACTOR CATEGORY:', margin + 5, currentY + 58);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(24, 24, 27);
  pdf.text(metadata.tradeCategory || 'N/A', margin + 55, currentY + 58);

  // Row 8 (Project Phase)
  pdf.setTextColor(82, 82, 91);
  pdf.setFont('helvetica', 'bold');
  pdf.text('PROJECT PHASE BLOCK:', margin + 5, currentY + 66);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(24, 24, 27);
  pdf.text(metadata.tradePhase || 'N/A', margin + 55, currentY + 66);

  // Row 9 (Check Number if present)
  if (hasCheck) {
    pdf.setTextColor(82, 82, 91);
    pdf.setFont('helvetica', 'bold');
    pdf.text('CHECK NUMBER:', margin + 5, currentY + 74);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(24, 24, 27);
    pdf.text(metadata.checkNumber, margin + 55, currentY + 74);
  }

  // Draw Splits Table if present
  if (hasSplits) {
    const splitsStartY = currentY + (hasCheck ? 82 : 74);
    
    // Divider line
    pdf.setDrawColor(200, 200, 204);
    pdf.setLineWidth(0.3);
    pdf.line(margin + 5, splitsStartY - 4, margin + contentWidth - 5, splitsStartY - 4);

    // Section title
    pdf.setTextColor(197, 160, 89); // Adepec Gold
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.text('ALLOTMENT SPLITS', margin + 5, splitsStartY);

    // Table Headers
    pdf.setTextColor(113, 113, 122); // Zinc 500
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    
    // Column coordinates
    const colLotX = margin + 5;
    const colCatX = margin + 45;
    const colDescX = margin + 75;
    const colAmtX = margin + contentWidth - 5; // Align right

    pdf.text('LOT / ADDRESS', colLotX, splitsStartY + 5);
    pdf.text('CATEGORY', colCatX, splitsStartY + 5);
    pdf.text('DESCRIPTION', colDescX, splitsStartY + 5);
    pdf.text('AMOUNT', colAmtX, splitsStartY + 5, { align: 'right' });

    // Draw header bottom line
    pdf.line(margin + 5, splitsStartY + 7, margin + contentWidth - 5, splitsStartY + 7);

    // Table Rows
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(24, 24, 27); // Zinc 900
    
    metadata.splits.forEach((split, idx) => {
      const rowY = splitsStartY + 12 + (idx * 6);
      
      // Lot
      pdf.text(split.lotNumber || 'N/A', colLotX, rowY);
      
      // Category
      pdf.setFont('helvetica', 'bold');
      if (split.costCategory === 'labor') {
        pdf.setTextColor(30, 64, 175);
        pdf.text('LABOR', colCatX, rowY);
      } else {
        pdf.setTextColor(147, 107, 40);
        pdf.text('MATERIAL', colCatX, rowY);
      }
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(24, 24, 27);
      
      // Trade Phase + Description
      const phase = split.tradePhase || metadata.tradePhase || 'N/A';
      const desc = split.description || metadata.description || '';
      const displayText = desc ? `${phase} (${desc})` : phase;
      const truncatedText = displayText.length > 40 ? displayText.substring(0, 37) + '...' : displayText;
      pdf.text(truncatedText, colDescX, rowY);
      
      // Amount
      pdf.setFont('helvetica', 'bold');
      pdf.text(`$${Number(split.amount || 0).toFixed(2)}`, colAmtX, rowY, { align: 'right' });
      pdf.setFont('helvetica', 'normal');
    });
  }

  // 3. Attach First Image on Page 1
  currentY += (boxHeight + 10); // move below metadata grid
  const maxImgHeightP1 = pageHeight - currentY - margin; // Usable height left on page 1

  if (imageUrls && imageUrls.length > 0 && imageUrls[0]) {
    try {
      const dataUrl = imageUrls[0];
      
      // Label for image
      pdf.setTextColor(113, 113, 122); // Zinc 500
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8);
      pdf.text('PRIMARY DOCUMENT ATTACHMENT', margin, currentY - 2);

      if (dataUrl.startsWith('data:application/pdf')) {
        // PDF files cannot be embedded as images in jsPDF; show message
        pdf.setTextColor(24, 24, 27);
        pdf.setFont('helvetica', 'italic');
        pdf.setFontSize(10);
        pdf.text('Source PDF document attached to expense entry in Google Drive.', margin, currentY + 10);
      } else {
        const dims = await loadImageDimensions(dataUrl);
        
        // Calculate scaling to preserve aspect ratio within margins
        const scaleX = contentWidth / dims.width;
        const scaleY = maxImgHeightP1 / dims.height;
        const scale = Math.min(scaleX, scaleY);
        
        const imgWidth = dims.width * scale;
        const imgHeight = dims.height * scale;
        const imgX = margin + (contentWidth - imgWidth) / 2; // Center horizontally

        pdf.addImage(dataUrl, 'JPEG', imgX, currentY, imgWidth, imgHeight, undefined, 'FAST');
      }
    } catch (e) {
      console.error('Failed to add primary image to PDF:', e);
      pdf.setTextColor(220, 38, 38);
      pdf.text('Failed to render document image scan.', margin, currentY + 10);
    }
  } else {
    // Render Self-Attested Manual Expense Record voucher section
    const voucherY = currentY + 5;
    const voucherHeight = 55;

    // Background card
    pdf.setFillColor(250, 250, 250);
    pdf.setDrawColor(228, 228, 231);
    pdf.setLineWidth(0.4);
    pdf.roundedRect(margin, voucherY, contentWidth, voucherHeight, 2, 2, 'FD');

    // Accent line on left edge
    pdf.setFillColor(197, 160, 89); // Adepec Gold
    pdf.rect(margin, voucherY, 3, voucherHeight, 'F');

    // Title & Subtitle based on transaction type
    const isCheck = metadata.type === 'check' || metadata.documentType === 'check' || (metadata.checkNumber && !['Card', 'Debit', 'Cash'].some(m => String(metadata.checkNumber).includes(m)));
    const voucherTitle = isCheck ? 'SELF-ATTESTED CONTRACTOR PAYMENT VOUCHER' : 'SELF-ATTESTED MANUAL EXPENSE RECORD';
    const voucherSubtitle = isCheck
      ? (metadata.checkNumber ? `CHECK PAYMENT #${metadata.checkNumber} • NO PHYSICAL SCAN ATTACHED` : 'CONTRACTOR PAYMENT • NO PHYSICAL SCAN ATTACHED')
      : 'NO VENDOR RECEIPT ATTACHED';

    pdf.setTextColor(10, 10, 10);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10);
    pdf.text(voucherTitle, margin + 8, voucherY + 10);

    pdf.setTextColor(197, 160, 89);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.5);
    pdf.text(voucherSubtitle, margin + 8, voucherY + 17);

    // Statement / Description
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8.5);
    const purposeText = metadata.description || (isCheck ? `Contractor payment to ${metadata.payee || metadata.vendor || 'Contractor'}` : `Business expense at ${metadata.vendor || 'merchant'}`);
    pdf.text(`Business Purpose: ${purposeText}`, margin + 8, voucherY + 25);
    pdf.text(`Recorded By: Authorized Project Administrator`, margin + 8, voucherY + 32);
    pdf.text(`Attestation: Verified legitimate project transaction recorded without physical paper attachment.`, margin + 8, voucherY + 39);
    // Timestamp & Provenance
    pdf.setTextColor(113, 113, 122);
    pdf.setFont('helvetica', 'italic');
    pdf.text(`Logged via J.A.R.V.I.S. (SiteTactix) • Date: ${metadata.date || new Date().toISOString().split('T')[0]} • Status: Self-Attested Entry`, margin + 8, voucherY + 48);
  }

  // 4. Attach Second Image (e.g. Receipt) on Page 2 if exists
  if (imageUrls && imageUrls.length > 1 && imageUrls[1]) {
    try {
      pdf.addPage();
      
      // Header for Page 2
      pdf.setFillColor(24, 24, 27);
      pdf.rect(0, 0, pageWidth, 20, 'F');
      
      pdf.setTextColor(255, 255, 255);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(12);
      pdf.text('JOBSCAN - ATTACHED RECEIPT / REFERENCE', margin, 13);
      
      const p2Y = 30;
      const maxImgHeightP2 = pageHeight - p2Y - margin;

      const dataUrl = imageUrls[1];
      const dims = await loadImageDimensions(dataUrl);

      const scaleX = contentWidth / dims.width;
      const scaleY = maxImgHeightP2 / dims.height;
      const scale = Math.min(scaleX, scaleY);

      const imgWidth = dims.width * scale;
      const imgHeight = dims.height * scale;
      const imgX = margin + (contentWidth - imgWidth) / 2;

      pdf.addImage(dataUrl, 'JPEG', imgX, p2Y, imgWidth, imgHeight, undefined, 'FAST');
    } catch (e) {
      console.error('Failed to add secondary image to PDF:', e);
    }
  }

  // 5. Output PDF as Blob
  return pdf.output('blob');
}
