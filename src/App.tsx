import React from 'react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import CreateInvoice from './pages/CreateInvoice';

export default function App() {
  return (
    <BrowserRouter>
      <div className="p-4 border-b">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Link to="/" className="text-lg font-semibold">MaxTT Billing</Link>
          <nav className="space-x-4">
            <Link to="/create-invoice" className="underline">Create Invoice</Link>
          </nav>
        </div>
      </div>
      <div className="max-w-5xl mx-auto">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/create-invoice" element={<CreateInvoice />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

function Home() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-2">Welcome</h1>
      <p className="text-sm text-gray-600">
        Use the Create Invoice screen to test Remarks-based referral capture.
      </p>
    </div>
  );
}
