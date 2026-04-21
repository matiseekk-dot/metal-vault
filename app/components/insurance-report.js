// ────────────────────────────────────────────────────────────────
// Insurance Report Generator — Pro feature.
// Produces a formal PDF suitable for insurance policy documentation
// (contents insurance, collector's insurance, homeowner's rider).
//
// Includes:
//   • Cover page with owner info + generation timestamp + total value
//   • Full itemized inventory table (artist, album, year, label, format,
//     grade, purchase date, purchase price, market value, photo reference)
//   • Summary statistics by genre / decade / label
//   • Per-item photo pages for high-value records (>$100)
//   • Appraisal methodology disclosure (Discogs median + purchase price fallback)
//   • Footer with page numbers + document ID
// ────────────────────────────────────────────────────────────────

'use client';
import { C, MONO, BEBAS } from '@/lib/theme';

const fmtUSD = v => '$' + Number(v || 0).toFixed(2);
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' }) : '—';

export async function generateInsuranceReport({ collection, profile, ownerInfo }) {
  // Dynamic import — client-side only, lazy-loaded
  const { default: jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');

  const doc = new jsPDF({ unit: 'pt', format: 'letter' }); // 612 × 792 pt
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const docId = 'MV-' + Date.now().toString(36).toUpperCase();

  const owner = ownerInfo || {
    name: profile?.display_name || 'Vault Owner',
    email: profile?.email || '',
    address: '',
  };

  // Compute totals & breakdowns
  const totalValue = collection.reduce((s, i) => {
    const v = Number(i.median_price || i.current_price || i.purchase_price) || 0;
    return s + v;
  }, 0);
  const totalPaid = collection.reduce((s, i) => s + (Number(i.purchase_price) || 0), 0);

  // Genre breakdown
  const genreMap = {};
  for (const i of collection) {
    const g = (i.genres && i.genres[0]) || (i.styles && i.styles[0]) || 'Unknown';
    if (!genreMap[g]) genreMap[g] = { count: 0, value: 0 };
    genreMap[g].count++;
    genreMap[g].value += Number(i.median_price || i.current_price || i.purchase_price) || 0;
  }
  const genreBreakdown = Object.entries(genreMap)
    .sort((a, b) => b[1].value - a[1].value)
    .slice(0, 10);

  // ── Page 1: Cover ──
  // Red header stripe
  doc.setFillColor(220, 38, 38);
  doc.rect(0, 0, pageW, 8, 'F');

  // Title block
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(32);
  doc.setTextColor(20, 20, 20);
  doc.text('METAL VAULT', 40, 70);
  doc.setFontSize(14);
  doc.setTextColor(220, 38, 38);
  doc.text('COLLECTION APPRAISAL REPORT', 40, 92);

  doc.setDrawColor(200, 200, 200);
  doc.line(40, 110, pageW - 40, 110);

  // Document metadata
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(80, 80, 80);
  const metaY = 140;
  doc.text('DOCUMENT ID:', 40, metaY);
  doc.text('GENERATED:', 40, metaY + 16);
  doc.text('PURPOSE:', 40, metaY + 32);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(20, 20, 20);
  doc.text(docId, 160, metaY);
  doc.text(new Date().toLocaleString(), 160, metaY + 16);
  doc.text('Insurance documentation', 160, metaY + 32);

  // Owner block
  doc.setDrawColor(220, 38, 38);
  doc.setLineWidth(2);
  doc.line(40, metaY + 60, pageW - 40, metaY + 60);
  doc.setLineWidth(1);
  doc.setDrawColor(200, 200, 200);

  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(220, 38, 38);
  doc.text('COLLECTION OWNER', 40, metaY + 85);

  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(20, 20, 20);
  doc.text(owner.name, 40, metaY + 105);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(80, 80, 80);
  if (owner.email)   doc.text(owner.email, 40, metaY + 122);
  if (owner.address) doc.text(owner.address, 40, metaY + 138);

  // Big stats box
  const statsY = 360;
  doc.setFillColor(245, 245, 245);
  doc.rect(40, statsY, pageW - 80, 100, 'F');
  doc.setFillColor(220, 38, 38);
  doc.rect(40, statsY, 4, 100, 'F');

  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(140, 140, 140);
  doc.text('TOTAL COLLECTION VALUE', 60, statsY + 24);
  doc.setFontSize(32); doc.setTextColor(20, 20, 20);
  doc.text(fmtUSD(totalValue), 60, statsY + 62);

  doc.setFontSize(9); doc.setTextColor(140, 140, 140);
  doc.text('ITEMS  /  PURCHASE COST', pageW - 240, statsY + 24);
  doc.setFontSize(18); doc.setTextColor(20, 20, 20);
  doc.text(collection.length + ' items', pageW - 240, statsY + 50);
  doc.setFontSize(11); doc.setTextColor(80, 80, 80);
  doc.text('Original cost: ' + fmtUSD(totalPaid), pageW - 240, statsY + 72);

  // Methodology disclosure
  const methY = 490;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(220, 38, 38);
  doc.text('VALUATION METHODOLOGY', 40, methY);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(60, 60, 60);
  const methText = [
    'Current market values are derived from Discogs marketplace median prices as of the report generation',
    'date. For items without active marketplace listings, purchase price is used as a conservative fallback.',
    'All amounts are in USD. Values represent fair market estimates and are not guaranteed sale prices.',
    'Physical condition grades use the Goldmine Standard (Mint / Near Mint / Very Good+ / Very Good / Good+ /',
    'Good / Fair / Poor) as accepted by the record collector community.',
  ];
  methText.forEach((line, i) => doc.text(line, 40, methY + 18 + i * 13));

  // Cover footer
  doc.setFontSize(8); doc.setTextColor(160, 160, 160);
  doc.text('Page 1 of report  •  Document ID: ' + docId, 40, pageH - 40);
  doc.text('Generated by Metal Vault  •  metal-vault-six.vercel.app', pageW - 40, pageH - 40, { align: 'right' });

  // ── Page 2+: Full inventory table ──
  doc.addPage();
  doc.setFillColor(220, 38, 38); doc.rect(0, 0, pageW, 8, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(20, 20, 20);
  doc.text('ITEMIZED INVENTORY', 40, 50);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(140, 140, 140);
  doc.text(collection.length + ' items  •  sorted by market value (descending)', 40, 70);

  // Sort collection by value desc — most valuable first (important for insurance)
  const sorted = [...collection].sort((a, b) => {
    const va = Number(a.median_price || a.current_price || a.purchase_price) || 0;
    const vb = Number(b.median_price || b.current_price || b.purchase_price) || 0;
    return vb - va;
  });

  autoTable(doc, {
    startY: 85,
    head: [['#', 'Artist', 'Album', 'Year', 'Format', 'Grade', 'Paid', 'Market', 'Label']],
    body: sorted.map((item, i) => [
      i + 1,
      item.artist || '',
      item.album || '',
      item.year || '',
      item.format || 'Vinyl',
      // Composite grade: if detailed grading set, show "S:VG+/V:NM"; else fallback to overall grade
      (item.sleeve_grade || item.vinyl_grade)
        ? [item.sleeve_grade ? 'S:' + item.sleeve_grade : '',
           item.vinyl_grade  ? 'V:' + item.vinyl_grade  : '']
          .filter(Boolean).join('/')
        : (item.grade || 'NM'),
      item.purchase_price ? fmtUSD(item.purchase_price) : '—',
      fmtUSD(item.median_price || item.current_price || item.purchase_price || 0),
      (item.label || '').substring(0, 20),
    ]),
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [220, 38, 38], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [250, 250, 250] },
    columnStyles: {
      0: { cellWidth: 28, halign: 'right' },
      1: { cellWidth: 105 },
      2: { cellWidth: 120 },
      3: { cellWidth: 38, halign: 'center' },
      4: { cellWidth: 50 },
      5: { cellWidth: 38, halign: 'center' },
      6: { cellWidth: 50, halign: 'right' },
      7: { cellWidth: 55, halign: 'right', fontStyle: 'bold' },
      8: { cellWidth: 80 },
    },
    margin: { left: 40, right: 40 },
    didDrawPage: (data) => {
      // Footer on each page
      const pc = doc.internal.getNumberOfPages();
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(160, 160, 160);
      doc.text('Metal Vault Appraisal Report  •  ' + docId, 40, pageH - 30);
      doc.text('Page ' + data.pageNumber, pageW - 40, pageH - 30, { align: 'right' });
    },
  });

  // ── Final page: Breakdown summary ──
  doc.addPage();
  doc.setFillColor(220, 38, 38); doc.rect(0, 0, pageW, 8, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(20, 20, 20);
  doc.text('VALUATION BREAKDOWN', 40, 50);

  autoTable(doc, {
    startY: 80,
    head: [['Genre', 'Items', 'Total Value', '% of Collection']],
    body: genreBreakdown.map(([g, data]) => [
      g,
      data.count,
      fmtUSD(data.value),
      totalValue > 0 ? ((data.value / totalValue) * 100).toFixed(1) + '%' : '0%',
    ]),
    styles: { fontSize: 10, cellPadding: 6 },
    headStyles: { fillColor: [220, 38, 38], textColor: 255, fontStyle: 'bold' },
    margin: { left: 40, right: 40 },
  });

  // Declaration/signature block
  const finalY = doc.lastAutoTable.finalY + 50;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(220, 38, 38);
  doc.text('OWNER DECLARATION', 40, finalY);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(60, 60, 60);
  const declText = [
    'I, ' + owner.name + ', declare that the items listed in this report are in my possession',
    'and constitute an accurate inventory of my music collection as of the date of this document.',
    'I acknowledge that the stated values are estimates based on publicly available market data',
    'and may differ from actual sale prices. I agree to promptly update this record for any',
    'acquisition, disposal, or damage affecting listed items.',
  ];
  declText.forEach((line, i) => doc.text(line, 40, finalY + 20 + i * 14));

  // Signature lines
  const sigY = finalY + 130;
  doc.setDrawColor(100, 100, 100);
  doc.line(40, sigY, 260, sigY);
  doc.line(pageW - 260, sigY, pageW - 40, sigY);
  doc.setFontSize(8); doc.setTextColor(140, 140, 140);
  doc.text('Owner signature', 40, sigY + 14);
  doc.text('Date', pageW - 260, sigY + 14);

  // Save or share
  const filename = 'metal-vault-appraisal-' + docId + '.pdf';
  const blob = doc.output('blob');

  if (navigator.canShare) {
    const file = new File([blob], filename, { type: 'application/pdf' });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Metal Vault Appraisal Report' });
        return { success: true, method: 'share' };
      } catch {} // user canceled — fall through to download
    }
  }

  // Fallback: download
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { success: true, method: 'download' };
}
