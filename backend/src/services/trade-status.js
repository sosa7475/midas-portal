// Keep the journal's existing states while translating exchange status names.
// Orderly reference: https://orderly.network/docs/build-on-omnichain/restful-api/private/get-orders
function journalStatus(status) {
  if (typeof status !== 'string') return null;
  switch (status.toUpperCase()) {
    case 'PENDING':
    case 'SUBMITTED': return 'pending';
    case 'NEW':
    case 'PARTIAL_FILLED':
    case 'CONFIRMED': return 'confirmed';
    case 'FILLED': return 'filled';
    case 'CANCELLED': return 'cancelled';
    case 'REJECTED': return 'rejected';
    default: return null;
  }
}
module.exports = { journalStatus };
