export function splitProjectName(value) {
  const name = String(value || '').trim();
  const lotMatch = name.match(/\bLot\s+[A-Za-z0-9-]+\b/i);
  if (!lotMatch) {
    return {
      subdivision: name || 'N/A',
      lotNumber: name || 'N/A'
    };
  }

  const lotNumber = lotMatch[0].trim();
  const subdivision = name.replace(lotMatch[0], '').trim();
  return {
    subdivision: subdivision || name,
    lotNumber
  };
}

export function isPlaceholderProjectInfo(projectInfo) {
  const values = [
    projectInfo?.name,
    projectInfo?.address,
    projectInfo?.cityStateZip
  ].map(value => String(value || '').trim().toLowerCase());

  return values.some(value =>
    value.includes('new spec home sub') ||
    value.includes('house number / street name') ||
    value.includes('city, state, zip')
  );
}

export function getProjectPacketInfo(projectInfo, projectName, selectedFolderName) {
  const sheetProjectName = String(projectInfo?.name || '').trim();
  const fallbackName = String(projectName || selectedFolderName || '').trim();
  const { subdivision, lotNumber } = splitProjectName(sheetProjectName || fallbackName);
  const streetAddress = String(projectInfo?.address || '').trim();
  const cityStateZip = String(projectInfo?.cityStateZip || '').trim();
  const fullAddress = [streetAddress, cityStateZip]
    .filter(value => value && value !== 'N/A')
    .join(', ');

  return {
    projectDisplayName: sheetProjectName || fallbackName || 'N/A',
    subdivision,
    lotNumber,
    streetAddress: streetAddress && streetAddress !== 'N/A' ? streetAddress : '',
    cityStateZip: cityStateZip && cityStateZip !== 'N/A' ? cityStateZip : '',
    fullAddress: fullAddress || 'N/A'
  };
}

// Number boxes on the project form keep only digits, commas and a decimal point (browser address autofill can drop text like "United States" into them)
export function cleanNumberInput(value) {
  return String(value ?? '').replace(/[^\d.,]/g, '');
}
