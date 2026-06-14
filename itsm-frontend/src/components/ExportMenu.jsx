import { useState, useRef, useEffect } from 'react';
import { exportToCSV, exportToXLSX, exportToPDF } from '../exportUtils';

/**
 * Dropdown export button supporting CSV, XLSX, and branded PDF.
 *
 * @param {Object} props
 * @param {() => Promise<{headers: string[], rows: any[][]}>} props.getData - async fn returning headers/rows
 * @param {string} props.filename - filename without extension
 * @param {string} [props.title] - PDF title
 * @param {Object} [props.branding] - { logo_url, primary_color, name }
 * @param {string} [props.label] - button label (default "Export")
 * @param {string} [props.className] - button styling
 */
export default function ExportMenu({ getData, filename, title, branding, label = 'Export', className }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handle = async (format) => {
    setOpen(false);
    setLoading(true);
    try {
      const { headers, rows } = await getData();
      if (!rows || rows.length === 0) {
        alert('No data to export.');
        return;
      }
      if (format === 'csv') exportToCSV({ headers, rows, filename });
      else if (format === 'xlsx') exportToXLSX({ headers, rows, filename });
      else if (format === 'pdf') await exportToPDF({ headers, rows, filename, title, branding });
    } catch (err) {
      alert('Export failed: ' + (err?.message || 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  const defaultClass = "bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700 dark:bg-green-500 dark:hover:bg-green-600 transition flex items-center gap-1.5";

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)} disabled={loading} className={className || defaultClass}>
        {loading ? 'Exporting...' : label}
        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-36 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-20 overflow-hidden">
          <button onClick={() => handle('csv')} className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition">
            📄 CSV
          </button>
          <button onClick={() => handle('xlsx')} className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition">
            📊 Excel (.xlsx)
          </button>
          <button onClick={() => handle('pdf')} className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition">
            📕 PDF
          </button>
        </div>
      )}
    </div>
  );
}
