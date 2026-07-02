/**
 * CustomFieldsRenderer — shared component for rendering admin-defined custom
 * fields on any entity (ticket, asset, kb_article).
 *
 * Props:
 *   fields         — array of field definitions from /custom-fields/?applies_to=X
 *   values         — current {field_key: value, ...} dict
 *   onChange(key, val) — called when a value changes (edit mode)
 *   readOnly       — if true, renders values as plain text labels (view mode)
 */
export default function CustomFieldsRenderer({ fields = [], values = {}, onChange, readOnly = false }) {
  if (!fields.length) return null;

  const inp = "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500";
  const lbl = "block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1";

  if (readOnly) {
    return (
      <div className="space-y-2">
        {fields.map(field => {
          const val = values?.[field.field_key];
          if (!val && val !== false && val !== 0) return null;
          return (
            <div key={field.id} className="flex gap-2 text-sm">
              <span className="text-gray-500 dark:text-gray-400 font-medium min-w-[120px] flex-shrink-0">{field.name}:</span>
              <span className="text-gray-800 dark:text-gray-200">
                {field.field_type === 'checkbox' ? (val ? '✅ Yes' : '❌ No') : String(val)}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {fields.map(field => (
        <div key={field.id}>
          <label className={lbl}>
            {field.name}
            {field.is_required && <span className="text-red-500 ml-0.5">*</span>}
            <span className="ml-1 text-xs font-normal text-gray-400">
              ({field.field_type})
            </span>
          </label>

          {field.field_type === 'text' && (
            <input type="text" value={values?.[field.field_key] || ''}
                   onChange={e => onChange(field.field_key, e.target.value)}
                   className={inp} />
          )}
          {field.field_type === 'number' && (
            <input type="number" value={values?.[field.field_key] || ''}
                   onChange={e => onChange(field.field_key, e.target.value ? Number(e.target.value) : '')}
                   className={inp} />
          )}
          {field.field_type === 'date' && (
            <input type="date" value={values?.[field.field_key] || ''}
                   onChange={e => onChange(field.field_key, e.target.value)}
                   className={inp} />
          )}
          {field.field_type === 'dropdown' && (
            <select value={values?.[field.field_key] || ''}
                    onChange={e => onChange(field.field_key, e.target.value)}
                    className={inp}>
              <option value="">— Select —</option>
              {(field.options || []).map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          )}
          {field.field_type === 'checkbox' && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={!!values?.[field.field_key]}
                     onChange={e => onChange(field.field_key, e.target.checked)}
                     className="w-4 h-4 rounded border-gray-300 text-indigo-600" />
              <span className="text-sm text-gray-600 dark:text-gray-400">{field.name}</span>
            </label>
          )}
        </div>
      ))}
    </div>
  );
}
