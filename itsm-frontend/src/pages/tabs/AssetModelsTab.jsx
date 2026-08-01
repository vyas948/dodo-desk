import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { apiFetch } from '../../apiFetch';
import { useTranslation } from '../../i18n/I18nContext';

export default function AssetModelsTab() {
  const { token } = useAuth();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [activeType, setActiveType] = useState('hardware');
  const [options, setOptions]       = useState([]);
  const [newLabel, setNewLabel]     = useState('');
  const [loading, setLoading]       = useState(true);
  const [adding, setAdding]         = useState(false);

  const TYPES = [
    { value: 'hardware',   label: t('settings.assetTypeLaptop') },
    { value: 'software',   label: t('settings.assetTypeSoftware') },
    { value: 'network',    label: t('settings.assetTypeNetwork') },
    { value: 'mobile',     label: t('settings.assetTypeMobile') },
    { value: 'peripheral', label: t('settings.assetTypePeripheral') },
    { value: 'saas',       label: t('settings.assetTypeSaas') },
    { value: 'cloud',      label: t('settings.assetTypeCloud') },
    { value: 'other',      label: t('settings.assetTypeOther') },
  ];

  const fetchOptions = (type = activeType) => {
    setLoading(true);
    apiFetch(`/asset-model-options/?asset_type=${type}`, token)
      .then(opts => setOptions(opts || []))
      .catch(e => toast.error(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchOptions(activeType); }, [activeType, token]);

  const handleAdd = async () => {
    if (!newLabel.trim()) return;
    setAdding(true);
    try {
      await apiFetch('/asset-model-options/', token, {
        method: 'POST',
        body: JSON.stringify({ asset_type: activeType, label: newLabel.trim(), sort_order: options.length }),
      });
      setNewLabel('');
      fetchOptions();
      toast.success(t('settings.modelAdded'));
    } catch (e) { toast.error(e.message); }
    finally { setAdding(false); }
  };

  const handleDelete = async (id) => {
    try {
      await apiFetch(`/asset-model-options/${id}`, token, { method: 'DELETE' });
      setOptions(opts => opts.filter(o => o.id !== id));
    } catch (e) { toast.error(e.message); }
  };

  const inp  = "flex-1 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500";
  const card = "bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5";
  const activeTypeLabel = TYPES.find(tp => tp.value === activeType)?.label || activeType;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white">{t('settings.assetModelsTitle')}</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{t('settings.assetModelsDesc')}</p>
      </div>

      <div className="flex gap-1 flex-wrap">
        {TYPES.map(tp => (
          <button key={tp.value} onClick={() => setActiveType(tp.value)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${activeType===tp.value ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
            {tp.label}
          </button>
        ))}
      </div>

      <div className={card}>
        <h4 className="font-medium text-gray-800 dark:text-white mb-3">
          {t('settings.modelsCount').replace('{label}', activeTypeLabel)}
          <span className="ml-2 text-xs font-normal text-gray-400">({options.length})</span>
        </h4>

        <div className="flex gap-2 mb-4">
          <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
                 onKeyDown={e => e.key === 'Enter' && handleAdd()}
                 placeholder={t('settings.modelPlaceholder')} className={inp} />
          <button onClick={handleAdd} disabled={adding || !newLabel.trim()}
                  className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 transition disabled:opacity-50">
            {adding ? t('settings.adding') : t('settings.addModel')}
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-gray-400 text-center py-6">{t('settings.loading')}</p>
        ) : options.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">{t('settings.noModels')}</p>
        ) : (
          <div className="space-y-1.5 max-h-80 overflow-y-auto">
            {options.map(o => (
              <div key={o.id} className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-700 rounded-lg group">
                <span className="text-sm text-gray-700 dark:text-gray-300">{o.label}</span>
                <button onClick={() => handleDelete(o.id)}
                        className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition text-sm">
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400">{t('settings.assetModelsHint')}</p>
    </div>
  );
}
