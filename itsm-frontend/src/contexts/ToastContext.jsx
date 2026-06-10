import { createContext, useContext, useState, useCallback } from 'react';

const ToastContext = createContext();

let idCounter = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = 'error', duration = 4000) => {
    const id = ++idCounter;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, duration);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = {
    error:   (msg, duration) => addToast(msg, 'error', duration),
    success: (msg, duration) => addToast(msg, 'success', duration),
    warning: (msg, duration) => addToast(msg, 'warning', duration),
    info:    (msg, duration) => addToast(msg, 'info', duration),
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

const STYLES = {
  error:   { bar: 'bg-red-500',    icon: '✕', bg: 'bg-red-50 dark:bg-red-900/80',   border: 'border-red-200 dark:border-red-700',   text: 'text-red-800 dark:text-red-200' },
  success: { bar: 'bg-green-500',  icon: '✓', bg: 'bg-green-50 dark:bg-green-900/80', border: 'border-green-200 dark:border-green-700', text: 'text-green-800 dark:text-green-200' },
  warning: { bar: 'bg-yellow-500', icon: '⚠', bg: 'bg-yellow-50 dark:bg-yellow-900/80', border: 'border-yellow-200 dark:border-yellow-700', text: 'text-yellow-800 dark:text-yellow-200' },
  info:    { bar: 'bg-blue-500',   icon: 'ℹ', bg: 'bg-blue-50 dark:bg-blue-900/80',  border: 'border-blue-200 dark:border-blue-700',  text: 'text-blue-800 dark:text-blue-200' },
};

function ToastContainer({ toasts, onRemove }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 max-w-sm w-full pointer-events-none">
      {toasts.map(t => (
        <Toast key={t.id} toast={t} onRemove={onRemove} />
      ))}
    </div>
  );
}

function Toast({ toast, onRemove }) {
  const s = STYLES[toast.type] || STYLES.error;
  return (
    <div className={`pointer-events-auto flex items-start gap-3 rounded-xl border shadow-lg px-4 py-3 ${s.bg} ${s.border} animate-slide-in`}>
      <div className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ${s.bar}`}>
        {s.icon}
      </div>
      <p className={`text-sm flex-1 font-medium ${s.text}`}>{toast.message}</p>
      <button
        onClick={() => onRemove(toast.id)}
        className={`text-lg leading-none flex-shrink-0 opacity-50 hover:opacity-100 transition ${s.text}`}
      >
        ×
      </button>
    </div>
  );
}
