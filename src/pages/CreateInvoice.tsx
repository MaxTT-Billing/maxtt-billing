import React, { useState } from 'react';

type Json = Record<string, any>;
const defaultApiBase = (typeof window !== 'undefined' && (window as any).__BILLING_API_BASE__) || '';

export default function CreateInvoice() {
  const [apiBase, setApiBase] = useState<string>(defaultApiBase);
  const [franchiseeCode, setFranchiseeCode] = useState('MAXTT-DEMO-001');
  const [invoiceNumber, setInvoiceNumber] = useState('MAXTT-DEMO-001/XX/0056/0825');
  const [createdAt, setCreatedAt] = useState<string>(new Date().toISOString().slice(0, 10)); // yyyy-mm-dd
  const [totalWithGst, setTotalWithGst] = useState<number>(12154);
  const [remarks, setRemarks] = useState<string>(''); // e.g. REF: MAXTT-DEL-001/XX/0042/0825
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Json | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);

    if (!apiBase) return setError('Enter Billing API base URL (e.g. https://<your-billing-api>.onrender.com)');
    if (!franchiseeCode) return setError('Franchisee code is required.');
    if (!invoiceNumber) return setError('Invoice number is required.');
    if (!createdAt) return setError('Invoice date is required.');

    const body: Json = {
      franchisee_code: franchiseeCode,
      invoice_number: invoiceNumber,
      total_with_gst: Number(totalWithGst),
      created_at: new Date(createdAt).toISOString(),
    };

    // Only include remarks if the user typed anything.
    if (remarks.trim()) body.remarks = remarks.trim();

    setBusy(true);
    try {
      const resp = await fetch(`${apiBase.replace(/\/+$/, '')}/api/invoices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) setError(data?.message || data?.error || `HTTP ${resp.status}`);
      else setResult(data);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen w-full p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Create Invoice (Remarks for Referral)</h1>

      <div className="mb-6 space-y-2">
        <label className="block text-sm font-medium">Billing API Base URL</label>
        <input
          className="w-full border rounded px-3 py-2"
          placeholder="https://<your-billing-api>.onrender.com"
          value={apiBase}
          onChange={(e) => setApiBase(e.target.value)}
        />
        <p className="text-xs text-gray-500">
          Use your <b>Billing API</b> URL from Render (not the Referrals API).
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-5">
        <div>
          <label className="block text-sm font-medium">Franchisee Code</label>
          <input
            className="w-full border rounded px-3 py-2"
            value={franchiseeCode}
            onChange={(e) => setFranchiseeCode(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-sm font-medium">Invoice Number (printed)</label>
          <input
            className="w-full border rounded px-3 py-2"
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
          />
          <p className="text-xs text-gray-500">
            Paste exactly as printed, e.g. <code>MAXTT-DEMO-001/XX/0056/0825</code>
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium">Invoice Date</label>
          <input
            type="date"
            className="w-full border rounded px-3 py-2"
            value={createdAt}
            onChange={(e) => setCreatedAt(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-sm font-medium">Total with GST (₹)</label>
          <input
            type="number"
            className="w-full border rounded px-3 py-2"
            value={totalWithGst}
            onChange={(e) => setTotalWithGst(Number(e.target.value))}
          />
        </div>

        <div>
          <label className="block text-sm font-medium">Remarks (internal)</label>
          <textarea
            className="w-full border rounded px-3 py-2 h-24"
            placeholder={`REF: MAXTT-DEL-001/XX/0042/0825\n(or REF: MAXTT-DEL-001-0042)`}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
          />
          <p className="text-xs text-gray-500">
            Leave empty = no referral. If present, the server will parse the code and send to Seal & Earn automatically.
          </p>
        </div>

        <button type="submit" disabled={busy} className="px-4 py-2 rounded bg-black text-white disabled:opacity-50">
          {busy ? 'Saving…' : 'Create Invoice'}
        </button>
      </form>

      {error && (
        <div className="mt-6 p-3 border rounded text-red-700 bg-red-50">
          <b>Error:</b> {error}
        </div>
      )}
      {result && (
        <div className="mt-6 p-3 border rounded bg-gray-50 overflow-auto">
          <div className="font-medium mb-2">Response</div>
          <pre className="text-xs">{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
