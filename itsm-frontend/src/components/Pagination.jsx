/**
 * Pagination component — numbered pages with prev/next.
 * Props:
 *   total      - total number of items
 *   page       - current page (1-based)
 *   pageSize   - items per page (default 20)
 *   onPageChange(page) - callback
 */
export default function Pagination({ total, page, pageSize, limit, onPageChange }) {
  const size = pageSize || limit || 20;
  const totalPages = Math.ceil(total / size);
  if (totalPages <= 1) return null;

  // Build page number array with ellipsis
  const getPages = () => {
    const pages = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (page > 3) pages.push('...');
      for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
        pages.push(i);
      }
      if (page < totalPages - 2) pages.push('...');
      pages.push(totalPages);
    }
    return pages;
  };

  const btnBase = "px-3 py-1.5 rounded-lg text-sm font-medium transition";
  const btnActive = `${btnBase} bg-indigo-600 text-white`;
  const btnInactive = `${btnBase} bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700`;
  const btnDisabled = `${btnBase} bg-white dark:bg-gray-800 text-gray-300 dark:text-gray-600 border border-gray-200 dark:border-gray-700 cursor-not-allowed`;

  return (
    <div className="flex items-center justify-between mt-4 px-1">
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Showing {Math.min((page - 1) * size + 1, total)}–{Math.min(page * size, total)} of {total}
      </p>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page === 1}
          className={page === 1 ? btnDisabled : btnInactive}
        >
          ←
        </button>
        {getPages().map((p, i) =>
          p === '...'
            ? <span key={`ellipsis-${i}`} className="px-2 text-gray-400 dark:text-gray-500">…</span>
            : <button key={p} onClick={() => onPageChange(p)} className={p === page ? btnActive : btnInactive}>{p}</button>
        )}
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page === totalPages}
          className={page === totalPages ? btnDisabled : btnInactive}
        >
          →
        </button>
      </div>
    </div>
  );
}
