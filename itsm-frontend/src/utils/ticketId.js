/**
 * Format a ticket or change ID with a prefix based on type.
 *   incident       → INC000042
 *   service_request → SR000042
 *   change         → CR000042
 */
export function formatId(id, type) {
  const padded = String(id).padStart(6, '0');
  if (type === 'service_request') return `REQ${padded}`;
  if (type === 'change') return `CHG${padded}`;
  return `INC${padded}`;
}
