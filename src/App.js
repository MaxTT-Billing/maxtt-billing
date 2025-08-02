import React, { useState } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export default function BillingApp() {
  const [vehicleType, setVehicleType] = useState('Passenger Car');
  const [tyreSize, setTyreSize] = useState({ width: '', aspect: '', rim: '' });
  const [dosage, setDosage] = useState(null);

  const [customerInfo, setCustomerInfo] = useState({
    name: '',
    vehicleNo: '',
    mobile: '',
    odometer: '',
    treadDepth: '',
    installer: '',
  });

  const [pricePerML, setPricePerML] = useState(2.5);
  const [discount, setDiscount] = useState(0);

  const K_VALUES = {
    "Scooter": 2.20,
    "Motorcycle": 2.60,
    "Passenger Car": 2.48,
    "SUV": 2.65,
    "Light Truck/LCV": 2.20,
    "Heavy Truck/Bus": 3.00,
    "Mining/Off-Road": 7.00,
  };

  const BUFFER = {
    "Scooter": 0,
    "Motorcycle": 1,
    "Passenger Car": 1,
    "SUV": 1,
    "Light Truck/LCV": 2,
    "Heavy Truck/Bus": 2,
    "Mining/Off-Road": 3,
  };

  const calculateDosage = () => {
    const widthIn = parseFloat(tyreSize.width) * 0.03937;
    const aspectRatio = parseFloat(tyreSize.aspect);
    const rim = parseFloat(tyreSize.rim);
    const totalHeightIn = (widthIn * (aspectRatio / 100) * 2) + rim;
    const k = K_VALUES[vehicleType];
    const baseDosage = widthIn * totalHeightIn * k;
    const bufferFactor = 1 + (BUFFER[vehicleType] / 100);
    const finalDosage = Math.round(baseDosage * bufferFactor / 25) * 25;
    setDosage(finalDosage);
  };

  const calculateAmount = () => {
    const subtotal = dosage * pricePerML;
    const discounted = subtotal - discount;
    const gst = discounted * 0.18;
    return {
      subtotal,
      discounted,
      gst,
      total: discounted + gst,
    };
  };

  const generatePDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(12);
    doc.text("MaxTT Tyre Sealant Invoice", 14, 20);

    doc.text(`Customer Name: ${customerInfo.name}`, 14, 30);
    doc.text(`Vehicle No: ${customerInfo.vehicleNo}`, 14, 36);
    doc.text(`Mobile: ${customerInfo.mobile}`, 14, 42);
    doc.text(`Odometer: ${customerInfo.odometer} km`, 14, 48);
    doc.text(`Tread Depth: ${customerInfo.treadDepth} mm`, 14, 54);
    doc.text(`Installer: ${customerInfo.installer}`, 14, 60);

    autoTable(doc, {
      head: [["Vehicle Type", "Tyre Size (W/A/R)", "Dosage (ml)", "Rate/ml", "Subtotal"]],
      body: [[
        vehicleType,
        `${tyreSize.width}/${tyreSize.aspect}R${tyreSize.rim}`,
        `${dosage} ml`,
        `₹${pricePerML}`,
        `₹${(dosage * pricePerML).toFixed(2)}`
      ]],
      startY: 70
    });

    const amt = calculateAmount();
    doc.text(`Discount: ₹${discount.toFixed(2)}`, 14, 100);
    doc.text(`GST (18%): ₹${amt.gst.toFixed(2)}`, 14, 106);
    doc.text(`Total: ₹${amt.total.toFixed(2)}`, 14, 112);

    doc.setFontSize(10);
    doc.text("\nDisclaimer & Indemnity:", 14, 130);
    const disclaimer = `The MaxTT Tyre Sealant is a preventive maintenance product designed to minimize the risk of punctures and tyre deflation during normal vehicle operation. While it significantly reduces such risks, it does not eliminate them entirely. The effectiveness of the sealant is optimized for tyres operated within legally permitted speed limits. Use beyond such limits, improper application or misuse may void performance expectations. Treadstone Solutions assumes no liability for misuse or damage. All disputes subject to Gurgaon jurisdiction.`;
    const splitText = doc.splitTextToSize(disclaimer, 180);
    doc.text(splitText, 14, 135);

    doc.save("MaxTT_Invoice.pdf");
  };

  const amount = dosage ? calculateAmount() : null;

  return (
    <div style={{ maxWidth: '800px', margin: 'auto', padding: '20px' }}>
      <h2>MaxTT Billing & Dosage Calculator</h2>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        <input placeholder="Customer Name" value={customerInfo.name} onChange={(e) => setCustomerInfo({ ...customerInfo, name: e.target.value })} />
        <input placeholder="Vehicle Number" value={customerInfo.vehicleNo} onChange={(e) => setCustomerInfo({ ...customerInfo, vehicleNo: e.target.value })} />
        <input placeholder="Mobile Number" value={customerInfo.mobile} onChange={(e) => setCustomerInfo({ ...customerInfo, mobile: e.target.value })} />
        <input placeholder="Odometer Reading" value={customerInfo.odometer} onChange={(e) => setCustomerInfo({ ...customerInfo, odometer: e.target.value })} />
        <input placeholder="Tread Depth (mm)" value={customerInfo.treadDepth} onChange={(e) => setCustomerInfo({ ...customerInfo, treadDepth: e.target.value })} />
        <input placeholder="Installer Name" value={customerInfo.installer} onChange={(e) => setCustomerInfo({ ...customerInfo, installer: e.target.value })} />
      </div>

      <br />
      <label>Vehicle Type</label>
      <select value={vehicleType} onChange={(e) => setVehicleType(e.target.value)}>
        {Object.keys(K_VALUES).map(type => <option key={type}>{type}</option>)}
      </select>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginTop: '10px' }}>
        <input type="number" placeholder="Tyre Width (mm)" value={tyreSize.width} onChange={(e) => setTyreSize({ ...tyreSize, width: e.target.value })} />
        <input type="number" placeholder="Aspect Ratio (%)" value={tyreSize.aspect} onChange={(e) => setTyreSize({ ...tyreSize, aspect: e.target.value })} />
        <input type="number" placeholder="Rim Diameter (in)" value={tyreSize.rim} onChange={(e) => setTyreSize({ ...tyreSize, rim: e.target.value })} />
      </div>

      <br />
      <button onClick={calculateDosage}>Calculate Dosage</button>

      {dosage && (
        <>
          <p>Recommended Dosage: {dosage} ml</p>
          <p>Price per ml: ₹{pricePerML}</p>
          <input type="number" placeholder="Discount ₹ (before GST)" value={discount} onChange={(e) => setDiscount(parseFloat(e.target.value) || 0)} />
          <p>Subtotal: ₹{amount.subtotal.toFixed(2)}</p>
          <p>After Discount: ₹{amount.discounted.toFixed(2)}</p>
          <p>GST (18%): ₹{amount.gst.toFixed(2)}</p>
          <h3>Total: ₹{amount.total.toFixed(2)}</h3>
          <button onClick={generatePDF}>Download PDF Invoice</button>
        </>
      )}
    </div>
  );
}
