/* ====== CONFIG - replace with your Supabase project keys ====== */
const SUPABASE_URL = "https://ecpmxvyzbjxssgkwqhzm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjcG14dnl6Ymp4c3Nna3dxaHptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ5OTgzODMsImV4cCI6MjA3MDU3NDM4M30.rQcIRfmG-ysA_szPFt-SVyoYZex74b9E7AidhH64G_I";
/* ============================================================ */

// ✅ Create Supabase client immediately after load
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let items = [];
let lastSavedInvoice = null;

/* DOM */
const productNameInput = document.getElementById('product_name');
const qtyInput = document.getElementById('quantity');
const priceUnitInput = document.getElementById('price_unit');
const itemsTable = document.getElementById('itemsTable');
const itemsTbody = itemsTable.querySelector('tbody');
const subtotalText = document.getElementById('subtotalText');
const codInput = document.getElementById('cod_fees');
const grandTotalText = document.getElementById('grandTotalText');
const downloadPDFBtn = document.getElementById('downloadPDF');
const statusEl = document.getElementById('status');

document.getElementById('addProductBtn').addEventListener('click', () => {
  const name = productNameInput.value.trim();
  const qty = parseInt(qtyInput.value || 0);
  const price = parseFloat(priceUnitInput.value || 0);
  if (!name || qty <= 0 || isNaN(price)) {
    alert('Please provide valid product name, qty, and price.');
    return;
  }
  const total = +(qty * price).toFixed(2);
  items.push({ product_name: name, quantity: qty, price_unit: price, total_price: total });
  productNameInput.value=''; qtyInput.value=1; priceUnitInput.value='0.00';
  renderItems();
});

function renderItems() {
  itemsTbody.innerHTML = '';
  if (items.length === 0) {
    itemsTable.classList.add('hidden');
  } else {
    itemsTable.classList.remove('hidden');
  }
  let i = 0;
  for (const it of items) {
    i++;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i}</td>
      <td>${escapeHtml(it.product_name)}</td>
      <td>${it.quantity}</td>
      <td>${Number(it.price_unit).toFixed(2)}</td>
      <td>${Number(it.total_price).toFixed(2)}</td>
      <td><button data-index="${i-1}" class="removeBtn">Remove</button></td>
    `;
    itemsTbody.appendChild(tr);
  }
  document.querySelectorAll('.removeBtn').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      const idx = Number(e.target.dataset.index);
      items.splice(idx,1);
      renderItems();
    });
  });
  updateTotals();
}

function updateTotals() {
  const subtotal = items.reduce((s,it)=> s + (Number(it.total_price)||0), 0);
  subtotalText.textContent = `RM ${subtotal.toFixed(2)}`;
  const cod = parseFloat(codInput.value || 0);
  const grand = +(subtotal + (isNaN(cod)?0:cod)).toFixed(2);
  grandTotalText.textContent = `RM ${grand.toFixed(2)}`;
}

/* recalc on COD change */
codInput.addEventListener('input', updateTotals);

/* Save invoice to Supabase (invoices + invoice_items) */
document.getElementById('saveInvoiceBtn').addEventListener('click', async () => {
  statusEl.textContent = '';
  if (items.length === 0) { alert('Please add at least one product.'); return; }

  const buyer_name = document.getElementById('buyer_name').value.trim();
  const address = document.getElementById('address').value.trim();
  const phone = document.getElementById('phone').value.trim();
  const invoice_no = document.getElementById('invoice_no').value.trim() || new Date().getTime().toString();
  const invoice_date = document.getElementById('invoice_date').value || new Date().toISOString().slice(0,10);
  const cod_fees = parseFloat(codInput.value || 0);

  const subtotal = items.reduce((s,it)=> s + Number(it.total_price), 0);
  const grand_total = +(subtotal + cod_fees).toFixed(2);

  try {
    // ✅ 1. Check if buyer already has an invoice today
    const { data: existingInvoice, error: checkErr } = await supabaseClient
  .from('invoices')
  .select('*')
  .eq('buyer_name', buyer_name)
  .eq('invoice_date', invoice_date);

if (checkErr) throw checkErr;

    if (existingInvoice) {
  alert(`ℹ️ Creating a new invoice...`);

  // Generate new invoice number and date
  const newInvoiceNo = new Date().getTime().toString();
  const codFee = parseFloat(codInput.value || 0);
  const subtotalValue = items.reduce((s, it) => s + Number(it.total_price), 0);
  const grandTotalValue = +(subtotalValue + codFee).toFixed(2);

  // Insert new invoice
  const { data: invoiceDataArray, error: invErr } = await supabaseClient
    .from('invoices')
    .insert([{
      invoice_no: newInvoiceNo,
      buyer_name,
      address,
      phone,
      invoice_date,
      cod_fees: codFee,
      subtotal: subtotalValue,
      grand_total: grandTotalValue
    }])
    .select('id, invoice_no, invoice_date, cod_fees');

  if (invErr) throw invErr;

  const invoiceData = invoiceDataArray[0];
  const invoice_id = invoiceData.id;

  // Insert items for this new invoice
  const itemsToInsert = items.map(it => ({
    invoice_id,
    product_name: it.product_name,
    quantity: it.quantity,
    price_unit: it.price_unit,
    total_price: it.total_price
  }));

  const { error: itemsErr } = await supabaseClient
    .from('invoice_items')
    .insert(itemsToInsert);

  if (itemsErr) throw itemsErr;

  alert("✅ New invoice created!");

  // Clear table after save
  items = [];
  renderItems();

  // === Fetch ALL invoices for this buyer for this date ===
  const { data: allInvoices, error: allInvErr } = await supabaseClient
    .from('invoices')
    .select('*')
    .eq('buyer_name', buyer_name)
    .eq('invoice_date', invoice_date);

  if (allInvErr) throw allInvErr;

  const invoiceIds = allInvoices.map(inv => inv.id);

  const { data: allItems, error: allItemsErr } = await supabaseClient
    .from('invoice_items')
    .select('*')
    .in('invoice_id', invoiceIds);

  if (allItemsErr) throw allItemsErr;

  // Merge items with their invoice info
  lastSavedInvoice = {
    buyer_name,
    address,
    phone,
    invoice_date,
    items: allItems.map(it => {
      const inv = allInvoices.find(i => i.id === it.invoice_id);
      return {
        ...it,
        invoice_no: inv.invoice_no,
        invoice_date: inv.invoice_date,
        cod_fee: inv.cod_fees
      };
    }),
    totalCOD: allInvoices.reduce((sum, inv) => sum + Number(inv.cod_fees || 0), 0)
  };

  downloadPDFBtn.classList.remove('hidden');
  return;
}

    statusEl.style.color = 'black';
    statusEl.textContent = 'Saving invoice...';

    // ✅ 2. Proceed with original save logic
    const { data: invoiceDataArray, error: invErr } = await supabaseClient
  .from('invoices')
  .insert([{
    invoice_no, buyer_name, address, phone, invoice_date, cod_fees, subtotal, grand_total
  }])
  .select('*'); // select * to get invoice_no, invoice_date, cod_fees etc.

if (invErr) throw invErr;

const invoiceData = invoiceDataArray[0]; // first inserted invoice
const invoice_id = invoiceData.id;

    const itemsToInsert = items.map(it => ({
      invoice_id,
      product_name: it.product_name,
      quantity: it.quantity,
      price_unit: it.price_unit,
      total_price: it.total_price
    }));

    const { error: itemsErr } = await supabaseClient
      .from('invoice_items')
      .insert(itemsToInsert);

    if (itemsErr) throw itemsErr;

    lastSavedInvoice = {
  invoice_id,
  invoice_no,
  buyer_name,
  address,
  phone,
  invoice_date,
  cod_fees,
  subtotal,
  grand_total,
  items: items.map(it => ({
    invoice_no,
    invoice_date,
    ...it,
    cod_fee: cod_fees
  }))
};

    statusEl.style.color='green';
    statusEl.textContent = 'Invoice saved';
    downloadPDFBtn.classList.remove('hidden');

    alert("✅ Invoice saved successfully!");

    items = [];
    renderItems();
  } catch (err) {
    console.error(err);
    statusEl.style.color = 'red';
    statusEl.textContent = 'Error saving invoice: ' + (err.message || JSON.stringify(err));
    alert("❌ Error saving invoice: " + (err.message || JSON.stringify(err)));
  }
});

// === NEW: Search buyer feature ===
document.getElementById('searchBuyerBtn').addEventListener('click', async () => {
  const buyerName = document.getElementById('search_buyer').value.trim();
  if (!buyerName) return alert("Please enter a buyer name.");

  statusEl.style.color = 'black';
  statusEl.textContent = `Searching for ${buyerName}...`;

  try {
    const { data: invoices, error: invErr } = await supabaseClient
      .from('invoices')
      .select('*')
      .ilike('buyer_name', buyerName);

    if (invErr) throw invErr;
    if (!invoices.length) {
      statusEl.style.color = 'red';
      return statusEl.textContent = `No invoices found for "${buyerName}"`;
    }

    const invoiceIds = invoices.map(inv => inv.id);

    const { data: itemsData, error: itemsErr } = await supabaseClient
      .from('invoice_items')
      .select('*')
      .in('invoice_id', invoiceIds);

    if (itemsErr) throw itemsErr;

    const mergedItems = itemsData.map(it => {
  const inv = invoices.find(i => i.id === it.invoice_id);
  return {
    ...it,
    invoice_no: inv?.invoice_no || '',
    invoice_date: inv?.invoice_date || '',
    buyer_name: inv?.buyer_name || '',
    address: inv?.address || '',
    phone: inv?.phone || '',
    cod_fee: inv?.cod_fees || 0
  };
});

// Total COD for the day
const totalCOD = invoices.reduce((sum, inv) => sum + Number(inv.cod_fees || 0), 0);

// Store ALL info in lastSavedInvoice
lastSavedInvoice = {
  buyer_name: invoices[0]?.buyer_name || '',
  address: invoices[0]?.address || '',
  phone: invoices[0]?.phone || '',
  invoice_no: invoices[0]?.invoice_no || '',
  invoice_date: invoices[0]?.invoice_date || '',
  items: mergedItems,
  totalCOD: totalCOD
};

    downloadPDFBtn.classList.remove('hidden');

    statusEl.style.color = 'green';
    statusEl.textContent = `Found ${mergedItems.length} purchases for "${buyerName}"`;

  } catch (err) {
    console.error(err);
    statusEl.style.color = 'red';
    statusEl.textContent = 'Search error: ' + (err.message || JSON.stringify(err));
  }
});

// === PDF Export for Full Report ===
downloadPDFBtn.addEventListener('click', () => {
  if (!lastSavedInvoice || !lastSavedInvoice.items?.length) {
    return alert('No data to export.');
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  // ===== HEADER =====
  doc.setFillColor(255, 204, 0); // Yellow
  doc.rect(0, 0, 210, 20, 'F');
  doc.setFontSize(18);
  doc.setTextColor(0, 0, 0);
  doc.text("INVOICE", 105, 13, { align: "center" });

  // ===== STORE INFO =====
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("FARM FRESH RIZQAA ILHAM 31", 14, 30);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Address: Kedai No.1 Arked Terminal Bas Pekan, 26600 Pekan, Pahang.", 14, 36);
  doc.text("Phone: 019-4290780 / 014-2921219", 14, 42);

  // Separator line
  doc.setDrawColor(0);
  doc.line(14, 46, 196, 46);

  // ===== BUYER INFO =====
  const buyer = lastSavedInvoice.items[0]; // first item contains buyer info
  doc.setFont("helvetica", "bold");
  doc.text("Buyer Information:", 14, 54);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Name: ${lastSavedInvoice.buyer_name || '-'}`, 14, 60);
doc.text(`Address: ${lastSavedInvoice.address || '-'}`, 14, 66);
doc.text(`Phone: ${lastSavedInvoice.phone || '-'}`, 14, 72);

  // Separator line
  doc.setDrawColor(0);
  doc.line(14, 76, 196, 76);

  // ===== TABLE =====
const tableRows = lastSavedInvoice.items.map(it => [
  it.invoice_no || "",
  it.product_name || "",
  it.quantity?.toString() || "0",
  Number(it.price_unit || 0).toFixed(2),
  Number(it.total_price || 0).toFixed(2),
  it.cod_fee ? Number(it.cod_fee).toFixed(2) : "",
  it.invoice_date || ""
]);

doc.autoTable({
  head: [['Invoice No', 'Product Name', 'Qty', 'Price/unit (RM)', 'Total (RM)', 'COD (RM)', 'Date']],
  body: tableRows,
  startY: 82,
  styles: { fontSize: 9 },
  headStyles: { fillColor: [255, 204, 0], textColor: [0, 0, 0] }
});

  // ===== TOTALS =====
  const subtotal = lastSavedInvoice.items.reduce((sum, it) => sum + Number(it.total_price || 0), 0);
  const cod = Number(
    lastSavedInvoice.totalCOD ?? lastSavedInvoice.cod_fees ?? 0
);
  const grandTotal = subtotal + cod;

  let finalY = doc.lastAutoTable.finalY + 10;
  doc.setFontSize(11);
  doc.text(`Subtotal: RM ${subtotal.toFixed(2)}`, 150, finalY);
  doc.text(`COD: RM ${cod.toFixed(2)}`, 150, finalY + 6);
  doc.setFont("helvetica", "bold");
  doc.text(`Grand Total: RM ${grandTotal.toFixed(2)}`, 150, finalY + 12);

  // Save file
  doc.save(`Invoice_Report.pdf`);
});


/* utility */
document.getElementById('resetBtn').addEventListener('click', ()=>{
  if (!confirm('Reset form?')) return;
  document.getElementById('buyer_name').value='';
  document.getElementById('address').value='';
  document.getElementById('phone').value='';
  document.getElementById('invoice_no').value='';
  document.getElementById('invoice_date').value='';
  codInput.value='0.00';
  items=[];
  renderItems();
  downloadPDFBtn.classList.add('hidden');
  statusEl.textContent='';
});

function escapeHtml(s){ return (s+'').replace(/[&<>"']/g, function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]}); }

renderItems();

async function saveInvoice(invoiceData) {
    const { data, error } = await supabaseClient
        .from("invoices")
        .insert([invoiceData]);

    if (error) {
        alert("❌ Failed to save invoice: " + error.message);
    } else {
        alert("✅ Invoice saved successfully!");
    }
}
