const EXPLORER_TX_BASE =
  process.env.ARC_EXPLORER_TX_BASE?.trim() || 'https://testnet.arcscan.app/tx/';

export function arcscanTxViewUrl(txHash: string): string {
  const base = EXPLORER_TX_BASE.replace(/\/+$/, '');
  return `${base}/${txHash.replace(/^\/+/, '')}`;
}

export function feeUsdcStringFromLabel(priceLabel: string): string {
  const n = Number(String(priceLabel).replace(/^\$/, '').trim());
  if (!Number.isFinite(n) || n < 0) return '0.000';
  return n.toFixed(3);
}

/** Short display hash e.g. 0xabcd...9abc */
export function shortHash(hash: string): string {
  if (!hash) return '';
  return hash.slice(0, 6) + '...' + hash.slice(-4);
}

/** Single-line x402 fee disclosure for swap/vault receipts */
export function formatX402NanopaymentFeeLine(priceLabel: string): string {
  return `x402 nanopayment · ${feeUsdcStringFromLabel(priceLabel)} USDC`;
}

export function formatNanopaymentRequestLine(requestId: string | undefined | null): string {
  const id = requestId?.trim();
  if (id) {
    const shortId = id.length <= 12 ? id : id.slice(-12);
    return `Request: req_${shortId}`;
  }
  return 'Gateway payment authorized';
}
