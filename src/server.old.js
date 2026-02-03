import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import dayjs from 'dayjs';
import QRCode from 'qrcode';
import { exec } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, '..', 'data');
const SHIPMENTS_PATH = path.join(DATA_DIR, 'shipments.json');

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Real-time updates via Server-Sent Events (SSE)
const subscribers = new Map();
function addSubscriber(trackingNumber, res) {
  const key = trackingNumber;
  const list = subscribers.get(key) || [];
  list.push(res);
  subscribers.set(key, list);
}
function removeSubscriber(trackingNumber, res) {
  const list = subscribers.get(trackingNumber) || [];
  subscribers.set(trackingNumber, list.filter(r => r !== res));
}
function broadcastShipmentUpdate(shipment) {
  const list = subscribers.get(shipment.trackingNumber) || [];
  const payload = JSON.stringify(shipment);
  for (const res of list) {
    try { res.write(`data: ${payload}\n\n`); } catch {}
  }
}

function requireAdminAuth(req, res, next) {
  const auth = req.headers.authorization;
  const realm = 'ParcelTrack Admin';
  const expectedUser = process.env.ADMIN_USER || 'admin';
  const expectedPass = process.env.ADMIN_PASSWORD || 'admin';
  if (!auth || !auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', `Basic realm="${realm}"`);
    return res.status(401).send('Authentication required');
  }
  try {
    const decoded = Buffer.from(auth.split(' ')[1], 'base64').toString();
    const [user, pass] = decoded.split(':');
    if (user === expectedUser && pass === expectedPass) return next();
  } catch {}
  res.setHeader('WWW-Authenticate', `Basic realm="${realm}"`);
  return res.status(401).send('Invalid credentials');
}

async function ensureDataFile() {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true });
  }
  if (!existsSync(SHIPMENTS_PATH)) {
    await writeFile(SHIPMENTS_PATH, JSON.stringify([] , null, 2));
  }
}

async function seedFakeData() {
  const shipments = await readShipments();
  if (shipments.length > 0) return; // Already has data

  const fakeShipments = [
    {
      id: uuidv4(),
      trackingNumber: 'TRK1234567890',
      sender: { name: 'Amazon Warehouse', address: '1234 Industrial Blvd, Seattle, WA' },
      recipient: { name: 'John Smith', address: '456 Oak Street, Portland, OR 97201' },
      originCity: 'Seattle',
      destinationCity: 'Portland',
      weightKg: 2.5,
      distanceKm: 280,
      rate: 14.6,
      statusHistory: [
        { status: 'Accepted', at: dayjs().subtract(3, 'day').toISOString() },
        { status: 'In Transit', at: dayjs().subtract(2, 'day').toISOString(), note: 'Package departed Seattle facility' },
        { status: 'In Transit', at: dayjs().subtract(1, 'day').toISOString(), note: 'Arrived at Portland distribution center' },
        { status: 'Out for Delivery', at: dayjs().subtract(3, 'hour').toISOString(), note: 'Package on delivery vehicle' }
      ],
      currentStatus: 'Out for Delivery',
      estimatedDelivery: dayjs().toISOString(),
      deliveryPreferences: {},
      notifications: [],
      createdAt: dayjs().subtract(3, 'day').toISOString()
    },
    {
      id: uuidv4(),
      trackingNumber: 'TRK9876543210',
      sender: { name: 'Best Buy Store #342', address: '789 Commerce Dr, Austin, TX' },
      recipient: { name: 'Sarah Johnson', address: '123 Maple Ave, Dallas, TX 75201' },
      originCity: 'Austin',
      destinationCity: 'Dallas',
      weightKg: 5.8,
      distanceKm: 320,
      rate: 19.4,
      statusHistory: [
        { status: 'Accepted', at: dayjs().subtract(2, 'day').toISOString() },
        { status: 'In Transit', at: dayjs().subtract(1, 'day').toISOString(), note: 'Package in transit to Dallas' }
      ],
      currentStatus: 'In Transit',
      estimatedDelivery: dayjs().add(1, 'day').toISOString(),
      deliveryPreferences: { deliveryInstructions: 'Leave at front door' },
      notifications: { email: 'sarah@example.com', emailUpdates: true },
      createdAt: dayjs().subtract(2, 'day').toISOString()
    },
    {
      id: uuidv4(),
      trackingNumber: 'TRK5555666677',
      sender: { name: 'Etsy Seller - HandmadeGoods', address: '321 Craft Lane, Brooklyn, NY' },
      recipient: { name: 'Mike Davis', address: '987 Pine St, Boston, MA 02108' },
      originCity: 'New York',
      destinationCity: 'Boston',
      weightKg: 1.2,
      distanceKm: 350,
      rate: 12.0,
      statusHistory: [
        { status: 'Accepted', at: dayjs().subtract(5, 'day').toISOString() },
        { status: 'In Transit', at: dayjs().subtract(4, 'day').toISOString() },
        { status: 'Out for Delivery', at: dayjs().subtract(3, 'day').toISOString() },
        { status: 'Delivered', at: dayjs().subtract(3, 'day').add(4, 'hour').toISOString(), note: 'Left at front door. Signed by: Mike D.' }
      ],
      currentStatus: 'Delivered',
      estimatedDelivery: dayjs().subtract(3, 'day').toISOString(),
      deliveryPreferences: {},
      notifications: [],
      createdAt: dayjs().subtract(5, 'day').toISOString()
    },
    {
      id: uuidv4(),
      trackingNumber: 'TRK4444333322',
      sender: { name: 'Tech Store Inc', address: '555 Silicon Valley Rd, San Jose, CA' },
      recipient: { name: 'Lisa Chen', address: '246 Beach Blvd, San Diego, CA 92101' },
      originCity: 'San Jose',
      destinationCity: 'San Diego',
      weightKg: 8.5,
      distanceKm: 750,
      rate: 27.0,
      statusHistory: [
        { status: 'Accepted', at: dayjs().subtract(1, 'day').toISOString() }
      ],
      currentStatus: 'Accepted',
      estimatedDelivery: dayjs().add(2, 'day').toISOString(),
      deliveryPreferences: { signatureRequired: true },
      notifications: { phone: '+1-555-0123', smsUpdates: true },
      createdAt: dayjs().subtract(1, 'day').toISOString()
    },
    {
      id: uuidv4(),
      trackingNumber: 'TRK7777888899',
      sender: { name: 'Fashion Boutique', address: '890 Style St, Miami, FL' },
      recipient: { name: 'Robert Williams', address: '135 Central Ave, Orlando, FL 32801' },
      originCity: 'Miami',
      destinationCity: 'Orlando',
      weightKg: 3.0,
      distanceKm: 380,
      rate: 16.6,
      statusHistory: [
        { status: 'Accepted', at: dayjs().subtract(4, 'day').toISOString() },
        { status: 'In Transit', at: dayjs().subtract(3, 'day').toISOString() },
        { status: 'Out for Delivery', at: dayjs().subtract(2, 'day').toISOString() },
        { status: 'Delivery Failed', at: dayjs().subtract(2, 'day').add(6, 'hour').toISOString(), note: 'Customer not home. Notice left.' }
      ],
      currentStatus: 'Delivery Failed',
      estimatedDelivery: dayjs().subtract(2, 'day').toISOString(),
      deliveryPreferences: {},
      notifications: [],
      createdAt: dayjs().subtract(4, 'day').toISOString()
    }
  ];

  await writeShipments(fakeShipments);
  console.log(`✓ Seeded ${fakeShipments.length} fake shipments for testing`);
}

async function readShipments() {
  await ensureDataFile();
  const buf = await readFile(SHIPMENTS_PATH);
  return JSON.parse(buf.toString());
}

async function writeShipments(shipments) {
  await ensureDataFile();
  await writeFile(SHIPMENTS_PATH, JSON.stringify(shipments, null, 2));
}

function baseTrackingNumber() {
  const datePart = dayjs().format('YYYYMMDD');
  const rand = Math.random().toString().slice(2, 12);
  return `PT${datePart}${rand}`; // e.g., PT20260110XXXXXXXXXX
}

async function generateUniqueTrackingNumber() {
  const shipments = await readShipments();
  let tn = baseTrackingNumber();
  const exists = (n) => shipments.some(s => s.trackingNumber === n);
  let attempts = 0;
  while (exists(tn) && attempts < 5) {
    tn = baseTrackingNumber();
    attempts++;
  }
  return tn;
}

function calcRate({ weightKg, distanceKm }) {
  const base = 5; // base fee
  const perKg = 1.5; // per kg
  const perKm = 0.02; // per km
  return +(base + perKg * weightKg + perKm * distanceKm).toFixed(2);
}

const LOCATIONS = [
  { name: 'Downtown Hub', city: 'Atlanta', address: '123 Peachtree St', hours: '9am-6pm' },
  { name: 'West Side Center', city: 'Dallas', address: '456 Elm Ave', hours: '8am-5pm' },
  { name: 'North Distribution', city: 'Chicago', address: '789 Lake Shore', hours: '10am-7pm' }
];

app.get('/', (req, res) => {
  res.render('index', { title: 'ParcelTrack', year: dayjs().year() });
});

app.post('/track', (req, res) => {
  const { trackingNumber } = req.body;
  if (!trackingNumber) return res.redirect('/');
  res.redirect(`/track/${encodeURIComponent(trackingNumber.trim())}`);
});

app.get('/track/:trackingNumber', async (req, res) => {
  const shipments = await readShipments();
  const shipment = shipments.find(s => s.trackingNumber === req.params.trackingNumber);
  res.render('track', { shipment, trackingNumber: req.params.trackingNumber });
});

// SSE endpoint for live tracking updates
app.get('/events/:trackingNumber', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  addSubscriber(req.params.trackingNumber, res);
  res.write(': connected\n\n');
  req.on('close', () => removeSubscriber(req.params.trackingNumber, res));
});

app.get('/shipments/new', (req, res) => {
  res.render('create-shipment');
});

app.post('/shipments', async (req, res) => {
  const { senderName, senderAddress, recipientName, recipientAddress, originCity, destinationCity, weightKg } = req.body;
  const shipments = await readShipments();
  const id = uuidv4();
  const trackingNumber = await generateUniqueTrackingNumber();
  const createdAt = dayjs().toISOString();
  const statusHistory = [
    { status: 'Accepted', at: createdAt },
  ];
  const distanceKm = Math.max(50, Math.floor(Math.random() * 2000));
  const rate = calcRate({ weightKg: parseFloat(weightKg || '0'), distanceKm });
  const estimatedDays = Math.ceil(distanceKm / 500);
  const estimatedDelivery = dayjs(createdAt).add(estimatedDays, 'day').toISOString();

  const shipment = {
    id,
    trackingNumber,
    sender: { name: senderName, address: senderAddress },
    recipient: { name: recipientName, address: recipientAddress },
    originCity,
    destinationCity,
    weightKg: parseFloat(weightKg || '0'),
    distanceKm,
    rate,
    statusHistory,
    currentStatus: 'Accepted',
    estimatedDelivery,
    deliveryPreferences: {},
    notifications: [],
    createdAt
  };
  shipments.push(shipment);
  await writeShipments(shipments);
  res.redirect(`/track/${trackingNumber}`);
});

app.get('/admin/shipments', requireAdminAuth, async (req, res) => {
  const shipments = await readShipments();
  res.render('admin-shipments', { shipments });
});

app.post('/admin/shipments/:id/status', requireAdminAuth, async (req, res) => {
  const { id } = req.params;
  const { status, note } = req.body;
  const shipments = await readShipments();
  const idx = shipments.findIndex(s => s.id === id);
  if (idx === -1) return res.redirect('/admin/shipments');
  const at = dayjs().toISOString();
  const historyEntry = { status, at };
  if (note && note.trim()) {
    historyEntry.note = note.trim();
  }
  shipments[idx].statusHistory.push(historyEntry);
  shipments[idx].currentStatus = status;
  
  // Update estimated delivery if needed
  if (status === 'Delivered') {
    shipments[idx].deliveredAt = at;
  }
  
  await writeShipments(shipments);
  broadcastShipmentUpdate(shipments[idx]);
  res.redirect('/admin/shipments');
});

app.get('/api/track/:trackingNumber', async (req, res) => {
  const shipments = await readShipments();
  const shipment = shipments.find(s => s.trackingNumber === req.params.trackingNumber);
  if (!shipment) return res.status(404).json({ error: 'Not found' });
  res.json(shipment);
});

// Create shipment via API
app.post('/api/shipments', async (req, res) => {
  const { senderName, senderAddress, recipientName, recipientAddress, originCity, destinationCity, weightKg } = req.body || {};
  if (!senderName || !senderAddress || !recipientName || !recipientAddress || !originCity || !destinationCity || weightKg == null) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const shipments = await readShipments();
  const id = uuidv4();
  const trackingNumber = await generateUniqueTrackingNumber();
  const createdAt = dayjs().toISOString();
  const statusHistory = [ { status: 'Accepted', at: createdAt } ];
  const distanceKm = Math.max(50, Math.floor(Math.random() * 2000));
  const rate = calcRate({ weightKg: parseFloat(weightKg || '0'), distanceKm });
  const shipment = {
    id,
    trackingNumber,
    sender: { name: senderName, address: senderAddress },
    recipient: { name: recipientName, address: recipientAddress },
    originCity,
    destinationCity,
    weightKg: parseFloat(weightKg || '0'),
    distanceKm,
    rate,
    statusHistory,
    currentStatus: 'Accepted',
    createdAt
  };
  shipments.push(shipment);
  await writeShipments(shipments);
  res.status(201).json(shipment);
});

// Update status via API
app.patch('/api/shipments/:id/status', requireAdminAuth, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};
  if (!status) return res.status(400).json({ error: 'Status required' });
  const shipments = await readShipments();
  const idx = shipments.findIndex(s => s.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const at = dayjs().toISOString();
  shipments[idx].statusHistory.push({ status, at });
  shipments[idx].currentStatus = status;
  await writeShipments(shipments);
  broadcastShipmentUpdate(shipments[idx]);
  res.json(shipments[idx]);
});

// Get shipment by id
app.get('/api/shipments/:id', async (req, res) => {
  const shipments = await readShipments();
  const shipment = shipments.find(s => s.id === req.params.id);
  if (!shipment) return res.status(404).json({ error: 'Not found' });
  res.json(shipment);
});

// QR label image
app.get('/api/shipments/:id/label.png', async (req, res) => {
  const shipments = await readShipments();
  const shipment = shipments.find(s => s.id === req.params.id);
  if (!shipment) return res.status(404).json({ error: 'Not found' });
  try {
    const buf = await QRCode.toBuffer(shipment.trackingNumber, { type: 'png', width: 256 });
    res.setHeader('Content-Type', 'image/png');
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: 'Failed to generate QR' });
  }
});

app.get('/label/:id', async (req, res) => {
  const shipments = await readShipments();
  const shipment = shipments.find(s => s.id === req.params.id);
  if (!shipment) return res.status(404).send('Label not found');
  const qrDataUrl = await QRCode.toDataURL(shipment.trackingNumber);
  res.render('label', { shipment, qrDataUrl });
});

app.get('/rates', (req, res) => {
  res.render('rates');
});

app.post('/rates/quote', (req, res) => {
  const { weightKg, distanceKm } = req.body;
  const price = calcRate({ weightKg: parseFloat(weightKg || '0'), distanceKm: parseFloat(distanceKm || '0') });
  res.render('rates', { quote: { weightKg, distanceKm, price } });
});

app.get('/locations', (req, res) => {
  res.render('locations', { locations: LOCATIONS });
});

app.get('/track-multiple', (req, res) => {
  res.render('track-multiple');
});

app.post('/track-multiple', async (req, res) => {
  const { trackingNumbers } = req.body;
  if (!trackingNumbers) return res.redirect('/track-multiple');
  const numbers = trackingNumbers.split(/[,\n\s]+/).map(n => n.trim()).filter(Boolean);
  const shipments = await readShipments();
  const results = numbers.map(num => {
    const shipment = shipments.find(s => s.trackingNumber === num);
    return { trackingNumber: num, shipment };
  });
  res.render('track-multiple', { results });
});

app.get('/shipments/:id/preferences', async (req, res) => {
  const shipments = await readShipments();
  const shipment = shipments.find(s => s.id === req.params.id);
  if (!shipment) return res.redirect('/');
  res.render('delivery-preferences', { shipment });
});

app.post('/shipments/:id/preferences', async (req, res) => {
  const { id } = req.params;
  const { holdForPickup, deliveryInstructions, signatureRequired, safePlaceLocation } = req.body;
  const shipments = await readShipments();
  const idx = shipments.findIndex(s => s.id === id);
  if (idx === -1) return res.redirect('/');
  shipments[idx].deliveryPreferences = {
    holdForPickup: holdForPickup === 'on',
    deliveryInstructions: deliveryInstructions || '',
    signatureRequired: signatureRequired === 'on',
    safePlaceLocation: safePlaceLocation || ''
  };
  await writeShipments(shipments);
  res.redirect(`/track/${shipments[idx].trackingNumber}`);
});

app.get('/shipments/:id/redelivery', async (req, res) => {
  const shipments = await readShipments();
  const shipment = shipments.find(s => s.id === req.params.id);
  if (!shipment) return res.redirect('/');
  res.render('redelivery', { shipment });
});

app.post('/shipments/:id/redelivery', async (req, res) => {
  const { id } = req.params;
  const { redeliveryDate } = req.body;
  const shipments = await readShipments();
  const idx = shipments.findIndex(s => s.id === id);
  if (idx === -1) return res.redirect('/');
  shipments[idx].redeliveryDate = redeliveryDate;
  const at = dayjs().toISOString();
  shipments[idx].statusHistory.push({ status: 'Redelivery Scheduled', at, note: `Scheduled for ${redeliveryDate}` });
  shipments[idx].currentStatus = 'Redelivery Scheduled';
  await writeShipments(shipments);
  res.redirect(`/track/${shipments[idx].trackingNumber}`);
});

app.get('/shipments/:id/notifications', async (req, res) => {
  const shipments = await readShipments();
  const shipment = shipments.find(s => s.id === req.params.id);
  if (!shipment) return res.redirect('/');
  res.render('notifications', { shipment });
});

app.post('/shipments/:id/notifications', async (req, res) => {
  const { id } = req.params;
  const { email, phone, smsUpdates, emailUpdates } = req.body;
  const shipments = await readShipments();
  const idx = shipments.findIndex(s => s.id === id);
  if (idx === -1) return res.redirect('/');
  shipments[idx].notifications = {
    email: email || '',
    phone: phone || '',
    smsUpdates: smsUpdates === 'on',
    emailUpdates: emailUpdates === 'on'
  };
  await writeShipments(shipments);
  res.redirect(`/track/${shipments[idx].trackingNumber}`);
});

app.get('/help', (req, res) => {
  res.render('help');
});

app.get('/support', (req, res) => {
  res.render('support');
});

app.post('/support/claim', async (req, res) => {
  const { trackingNumber, claimType, description, email } = req.body;
  // In production, save to database or send email
  res.render('support', { success: true, claimType });
});

app.listen(PORT, async () => {
  await ensureDataFile();
  console.log(`ParcelTrack server running on http://localhost:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin/shipments`);
  console.log(`Credentials: admin / change-me`);
  
  // Auto-open browser
  const url = `http://localhost:${PORT}`;
  const platform = process.platform;
  const command = platform === 'win32' ? `start ${url}` : platform === 'darwin' ? `open ${url}` : `xdg-open ${url}`;
  
  setTimeout(() => {
    exec(command, (error) => {
      if (error) {
        console.log(`\nOpen ${url} in your browser to view the app`);
      }
    });
  }, 1000);
});
