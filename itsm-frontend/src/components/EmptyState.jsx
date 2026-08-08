import { Link } from 'react-router-dom';

export function EmptyState({ icon, title, desc, cta, secondaryCta, children }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="relative mb-5">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-900/30 dark:to-purple-900/30 flex items-center justify-center shadow-inner border border-indigo-100 dark:border-indigo-800">
          <span className="text-4xl" role="img">{icon}</span>
        </div>
        <div className="absolute inset-0 rounded-2xl bg-indigo-400/10 blur-xl -z-10" />
      </div>
      <h3 className="text-base font-semibold text-gray-800 dark:text-white mb-1.5">{title}</h3>
      {desc && <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm mb-5 leading-relaxed">{desc}</p>}
      {children}
      {(cta || secondaryCta) && (
        <div className="flex flex-wrap gap-3 justify-center mt-1">
          {cta && (cta.onClick
            ? <button onClick={cta.onClick} className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl text-sm font-medium transition shadow-sm flex items-center gap-2">{cta.icon && <span>{cta.icon}</span>}{cta.label}</button>
            : <Link to={cta.to} className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl text-sm font-medium transition shadow-sm flex items-center gap-2">{cta.icon && <span>{cta.icon}</span>}{cta.label}</Link>
          )}
          {secondaryCta && (secondaryCta.onClick
            ? <button onClick={secondaryCta.onClick} className="border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 px-5 py-2.5 rounded-xl text-sm font-medium transition flex items-center gap-2">{secondaryCta.icon && <span>{secondaryCta.icon}</span>}{secondaryCta.label}</button>
            : <Link to={secondaryCta.to} className="border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 px-5 py-2.5 rounded-xl text-sm font-medium transition flex items-center gap-2">{secondaryCta.icon && <span>{secondaryCta.icon}</span>}{secondaryCta.label}</Link>
          )}
        </div>
      )}
    </div>
  );
}

export default EmptyState;
