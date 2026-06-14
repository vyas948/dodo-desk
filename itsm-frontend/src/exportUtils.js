import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

/**
 * Shared export utilities for CSV, XLSX, and branded PDF.
 *
 * @param {Object} opts
 * @param {string[]} opts.headers - column headers
 * @param {Array<Array<string|number>>} opts.rows - row data, each row an array matching headers
 * @param {string} opts.filename - filename without extension
 * @param {string} [opts.title] - title shown in PDF header
 * @param {Object} [opts.branding] - { logo_url, primary_color, name } for PDF branding
 */

export function exportToCSV({ headers, rows, filename }) {
  const csv = [headers, ...rows]
    .map(row => row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, `${filename}.csv`);
}

export function exportToXLSX({ headers, rows, filename, sheetName = 'Sheet1' }) {
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  // Auto-size columns roughly based on content length
  const colWidths = headers.map((h, i) => {
    const maxLen = Math.max(
      String(h).length,
      ...rows.map(r => String(r[i] ?? '').length)
    );
    return { wch: Math.min(Math.max(maxLen + 2, 10), 50) };
  });
  worksheet['!cols'] = colWidths;

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, `${filename}.xlsx`);
}

export async function exportToPDF({ headers, rows, filename, title, branding, orientation = 'landscape' }) {
  const doc = new jsPDF({ orientation, unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const primaryColor = branding?.primary_color || '#4f46e5';
  const rgb = hexToRgb(primaryColor);

  let startY = 40;

  // Header bar
  doc.setFillColor(rgb.r, rgb.g, rgb.b);
  doc.rect(0, 0, pageWidth, 60, 'F');

  // Logo (if available and loadable)
  let textX = 40;
  if (branding?.logo_url) {
    try {
      const imgData = await loadImageAsDataURL(branding.logo_url);
      if (imgData) {
        doc.addImage(imgData, 'PNG', 40, 12, 36, 36);
        textX = 88;
      }
    } catch {
      // ignore logo load errors, fall back to text-only header
    }
  }

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont(undefined, 'bold');
  doc.text(branding?.company_name || 'DodoDesk', textX, 30);

  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.text(title || filename, textX, 46);

  // Date generated
  doc.setFontSize(8);
  doc.text(`Generated: ${new Date().toLocaleString()}`, pageWidth - 40, 20, { align: 'right' });

  startY = 80;

  autoTable(doc, {
    head: [headers],
    body: rows.map(row => row.map(v => String(v ?? ''))),
    startY,
    theme: 'striped',
    headStyles: { fillColor: [rgb.r, rgb.g, rgb.b], textColor: 255, fontStyle: 'bold' },
    styles: { fontSize: 8, cellPadding: 4 },
    margin: { top: 80, left: 30, right: 30 },
  });

  doc.save(`${filename}.pdf`);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function hexToRgb(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const num = parseInt(hex, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function loadImageAsDataURL(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
