// Shared look for exported PDF reports: deep green table headers, a thin gold rule
// under the title, and a quiet footer with page numbers.

export const GREEN = [22, 58, 47];
export const GOLD = [176, 141, 87];
export const IVORY = [250, 247, 240];
export const INK = [23, 32, 28];
export const MUTED = [118, 122, 114];

export function pdfHeader(doc, title, subtitle) {
  const w = doc.internal.pageSize.getWidth();
  doc.setTextColor(...MUTED);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("UNIFIED ACCOUNTS PLATFORM", 14, 13, { charSpace: 0.6 });
  doc.setTextColor(...INK);
  doc.setFont("times", "bold");
  doc.setFontSize(17);
  doc.text(title, 14, 22);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(...MUTED);
  if (subtitle) doc.text(subtitle, 14, 28.5);
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.5);
  doc.line(14, 32, w - 14, 32);
  doc.setTextColor(...INK);
  return 37;
}

export function pdfSectionTitle(doc, text, y) {
  doc.setFont("times", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...INK);
  doc.text(text, 14, y);
  doc.setFont("helvetica", "normal");
  return y + 3;
}

// Common jspdf-autotable options.
export function tableStyle(extra = {}) {
  const cols = extra.columnStyles || {};
  return {
    // Header and total cells follow their column's alignment, so number headings sit over the numbers.
    didParseCell: (d) => {
      if (d.section !== "body" && cols[d.column.index] && cols[d.column.index].halign) {
        d.cell.styles.halign = cols[d.column.index].halign;
      }
    },
    theme: "plain",
    headStyles: { fillColor: GREEN, textColor: 255, fontStyle: "bold", fontSize: 8.5, cellPadding: 2.6 },
    styles: { fontSize: 9, cellPadding: 2.4, textColor: INK, lineColor: [231, 225, 213], lineWidth: { bottom: 0.2 } },
    alternateRowStyles: { fillColor: IVORY },
    margin: { left: 14, right: 14 },
    ...extra,
  };
}

export function pdfFooter(doc) {
  const pages = doc.getNumberOfPages();
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  const stamp = new Date().toISOString().slice(0, 10);
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(`Generated ${stamp}`, 14, h - 8);
    doc.text(`Page ${i} of ${pages}`, w - 14, h - 8, { align: "right" });
  }
}
