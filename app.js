/* ─────────────────────────────────────────────
   Sari-Sari Store Credit Tracker — app.js
   Backend: Firebase Firestore (shared across all devices)
   Passwords: SHA-256 hashed, never stored in plain text
───────────────────────────────────────────── */

// ══════════════════════════════════════════════
//  FIREBASE CONFIG — replace with your own from
//  console.firebase.google.com → Project Settings
// ══════════════════════════════════════════════
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, doc,
  getDocs, getDoc, setDoc, updateDoc, deleteDoc, addDoc,
  query, where, orderBy, onSnapshot, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const FIREBASE_CONFIG = {
  apiKey:            "REPLACE_WITH_YOUR_API_KEY",
  authDomain:        "REPLACE_WITH_YOUR_AUTH_DOMAIN",
  projectId:         "REPLACE_WITH_YOUR_PROJECT_ID",
  storageBucket:     "REPLACE_WITH_YOUR_STORAGE_BUCKET",
  messagingSenderId: "REPLACE_WITH_YOUR_MESSAGING_SENDER_ID",
  appId:             "REPLACE_WITH_YOUR_APP_ID"
};

const firebaseApp = initializeApp(FIREBASE_CONFIG);
const db          = getFirestore(firebaseApp);

// Firestore collection references
const COL = {
  admin:        'sss_admin',
  customers:    'sss_customers',
  items:        'sss_items',
  transactions: 'sss_transactions',
  payments:     'sss_payments',
};

// ══════════════════════════════════════════════
//  FIRESTORE HELPERS
// ══════════════════════════════════════════════
async function fsGetAll(colName) {
  const snap = await getDocs(collection(db, colName));
  return snap.docs.map(d => ({ _id: d.id, ...d.data() }));
}

async function fsSet(colName, id, data) {
  await setDoc(doc(db, colName, String(id)), data);
}

async function fsUpdate(colName, id, data) {
  await updateDoc(doc(db, colName, String(id)), data);
}

async function fsDelete(colName, id) {
  await deleteDoc(doc(db, colName, String(id)));
}

async function fsAdd(colName, data) {
  const ref = await addDoc(collection(db, colName), data);
  return ref.id;
}

async function fsGetOne(colName, id) {
  const snap = await getDoc(doc(db, colName, String(id)));
  return snap.exists() ? { _id: snap.id, ...snap.data() } : null;
}

// ══════════════════════════════════════════════
//  CRYPTO — SHA-256 via Web Crypto API
// ══════════════════════════════════════════════
async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

// ══════════════════════════════════════════════
//  IN-MEMORY STATE  (loaded from Firestore on startup)
// ══════════════════════════════════════════════
let items        = [];
let customers    = [];
let transactions = [];
let payments     = [];
let adminCreds   = null;
let creditCart   = [];
let session      = null;

// ══════════════════════════════════════════════
//  LOADING OVERLAY
// ══════════════════════════════════════════════
function showLoading(msg = 'Loading…') {
  document.getElementById('loading-overlay').classList.remove('hidden');
  document.getElementById('loading-msg').textContent = msg;
}
function hideLoading() {
  document.getElementById('loading-overlay').classList.add('hidden');
}

// ══════════════════════════════════════════════
//  BOOTSTRAP — load all data from Firestore
// ══════════════════════════════════════════════
async function bootstrap() {
  showLoading('Connecting…');
  try {
    // Load admin creds (stored as single doc with id "admin")
    adminCreds = await fsGetOne(COL.admin, 'admin');
    if (!adminCreds) {
      // First run — seed admin
      adminCreds = { username: 'admin', passwordHash: await sha256('admin123') };
      await fsSet(COL.admin, 'admin', adminCreds);
    }

    // Load all collections in parallel
    [items, customers, transactions, payments] = await Promise.all([
      fsGetAll(COL.items),
      fsGetAll(COL.customers),
      fsGetAll(COL.transactions),
      fsGetAll(COL.payments),
    ]);

    // Migrate: assign currentCycleId to customers that don't have one
    for (const c of customers) {
      if (!c.currentCycleId) {
        const custTxns = transactions.filter(t => t.customerId === c._id);
        let cycleId;
        if (custTxns.length > 0) {
          const earliest = custTxns.reduce((a, b) =>
            new Date(a.datetime) < new Date(b.datetime) ? a : b);
          const d = new Date(earliest.datetime);
          cycleId = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        } else {
          cycleId = currentYearMonth();
        }
        c.currentCycleId = cycleId;
        await fsUpdate(COL.customers, c._id, { currentCycleId: cycleId });
      }
    }

    // Migrate: assign cycleId to transactions that don't have one
    for (const t of transactions) {
      if (!t.cycleId) {
        const d = new Date(t.datetime);
        t.cycleId = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        await fsUpdate(COL.transactions, t._id, { cycleId: t.cycleId });
      }
    }

  } catch (err) {
    hideLoading();
    alert('Failed to connect to the database. Check your Firebase config.\n\n' + err.message);
    return;
  }
  hideLoading();
  document.getElementById('login-username').focus();
}

// ══════════════════════════════════════════════
//  FORMAT HELPERS
// ══════════════════════════════════════════════
function formatCurrency(n) {
  return '₱' + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function formatDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-PH', { year:'numeric', month:'short', day:'numeric' })
    + ' ' + d.toLocaleTimeString('en-PH', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
}
function nowISO() { return new Date().toISOString(); }

// ══════════════════════════════════════════════
//  CYCLE HELPERS
// ══════════════════════════════════════════════
function currentYearMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
function nextCycleId(cycleId) {
  const [y, m] = cycleId.split('-').map(Number);
  const next = new Date(y, m, 1);
  return `${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,'0')}`;
}
function formatCycleLabel(cycleId) {
  const [y, m] = cycleId.split('-').map(Number);
  return new Date(y, m-1, 1).toLocaleDateString('en-PH', { month:'long', year:'numeric' });
}
function paymentDueDate(cycleId) {
  const [y, m] = cycleId.split('-').map(Number);
  return new Date(y, m, 9);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast ' + type;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.className = 'toast hidden'; }, 3200);
}
function togglePw(inputId, btn) {
  const inp = document.getElementById(inputId);
  if (inp.type === 'password') { inp.type = 'text'; btn.textContent = '🙈'; }
  else { inp.type = 'password'; btn.textContent = '👁'; }
}

// ══════════════════════════════════════════════
//  LOGIN
// ══════════════════════════════════════════════
document.getElementById('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('login-error');
  showLoading('Signing in…');

  const hash = await sha256(password);

  // Check admin
  if (username === adminCreds.username && hash === adminCreds.passwordHash) {
    session = { role: 'admin', customerId: null, username, name: 'Admin' };
    hideLoading();
    startApp();
    return;
  }

  // Check customers
  const cust = customers.find(c => c.username === username && c.passwordHash === hash);
  if (cust) {
    session = { role: 'customer', customerId: cust._id, username, name: cust.name };
    hideLoading();
    startApp(cust.mustChangePassword);
    return;
  }

  hideLoading();
  errEl.classList.remove('hidden');
  document.getElementById('login-password').value = '';
});

document.getElementById('login-username').addEventListener('input', () =>
  document.getElementById('login-error').classList.add('hidden'));
document.getElementById('login-password').addEventListener('input', () =>
  document.getElementById('login-error').classList.add('hidden'));

function startApp(forceChange = false) {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('login-form').reset();

  document.getElementById('header-username').textContent = session.name;
  const badge = document.getElementById('header-role-badge');
  badge.textContent = session.role === 'admin' ? 'Admin' : 'Customer';
  badge.className   = 'role-badge ' + session.role;

  buildNav();
  activateFirstTab();
  updateClock();
  if (!window._clockInterval) window._clockInterval = setInterval(updateClock, 1000);

  if (forceChange) {
    ['force-current-pw','force-new-pw','force-confirm-pw'].forEach(id =>
      document.getElementById(id).value = '');
    document.getElementById('force-change-error').classList.add('hidden');
    document.getElementById('force-change-modal').classList.remove('hidden');
    document.getElementById('force-current-pw').focus();
  }
}

function logout() {
  session = null; creditCart = [];
  document.getElementById('app').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('login-username').focus();
}

// ══════════════════════════════════════════════
//  FORCE CHANGE PASSWORD
// ══════════════════════════════════════════════
async function confirmForceChange() {
  const currentPw = document.getElementById('force-current-pw').value;
  const newPw     = document.getElementById('force-new-pw').value;
  const confirmPw = document.getElementById('force-confirm-pw').value;
  const errEl     = document.getElementById('force-change-error');
  const showErr   = msg => { errEl.textContent = msg; errEl.classList.remove('hidden'); };

  if (!currentPw) { showErr('Please enter the temporary password.'); return; }
  if (!newPw)     { showErr('New password cannot be empty.'); return; }
  if (newPw.length < 6) { showErr('New password must be at least 6 characters.'); return; }
  if (newPw !== confirmPw) { showErr('Passwords do not match.'); return; }

  const cust = customers.find(c => c._id === session.customerId);
  if (!cust) return;

  const currentHash = await sha256(currentPw);
  if (currentHash !== cust.passwordHash) { showErr('Temporary password is incorrect.'); return; }

  const newHash = await sha256(newPw);
  if (newHash === cust.passwordHash) { showErr('New password must differ from the temporary one.'); return; }

  showLoading('Saving…');
  cust.passwordHash = newHash;
  cust.mustChangePassword = false;
  await fsUpdate(COL.customers, cust._id, { passwordHash: newHash, mustChangePassword: false });
  hideLoading();

  document.getElementById('force-change-modal').classList.add('hidden');
  showToast('Password updated successfully!');
}

// ══════════════════════════════════════════════
//  CHANGE PASSWORD TAB
// ══════════════════════════════════════════════
async function submitChangePassword() {
  const currentPw = document.getElementById('cp-current').value;
  const newPw     = document.getElementById('cp-new').value;
  const confirmPw = document.getElementById('cp-confirm').value;
  const errEl     = document.getElementById('cp-error');
  const showErr   = msg => { errEl.textContent = msg; errEl.classList.remove('hidden'); };
  errEl.classList.add('hidden');

  if (!currentPw) { showErr('Please enter your current password.'); return; }
  if (!newPw)     { showErr('New password cannot be empty.'); return; }
  if (newPw.length < 6) { showErr('New password must be at least 6 characters.'); return; }
  if (newPw !== confirmPw) { showErr('Passwords do not match.'); return; }

  const cust = customers.find(c => c._id === session.customerId);
  if (!cust) return;

  const currentHash = await sha256(currentPw);
  if (currentHash !== cust.passwordHash) { showErr('Current password is incorrect.'); return; }

  const newHash = await sha256(newPw);
  if (newHash === cust.passwordHash) { showErr('New password must differ from the current one.'); return; }

  showLoading('Saving…');
  cust.passwordHash = newHash;
  cust.mustChangePassword = false;
  await fsUpdate(COL.customers, cust._id, { passwordHash: newHash, mustChangePassword: false });
  hideLoading();

  ['cp-current','cp-new','cp-confirm'].forEach(id => document.getElementById(id).value = '');
  showToast('Password changed successfully!');
}

// ══════════════════════════════════════════════
//  NAV
// ══════════════════════════════════════════════
const ADMIN_TABS = [
  { id: 'items',     label: 'Manage Items' },
  { id: 'customers', label: 'Manage Customers' },
  { id: 'credit',    label: 'Record Credit' },
  { id: 'report',    label: 'Credit Report' },
];
const CUSTOMER_TABS = [
  { id: 'credit',          label: 'Record Credit' },
  { id: 'my-credits',      label: 'My Credits' },
  { id: 'payment',         label: '💳 Make Payment' },
  { id: 'change-password', label: '🔑 Change Password' },
];
const TAB_ICONS = {
  'items':           { icon: '📦', label: 'Items' },
  'customers':       { icon: '👥', label: 'Customers' },
  'credit':          { icon: '✏️',  label: 'Credit' },
  'report':          { icon: '📊', label: 'Report' },
  'my-credits':      { icon: '📋', label: 'My Credits' },
  'payment':         { icon: '💳', label: 'Payment' },
  'change-password': { icon: '🔑', label: 'Password' },
};

function buildNav() {
  const tabs = session.role === 'admin' ? ADMIN_TABS : CUSTOMER_TABS;
  const topNav = document.getElementById('main-nav');
  topNav.innerHTML = tabs.map(t =>
    `<button class="nav-btn" data-tab="${t.id}">${t.label}</button>`).join('');
  topNav.querySelectorAll('.nav-btn').forEach(btn =>
    btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

  const botNav = document.getElementById('bottom-nav');
  botNav.innerHTML = tabs.map(t => {
    const meta = TAB_ICONS[t.id] || { icon: '•', label: t.label };
    return `<button class="bottom-nav-btn" data-tab="${t.id}" aria-label="${t.label}">
      <span class="bnav-icon">${meta.icon}</span>
      <span class="bnav-label">${meta.label}</span>
    </button>`;
  }).join('');
  botNav.querySelectorAll('.bottom-nav-btn').forEach(btn =>
    btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
}

function activateFirstTab() {
  switchTab((session.role === 'admin' ? ADMIN_TABS : CUSTOMER_TABS)[0].id);
}

function switchTab(tabId) {
  document.querySelectorAll('.nav-btn,.bottom-nav-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tabId));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  const el = document.getElementById('tab-' + tabId);
  if (el) el.classList.add('active');

  if (tabId === 'items')           renderItemsTable();
  if (tabId === 'customers')       renderCustomersTable();
  if (tabId === 'credit')          refreshCreditTab();
  if (tabId === 'report')          renderReport();
  if (tabId === 'my-credits')      renderMyCredits();
  if (tabId === 'payment')         renderPaymentTab();
  if (tabId === 'change-password') {
    ['cp-current','cp-new','cp-confirm'].forEach(id =>
      document.getElementById(id).value = '');
    document.getElementById('cp-error').classList.add('hidden');
  }
}

// ══════════════════════════════════════════════
//  TAB — Manage Items
// ══════════════════════════════════════════════
document.getElementById('item-form').addEventListener('submit', async e => {
  e.preventDefault();
  const name  = document.getElementById('item-name').value.trim();
  const price = parseFloat(document.getElementById('item-price').value);

  if (!name)  { showToast('Item name is required.', 'error'); return; }
  if (isNaN(price) || price <= 0) { showToast('Enter a valid price.', 'error'); return; }
  if (items.some(i => i.name.toLowerCase() === name.toLowerCase())) {
    showToast('An item with that name already exists.', 'error'); return;
  }

  showLoading('Saving…');
  const id = String(Date.now());
  const newItem = { id, name, price };
  await fsSet(COL.items, id, newItem);
  items.push({ _id: id, ...newItem });
  hideLoading();
  renderItemsTable();
  document.getElementById('item-form').reset();
  showToast(`"${name}" added.`);
});

function renderItemsTable() {
  const tbody = document.getElementById('items-tbody');
  const wrap  = document.getElementById('items-table-wrap');
  const empty = document.getElementById('items-empty');
  if (items.length === 0) { empty.classList.remove('hidden'); wrap.classList.add('hidden'); return; }
  empty.classList.add('hidden'); wrap.classList.remove('hidden');
  tbody.innerHTML = items.map((item, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td>${escHtml(item.name)}</td>
      <td>${formatCurrency(item.price)}</td>
      <td class="action-btns">
        <button class="btn btn-secondary btn-sm" onclick="editItem('${item._id}')">Edit</button>
        <button class="btn btn-danger btn-sm"    onclick="deleteItem('${item._id}')">Delete</button>
      </td>
    </tr>`).join('');
}

function editItem(id) {
  const item = items.find(i => i._id === id);
  if (!item) return;
  const idx  = items.findIndex(i => i._id === id);
  const rows = document.getElementById('items-tbody').querySelectorAll('tr');
  rows[idx].innerHTML = `
    <td>${idx + 1}</td>
    <td><input type="text" id="edit-iname-${id}" value="${escHtml(item.name)}"
         style="width:100%;padding:.3rem .4rem;border:1px solid #dee2e6;border-radius:4px;"/></td>
    <td><input type="number" id="edit-iprice-${id}" value="${item.price}" min="0.01" step="0.01"
         style="width:100%;padding:.3rem .4rem;border:1px solid #dee2e6;border-radius:4px;"/></td>
    <td class="action-btns">
      <button class="btn btn-success btn-sm"   onclick="saveEditItem('${id}')">Save</button>
      <button class="btn btn-secondary btn-sm" onclick="renderItemsTable()">Cancel</button>
    </td>`;
  document.getElementById(`edit-iname-${id}`).focus();
}

async function saveEditItem(id) {
  const name  = document.getElementById(`edit-iname-${id}`).value.trim();
  const price = parseFloat(document.getElementById(`edit-iprice-${id}`).value);
  if (!name) { showToast('Name cannot be empty.', 'error'); return; }
  if (isNaN(price) || price <= 0) { showToast('Enter a valid price.', 'error'); return; }
  if (items.find(i => i._id !== id && i.name.toLowerCase() === name.toLowerCase())) {
    showToast('Another item with that name already exists.', 'error'); return;
  }
  showLoading('Saving…');
  await fsUpdate(COL.items, id, { name, price });
  const item = items.find(i => i._id === id);
  item.name = name; item.price = price;
  hideLoading();
  renderItemsTable();
  showToast('Item updated.');
}

async function deleteItem(id) {
  if (!confirm('Delete this item? Existing transactions are not affected.')) return;
  showLoading('Deleting…');
  await fsDelete(COL.items, id);
  items = items.filter(i => i._id !== id);
  hideLoading();
  renderItemsTable();
  showToast('Item deleted.');
}

// ══════════════════════════════════════════════
//  TAB — Manage Customers
// ══════════════════════════════════════════════
document.getElementById('customer-form').addEventListener('submit', async e => {
  e.preventDefault();
  const name     = document.getElementById('cust-name').value.trim();
  const username = document.getElementById('cust-username').value.trim();
  const password = document.getElementById('cust-password').value;
  const phone    = document.getElementById('cust-phone').value.trim();
  const address  = document.getElementById('cust-address').value.trim();

  if (!name)     { showToast('Full name is required.', 'error'); return; }
  if (!username) { showToast('Username is required.', 'error'); return; }
  if (!password) { showToast('Password is required.', 'error'); return; }
  if (customers.some(c => c.username.toLowerCase() === username.toLowerCase())) {
    showToast('That username is already taken.', 'error'); return;
  }
  if (username.toLowerCase() === adminCreds.username.toLowerCase()) {
    showToast('That username is reserved for admin.', 'error'); return;
  }
  if (customers.some(c => c.name.toLowerCase() === name.toLowerCase())) {
    showToast('A customer with that name already exists.', 'error'); return;
  }

  showLoading('Saving…');
  const passwordHash = await sha256(password);
  const id = String(Date.now());
  const newCust = { id, name, username, passwordHash, mustChangePassword: true,
                    phone, address, currentCycleId: currentYearMonth() };
  await fsSet(COL.customers, id, newCust);
  customers.push({ _id: id, ...newCust });
  hideLoading();
  renderCustomersTable();
  document.getElementById('customer-form').reset();
  showToast(`Customer "${name}" added. They must change their password on first login.`);
});

function renderCustomersTable() {
  const tbody = document.getElementById('customers-tbody');
  const wrap  = document.getElementById('customers-table-wrap');
  const empty = document.getElementById('customers-empty');
  if (customers.length === 0) { empty.classList.remove('hidden'); wrap.classList.add('hidden'); return; }
  empty.classList.add('hidden'); wrap.classList.remove('hidden');

  tbody.innerHTML = customers.map((c, idx) => {
    const totalCredit = transactions.filter(t => t.customerId === c._id)
      .reduce((sum, t) => sum + t.total, 0);
    const pwStatus = c.mustChangePassword
      ? '<span class="pw-status pending">⚠ Temp PW</span>'
      : '<span class="pw-status ok">✔ Custom PW</span>';
    const custPayments = payments.filter(p => p.customerId === c._id);
    const lastPayment  = custPayments.length > 0
      ? custPayments.reduce((a, b) => new Date(a.datetime) > new Date(b.datetime) ? a : b)
      : null;
    const lastPaymentStr = lastPayment
      ? new Date(lastPayment.datetime).toLocaleDateString('en-PH', { year:'numeric', month:'short', day:'numeric' })
      : '—';
    return `
      <tr>
        <td>${idx + 1}</td>
        <td>${escHtml(c.name)}</td>
        <td><code>${escHtml(c.username)}</code></td>
        <td>${escHtml(c.phone || '—')}</td>
        <td>${escHtml(c.address || '—')}</td>
        <td class="${totalCredit > 0 ? 'credit-amount' : ''}">${formatCurrency(totalCredit)}</td>
        <td>${lastPaymentStr}</td>
        <td>${pwStatus}</td>
        <td class="action-btns">
          <button class="btn btn-secondary btn-sm" onclick="editCustomer('${c._id}')">Edit</button>
          <button class="btn btn-warning btn-sm"   onclick="openResetPw('${c._id}')">Reset PW</button>
          <button class="btn btn-danger btn-sm"    onclick="deleteCustomer('${c._id}')">Delete</button>
        </td>
      </tr>`;
  }).join('');
}

function editCustomer(id) {
  const c = customers.find(c => c._id === id);
  if (!c) return;
  const idx  = customers.findIndex(c => c._id === id);
  const rows = document.getElementById('customers-tbody').querySelectorAll('tr');
  rows[idx].innerHTML = `
    <td>${idx + 1}</td>
    <td><input type="text" id="ec-name-${id}"    value="${escHtml(c.name)}"    style="width:100%;padding:.3rem .4rem;border:1px solid #dee2e6;border-radius:4px;"/></td>
    <td><input type="text" id="ec-uname-${id}"   value="${escHtml(c.username)}" style="width:100%;padding:.3rem .4rem;border:1px solid #dee2e6;border-radius:4px;"/></td>
    <td><input type="text" id="ec-phone-${id}"   value="${escHtml(c.phone||'')}" style="width:100%;padding:.3rem .4rem;border:1px solid #dee2e6;border-radius:4px;"/></td>
    <td><input type="text" id="ec-address-${id}" value="${escHtml(c.address||'')}" style="width:100%;padding:.3rem .4rem;border:1px solid #dee2e6;border-radius:4px;"/></td>
    <td>—</td><td>—</td><td>—</td>
    <td class="action-btns">
      <button class="btn btn-success btn-sm"   onclick="saveEditCustomer('${id}')">Save</button>
      <button class="btn btn-secondary btn-sm" onclick="renderCustomersTable()">Cancel</button>
    </td>`;
  document.getElementById(`ec-name-${id}`).focus();
}

async function saveEditCustomer(id) {
  const name     = document.getElementById(`ec-name-${id}`).value.trim();
  const username = document.getElementById(`ec-uname-${id}`).value.trim();
  const phone    = document.getElementById(`ec-phone-${id}`).value.trim();
  const address  = document.getElementById(`ec-address-${id}`).value.trim();

  if (!name)     { showToast('Name cannot be empty.', 'error'); return; }
  if (!username) { showToast('Username cannot be empty.', 'error'); return; }
  if (customers.find(c => c._id !== id && c.username.toLowerCase() === username.toLowerCase())) {
    showToast('That username is already taken.', 'error'); return;
  }
  if (username.toLowerCase() === adminCreds.username.toLowerCase()) {
    showToast('That username is reserved for admin.', 'error'); return;
  }
  if (customers.find(c => c._id !== id && c.name.toLowerCase() === name.toLowerCase())) {
    showToast('Another customer with that name already exists.', 'error'); return;
  }
  showLoading('Saving…');
  await fsUpdate(COL.customers, id, { name, username, phone, address });
  const c = customers.find(c => c._id === id);
  c.name = name; c.username = username; c.phone = phone; c.address = address;
  hideLoading();
  renderCustomersTable();
  showToast('Customer updated.');
}

async function deleteCustomer(id) {
  const c = customers.find(c => c._id === id);
  const hasTxns = transactions.some(t => t.customerId === id);
  const msg = hasTxns
    ? `"${c.name}" has existing credit records. Deleting keeps the records but unlinks the account. Continue?`
    : `Delete customer "${c.name}"?`;
  if (!confirm(msg)) return;
  showLoading('Deleting…');
  await fsDelete(COL.customers, id);
  customers = customers.filter(c => c._id !== id);
  hideLoading();
  renderCustomersTable();
  showToast('Customer deleted.');
}

// ── Reset Password Modal ──
let _resetPwTargetId = null;

function openResetPw(id) {
  const c = customers.find(c => c._id === id);
  if (!c) return;
  _resetPwTargetId = id;
  document.getElementById('pw-modal-name').textContent = `${c.name} (@${c.username})`;
  document.getElementById('new-pw').value = '';
  document.getElementById('pw-modal').classList.remove('hidden');
  document.getElementById('new-pw').focus();
}

async function confirmResetPw() {
  const pw = document.getElementById('new-pw').value;
  if (!pw) { showToast('Temporary password cannot be empty.', 'error'); return; }
  const c = customers.find(c => c._id === _resetPwTargetId);
  if (!c) return;
  showLoading('Saving…');
  const passwordHash = await sha256(pw);
  c.passwordHash = passwordHash;
  c.mustChangePassword = true;
  await fsUpdate(COL.customers, c._id, { passwordHash, mustChangePassword: true });
  hideLoading();
  closeModal();
  renderCustomersTable();
  showToast(`Password reset for ${c.name}. They must change it on next login.`);
}

function closeModal() {
  document.getElementById('pw-modal').classList.add('hidden');
  _resetPwTargetId = null;
}
document.getElementById('pw-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('pw-modal')) closeModal();
});

// ══════════════════════════════════════════════
//  TAB — Record Credit
// ══════════════════════════════════════════════
function updateClock() {
  const el = document.getElementById('txn-datetime');
  if (el) el.value = formatDateTime(nowISO());
}

function refreshCreditTab() {
  const sel = document.getElementById('credit-customer-select');
  const noC = document.getElementById('credit-no-customers');

  if (session.role === 'admin') {
    sel.parentElement.classList.remove('hidden');
    if (customers.length === 0) {
      sel.classList.add('hidden'); noC.classList.remove('hidden');
    } else {
      sel.classList.remove('hidden'); noC.classList.add('hidden');
      sel.innerHTML = '<option value="">-- Choose a customer --</option>'
        + customers.map(c => `<option value="${c._id}">${escHtml(c.name)}</option>`).join('');
    }
  } else {
    sel.parentElement.classList.add('hidden'); noC.classList.add('hidden');
    const cust = customers.find(c => c._id === session.customerId);
    const infoEl = document.getElementById('credit-cycle-info');
    if (infoEl && cust) {
      infoEl.textContent = `Recording credits for: ${formatCycleLabel(cust.currentCycleId || currentYearMonth())}`;
      infoEl.classList.remove('hidden');
    }
  }
  refreshCreditItemSelector();
}

function refreshCreditItemSelector() {
  const noItems  = document.getElementById('credit-no-items');
  const selector = document.getElementById('credit-item-selector');
  const selectEl = document.getElementById('select-item');
  if (items.length === 0) { noItems.classList.remove('hidden'); selector.classList.add('hidden'); return; }
  noItems.classList.add('hidden'); selector.classList.remove('hidden');
  selectEl.innerHTML = '<option value="">-- Choose an item --</option>'
    + items.map(i => `<option value="${i._id}">${escHtml(i.name)} — ${formatCurrency(i.price)}</option>`).join('');
}

document.getElementById('add-to-credit-btn').addEventListener('click', () => {
  const itemId = document.getElementById('select-item').value;
  const qty    = parseInt(document.getElementById('select-qty').value);
  if (!itemId) { showToast('Please select an item.', 'error'); return; }
  if (!qty || qty < 1) { showToast('Quantity must be at least 1.', 'error'); return; }
  const item = items.find(i => i._id === itemId);
  if (!item) { showToast('Item not found.', 'error'); return; }
  const existing = creditCart.find(c => c.itemId === itemId);
  if (existing) { existing.qty += qty; }
  else { creditCart.push({ itemId, name: item.name, unitPrice: item.price, qty }); }
  renderCreditCart();
  document.getElementById('select-item').value = '';
  document.getElementById('select-qty').value  = 1;
});

function renderCreditCart() {
  const tbody   = document.getElementById('credit-list-tbody');
  const wrap    = document.getElementById('credit-list-table-wrap');
  const empty   = document.getElementById('credit-list-empty');
  const totalEl = document.getElementById('txn-total');
  const saveBtn = document.getElementById('save-credit-btn');

  if (creditCart.length === 0) {
    empty.classList.remove('hidden'); wrap.classList.add('hidden');
    totalEl.textContent = '₱0.00'; saveBtn.disabled = true; return;
  }
  empty.classList.add('hidden'); wrap.classList.remove('hidden');
  saveBtn.disabled = false;

  let total = 0;
  tbody.innerHTML = creditCart.map((row, idx) => {
    const sub = row.unitPrice * row.qty; total += sub;
    return `
      <tr>
        <td>${idx + 1}</td>
        <td>${escHtml(row.name)}</td>
        <td>${formatCurrency(row.unitPrice)}</td>
        <td><input type="number" value="${row.qty}" min="1"
              onchange="updateCartQty(${idx}, this.value)"
              style="width:60px;padding:.3rem .4rem;border:1px solid #dee2e6;border-radius:4px;"/></td>
        <td>${formatCurrency(sub)}</td>
        <td><button class="btn btn-danger btn-sm" onclick="removeFromCart(${idx})">✕</button></td>
      </tr>`;
  }).join('');
  totalEl.textContent = formatCurrency(total);
}

function updateCartQty(idx, val) {
  const qty = parseInt(val);
  if (!qty || qty < 1) { showToast('Quantity must be at least 1.', 'error'); return; }
  creditCart[idx].qty = qty; renderCreditCart();
}
function removeFromCart(idx) { creditCart.splice(idx, 1); renderCreditCart(); }

document.getElementById('save-credit-btn').addEventListener('click', async () => {
  if (creditCart.length === 0) { showToast('No items in the credit list.', 'error'); return; }

  let customerId, customerName;
  if (session.role === 'admin') {
    customerId = document.getElementById('credit-customer-select').value;
    if (!customerId) { showToast('Please select a customer.', 'error'); return; }
    const cust = customers.find(c => c._id === customerId);
    if (!cust) { showToast('Customer not found.', 'error'); return; }
    customerName = cust.name;
  } else {
    customerId   = session.customerId;
    customerName = session.name;
  }

  const cust   = customers.find(c => c._id === customerId);
  const cycleId = cust?.currentCycleId || currentYearMonth();
  const total   = creditCart.reduce((sum, r) => sum + r.unitPrice * r.qty, 0);
  const txn     = { customerId, customer: customerName, datetime: nowISO(),
                    items: creditCart.map(r => ({ ...r })), total, cycleId };

  showLoading('Saving…');
  const id = String(Date.now());
  await fsSet(COL.transactions, id, txn);
  transactions.push({ _id: id, ...txn });
  hideLoading();

  creditCart = [];
  renderCreditCart();
  if (session.role === 'admin') document.getElementById('credit-customer-select').value = '';
  showToast(`Credit saved for ${customerName}! Total: ${formatCurrency(total)}`);
});

// ══════════════════════════════════════════════
//  TAB — Credit Report (admin)
// ══════════════════════════════════════════════
document.getElementById('filter-customer').addEventListener('input', renderReport);

function renderReport() {
  const filter   = document.getElementById('filter-customer').value.trim().toLowerCase();
  const filtered = filter
    ? transactions.filter(t => t.customer.toLowerCase().includes(filter))
    : transactions;

  const empty   = document.getElementById('report-empty');
  const content = document.getElementById('report-content');

  if (filtered.length === 0 && payments.length === 0) {
    empty.classList.remove('hidden'); content.classList.add('hidden'); return;
  }
  empty.classList.add('hidden'); content.classList.remove('hidden');

  document.getElementById('grand-total').textContent =
    formatCurrency(filtered.reduce((s, t) => s + t.total, 0));

  const sorted = [...filtered].sort((a, b) => new Date(b.datetime) - new Date(a.datetime));
  document.getElementById('report-transactions').innerHTML = sorted.map(txn => buildTxnCard(txn)).join('');

  const filteredPayments = filter
    ? payments.filter(p => { const c = customers.find(c => c._id === p.customerId);
        return c && c.name.toLowerCase().includes(filter); })
    : payments;
  const sortedPayments = [...filteredPayments].sort((a, b) => new Date(b.datetime) - new Date(a.datetime));
  const prEl = document.getElementById('report-payment-records');
  if (prEl) {
    prEl.innerHTML = sortedPayments.length === 0
      ? '<p class="empty-state">No payment records yet.</p>'
      : sortedPayments.map(p => {
          const c = customers.find(c => c._id === p.customerId);
          const custName = c ? escHtml(c.name) : '(deleted)';
          const proofLink = p.proofDataUrl
            ? `<a href="${p.proofDataUrl}" target="_blank" rel="noopener"><img src="${p.proofDataUrl}" class="proof-preview" alt="Proof"/></a>`
            : '—';
          return `<div class="payment-record">
            <div class="payment-record-info">
              <span class="payment-record-customer">👤 ${custName}</span>
              <span class="payment-record-cycle">📅 ${formatCycleLabel(p.cycleId)}</span>
              <span class="payment-record-amount">${formatCurrency(p.amount)}</span>
              <span class="payment-record-date">${formatDateTime(p.datetime)}</span>
            </div>
            <div class="payment-record-proof">${proofLink}</div>
          </div>`;
        }).join('');
  }
}

document.getElementById('print-report-btn').addEventListener('click', () => window.print());

document.getElementById('clear-all-btn').addEventListener('click', async () => {
  if (!confirm('Permanently delete ALL credit records?')) return;
  showLoading('Deleting…');
  for (const t of transactions) await fsDelete(COL.transactions, t._id);
  transactions = [];
  hideLoading();
  renderReport();
  showToast('All records cleared.');
});

// ══════════════════════════════════════════════
//  TAB — My Credits (customer)
// ══════════════════════════════════════════════
document.getElementById('print-my-report-btn').addEventListener('click', () => window.print());

function renderMyCredits() {
  if (!session || session.role !== 'customer') return;
  const myTxns  = transactions.filter(t => t.customerId === session.customerId);
  const empty   = document.getElementById('my-report-empty');
  const content = document.getElementById('my-report-content');
  if (myTxns.length === 0) { empty.classList.remove('hidden'); content.classList.add('hidden'); return; }
  empty.classList.add('hidden'); content.classList.remove('hidden');

  document.getElementById('my-grand-total').textContent =
    formatCurrency(myTxns.reduce((s, t) => s + t.total, 0));

  const cycleMap = {};
  for (const txn of myTxns) {
    const cid = txn.cycleId || currentYearMonth();
    if (!cycleMap[cid]) cycleMap[cid] = [];
    cycleMap[cid].push(txn);
  }
  const sortedCycles = Object.keys(cycleMap).sort((a, b) => b.localeCompare(a));
  const myPayments   = payments.filter(p => p.customerId === session.customerId);

  document.getElementById('my-report-transactions').innerHTML = sortedCycles.map(cycleId => {
    const cycleTxns  = [...cycleMap[cycleId]].sort((a, b) => new Date(b.datetime) - new Date(a.datetime));
    const cycleTotal = cycleTxns.reduce((s, t) => s + t.total, 0);
    const cyclePayment = myPayments.find(p => p.cycleId === cycleId);
    const statusBadge  = cyclePayment
      ? `<span class="cycle-status-badge paid">✔ Paid ${formatCurrency(cyclePayment.amount)}</span>`
      : `<span class="cycle-status-badge unpaid">⏳ Unpaid</span>`;
    return `<div class="cycle-group">
      <div class="cycle-group-header">
        <span class="cycle-group-label">📅 ${formatCycleLabel(cycleId)}</span>
        <span class="cycle-group-total">${formatCurrency(cycleTotal)}</span>
        ${statusBadge}
      </div>
      ${cycleTxns.map(txn => buildTxnCard(txn, true)).join('')}
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════════
//  TAB — Make Payment (customer)
// ══════════════════════════════════════════════
function renderPaymentTab() {
  if (!session || session.role !== 'customer') return;
  const cust = customers.find(c => c._id === session.customerId);
  if (!cust) return;

  const cycleId    = cust.currentCycleId || currentYearMonth();
  const cycleTxns  = transactions.filter(t => t.customerId === cust._id && t.cycleId === cycleId);
  const cycleTotal = cycleTxns.reduce((s, t) => s + t.total, 0);
  const dueDate    = paymentDueDate(cycleId);
  const today      = new Date(); today.setHours(0,0,0,0);
  const isOverdue  = today > dueDate;
  const diffDays   = Math.round(Math.abs(dueDate - today) / 86400000);
  const dueDateStr = dueDate.toLocaleDateString('en-PH', { month:'long', day:'numeric', year:'numeric' });
  const myPayments = payments.filter(p => p.customerId === cust._id);
  const tab        = document.getElementById('tab-payment');
  if (!tab) return;

  tab.innerHTML = `
    <h2>💳 Make Payment</h2>
    <div class="card">
      <h3>Current Cycle Summary</h3>
      <div class="cycle-summary">
        <div class="cycle-summary-item"><span class="cycle-summary-label">Cycle Period</span><span class="cycle-summary-value">${formatCycleLabel(cycleId)}</span></div>
        <div class="cycle-summary-item"><span class="cycle-summary-label">Payment Due</span><span class="cycle-summary-value">${dueDateStr}</span></div>
        <div class="cycle-summary-item"><span class="cycle-summary-label">Status</span><span class="due-badge ${isOverdue?'overdue':'ontime'}">${isOverdue?'⚠ Overdue':'✔ On Time'}</span></div>
        <div class="cycle-summary-item"><span class="cycle-summary-label">${isOverdue?'Days Overdue':'Days Remaining'}</span><span class="cycle-summary-value ${isOverdue?'text-danger':''}">${diffDays} day${diffDays!==1?'s':''}</span></div>
        <div class="cycle-summary-item"><span class="cycle-summary-label">Total Credits This Cycle</span><span class="cycle-summary-value credit-amount">${formatCurrency(cycleTotal)}</span></div>
      </div>
      ${cycleTxns.length > 0 ? `
        <details style="margin-top:1rem">
          <summary style="cursor:pointer;font-weight:600;color:var(--secondary-d);padding:.4rem 0">View ${cycleTxns.length} transaction${cycleTxns.length!==1?'s':''} this cycle</summary>
          <div class="table-wrap" style="margin-top:.5rem">
            <table><thead><tr><th>Date</th><th>Items</th><th>Subtotal</th></tr></thead><tbody>
              ${[...cycleTxns].sort((a,b)=>new Date(b.datetime)-new Date(a.datetime)).map(t=>`
                <tr><td>${new Date(t.datetime).toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'})}</td>
                <td>${t.items.length} item${t.items.length!==1?'s':''}</td>
                <td>${formatCurrency(t.total)}</td></tr>`).join('')}
            </tbody></table>
          </div>
        </details>` : '<p class="empty-state" style="margin-top:.75rem">No transactions this cycle yet.</p>'}
    </div>
    ${cycleTotal > 0 ? `
    <div class="card">
      <h3>Submit Payment</h3>
      <div class="payment-amount-display">
        <span class="payment-amount-label">Amount Due</span>
        <span class="payment-amount-value">${formatCurrency(cycleTotal)}</span>
      </div>
      <div class="form-group" style="margin-top:1rem">
        <label for="pay-amount">Payment Amount (₱)</label>
        <input type="number" id="pay-amount" value="${cycleTotal.toFixed(2)}" min="0.01" max="${cycleTotal.toFixed(2)}" step="0.01" inputmode="decimal"/>
      </div>
      <div class="form-group" style="margin-top:.85rem">
        <label for="pay-proof">Attach Proof of Payment (image)</label>
        <input type="file" id="pay-proof" accept="image/*"/>
      </div>
      <div id="pay-proof-preview" style="margin-top:.5rem"></div>
      <div id="pay-error" class="login-error hidden" style="margin-top:.75rem"></div>
      <div class="form-actions">
        <button class="btn btn-success btn-full" onclick="submitPayment()">Submit Payment</button>
      </div>
    </div>` : ''}
    <div class="card">
      <h3>Payment History</h3>
      ${myPayments.length === 0 ? '<p class="empty-state">No payments made yet.</p>' : `
        <div class="table-wrap">
          <table><thead><tr><th>Cycle</th><th>Amount</th><th>Date</th><th>Proof</th></tr></thead><tbody>
            ${[...myPayments].sort((a,b)=>new Date(b.datetime)-new Date(a.datetime)).map(p=>`
              <tr><td>${formatCycleLabel(p.cycleId)}</td>
              <td class="credit-amount">${formatCurrency(p.amount)}</td>
              <td>${formatDateTime(p.datetime)}</td>
              <td>${p.proofDataUrl?`<a href="${p.proofDataUrl}" target="_blank" rel="noopener"><img src="${p.proofDataUrl}" class="proof-preview" alt="Proof"/></a>`:'—'}</td></tr>`).join('')}
          </tbody></table>
        </div>`}
    </div>`;

  const proofInput = document.getElementById('pay-proof');
  if (proofInput) {
    proofInput.addEventListener('change', () => {
      const file = proofInput.files[0];
      const prev = document.getElementById('pay-proof-preview');
      if (!file) { prev.innerHTML = ''; return; }
      const reader = new FileReader();
      reader.onload = e => { prev.innerHTML = `<img src="${e.target.result}" class="proof-preview" alt="Preview"/>`; };
      reader.readAsDataURL(file);
    });
  }
}

async function submitPayment() {
  const cust = customers.find(c => c._id === session.customerId);
  if (!cust) return;
  const cycleId    = cust.currentCycleId || currentYearMonth();
  const cycleTxns  = transactions.filter(t => t.customerId === cust._id && t.cycleId === cycleId);
  const cycleTotal = cycleTxns.reduce((s, t) => s + t.total, 0);

  const amountInput = document.getElementById('pay-amount');
  const proofInput  = document.getElementById('pay-proof');
  const errEl       = document.getElementById('pay-error');
  const showErr     = msg => { errEl.textContent = msg; errEl.classList.remove('hidden'); };
  errEl.classList.add('hidden');

  const amount = parseFloat(amountInput.value);
  if (isNaN(amount) || amount <= 0) { showErr('Please enter a valid payment amount.'); return; }
  if (amount > cycleTotal + 0.001)  { showErr(`Amount cannot exceed ${formatCurrency(cycleTotal)}.`); return; }
  const file = proofInput.files[0];
  if (!file) { showErr('Please attach a proof of payment image.'); return; }

  const proofDataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsDataURL(file);
  }).catch(err => { showErr(err.message); return null; });
  if (!proofDataUrl) return;

  showLoading('Submitting payment…');
  const id      = String(Date.now());
  const payment = { customerId: cust._id, cycleId, amount, proofDataUrl, datetime: nowISO() };
  await fsSet(COL.payments, id, payment);
  payments.push({ _id: id, ...payment });

  const newCycleId = nextCycleId(cycleId);
  cust.currentCycleId = newCycleId;
  await fsUpdate(COL.customers, cust._id, { currentCycleId: newCycleId });
  hideLoading();

  showToast(`Payment of ${formatCurrency(amount)} submitted for ${formatCycleLabel(cycleId)}!`);
  renderPaymentTab();
}

// ── Shared transaction card ──
function buildTxnCard(txn, hideCustomer = false) {
  return `
    <div class="report-transaction">
      <div class="report-txn-header">
        ${hideCustomer ? '' : `<span class="customer">👤 ${escHtml(txn.customer)}</span>`}
        <span class="datetime">🕐 ${formatDateTime(txn.datetime)}</span>
        <span class="txn-total">Total: ${formatCurrency(txn.total)}</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>#</th><th>Item</th><th>Unit Price</th><th>Qty</th><th>Subtotal</th></tr></thead>
          <tbody>
            ${txn.items.map((item, idx) => `
              <tr>
                <td>${idx + 1}</td>
                <td>${escHtml(item.name)}</td>
                <td>${formatCurrency(item.unitPrice)}</td>
                <td>${item.qty}</td>
                <td>${formatCurrency(item.unitPrice * item.qty)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

// ══════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════
bootstrap();
