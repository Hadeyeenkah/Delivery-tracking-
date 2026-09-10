import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import dayjs from 'dayjs';
import QRCode from 'qrcode';
import bwipjs from 'bwip-js';
import { exec } from 'child_process';
import cookieParser from 'cookie-parser';
import { initDb, createShipment, getShipment, getShipmentById, getAllShipments, updateShipmentStatus, updateShipmentPreferences, updateShipmentNotifications, trackingNumberExists } from './db.js';
import { sendStatusUpdate } from './email.js';
import { createAdminToken, verifyAdminToken } from './auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const IS_SECURE_COOKIE = Boolean(process.env.VERCEL) || process.env.NODE_ENV === 'production';

function requireAdminAuth(req, res, next) {
  const token = req.cookies?.adminToken || req.query?.token;
  const username = req.cookies?.adminUsername || req.query?.username || ADMIN_USER;
  console.log(`[AUTH] Cookie token: ${req.cookies?.adminToken ? 'present' : 'missing'}`);
  console.log(`[AUTH] Query token: ${req.query?.token ? 'present' : 'missing'}`);
  console.log(`[AUTH] Token valid: ${token ? verifyAdminToken(token, username) : false}`);

  if (token && verifyAdminToken(token, username)) {
    console.log(`[AUTH] ✓ Access granted`);
    if (req.query?.token) {
      res.cookie('adminToken', token, {
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000,
        path: '/',
        sameSite: 'lax',
        secure: IS_SECURE_COOKIE,
      });
      res.cookie('adminUsername', username, {
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000,
        path: '/',
        sameSite: 'lax',
        secure: IS_SECURE_COOKIE,
      });
    }
    return next();
  }

  console.log(`[AUTH] ✗ Access denied, redirecting to /login`);
  return res.redirect('/login');
}

function isAdminAuthenticated(req) {
  const token = req.cookies?.adminToken;
  const username = req.cookies?.adminUsername || ADMIN_USER;
  return Boolean(token && verifyAdminToken(token, username));
}

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

function baseTrackingNumber() {
  const datePart = dayjs().format('YYYYMMDD');
  const rand = Math.random().toString().slice(2, 12);
  return `USPS${datePart}${rand}`;
}

async function generateUniqueTrackingNumber() {
  let tn = baseTrackingNumber();
  let attempts = 0;
  while (trackingNumberExists(tn) && attempts < 5) {
    tn = baseTrackingNumber();
    attempts++;
  }
  return tn;
}

function calcRate({ weightKg, distanceKm }) {
  const base = 5;
  const perKg = 1.5;
  const perKm = 0.02;
  return +(base + perKg * weightKg + perKm * distanceKm).toFixed(2);
}

const LOCATIONS = [
  { 
    name: 'Downtown Post Office', 
    city: 'New York, NY 10001', 
    address: '421 8th Avenue', 
    hours: 'Mon-Fri: 9:00 AM - 7:00 PM',
    saturdayHours: '9:00 AM - 4:00 PM',
    sundayHours: 'Closed',
    phone: '(212) 330-5000',
    distance: 0.8,
    isOpen: true,
    hasPoBox: true,
    hasPassport: true
  },
  { 
    name: 'Madison Square Station', 
    city: 'New York, NY 10010', 
    address: '149 E 23rd Street', 
    hours: 'Mon-Fri: 8:00 AM - 6:30 PM',
    saturdayHours: '9:00 AM - 3:00 PM',
    sundayHours: 'Closed',
    phone: '(212) 689-2334',
    distance: 1.2,
    isOpen: true,
    hasPoBox: true,
    hasPassport: false
  },
  { 
    name: 'Times Square Station', 
    city: 'New York, NY 10036', 
    address: '340 W 42nd Street', 
    hours: 'Mon-Fri: 8:30 AM - 8:00 PM',
    saturdayHours: '9:00 AM - 6:00 PM',
    sundayHours: '11:00 AM - 4:00 PM',
    phone: '(212) 330-5013',
    distance: 1.5,
    isOpen: true,
    hasPoBox: false,
    hasPassport: true
  },
  { 
    name: 'Grand Central Station', 
    city: 'New York, NY 10017', 
    address: '450 Lexington Avenue', 
    hours: 'Mon-Fri: 7:00 AM - 9:00 PM',
    saturdayHours: '9:00 AM - 6:00 PM',
    sundayHours: 'Closed',
    phone: '(212) 330-5088',
    distance: 1.8,
    isOpen: false,
    hasPoBox: true,
    hasPassport: true
  },
  { 
    name: 'Brooklyn Main Office', 
    city: 'Brooklyn, NY 11201', 
    address: '271 Cadman Plaza East', 
    hours: 'Mon-Fri: 9:00 AM - 5:00 PM',
    saturdayHours: '9:00 AM - 2:00 PM',
    sundayHours: 'Closed',
    phone: '(718) 330-5000',
    distance: 3.4,
    isOpen: true,
    hasPoBox: true,
    hasPassport: true
  },
  { 
    name: 'West Village Station', 
    city: 'New York, NY 10014', 
    address: '59 Christopher Street', 
    hours: 'Mon-Fri: 9:00 AM - 5:30 PM',
    saturdayHours: '10:00 AM - 2:00 PM',
    sundayHours: 'Closed',
    phone: '(212) 675-6933',
    distance: 2.1,
    isOpen: true,
    hasPoBox: true,
    hasPassport: false
  }
];

// Login Routes
app.get('/login', (req, res) => {
  res.render('login');
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;

  console.log(`[LOGIN] Attempt with username: ${username}`);
  console.log(`[LOGIN] Expected: ${ADMIN_USER}, Got: ${username}`);

  if (username === ADMIN_USER && password === ADMIN_PASSWORD) {
    console.log(`[LOGIN] ✓ Authentication successful for ${username}`);
    const token = createAdminToken(username);
    console.log(`[LOGIN] Token created for ${username}`);
    res.cookie('adminToken', token, {
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      path: '/',
      sameSite: 'lax',
      secure: IS_SECURE_COOKIE,
    });
    res.cookie('adminUsername', username, {
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      path: '/',
      sameSite: 'lax',
      secure: IS_SECURE_COOKIE,
    });
    console.log(`[LOGIN] ✓ Cookie set, rendering success page`);
    return res.render('login-success', { token, username });
  }

  console.log(`[LOGIN] ✗ Authentication failed`);
  res.render('login', { error: 'Invalid username or password' });
});

app.get('/logout', (req, res) => {
  res.clearCookie('adminToken', { path: '/' });
  res.clearCookie('adminUsername', { path: '/' });
  res.redirect('/');
});

app.get('/', (req, res) => {
  res.render('index', { title: 'ParcelTrack', year: dayjs().year() });
});

app.get('/track', (req, res) => {
  res.render('track', { shipment: null, trackingNumber: null });
});

app.post('/track', (req, res) => {
  const { trackingNumber } = req.body;
  if (!trackingNumber) return res.redirect('/');
  res.redirect(`/track/${encodeURIComponent(trackingNumber.trim())}`);
});

app.get('/track/:trackingNumber', async (req, res) => {
  const shipment = await getShipment(req.params.trackingNumber);
  res.render('track', { shipment, trackingNumber: req.params.trackingNumber });
});

app.get('/events/:trackingNumber', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  addSubscriber(req.params.trackingNumber, res);
  res.write(': connected\n\n');
  req.on('close', () => removeSubscriber(req.params.trackingNumber, res));
});

app.get('/shipments/new', requireAdminAuth, (req, res) => {
  res.render('create-shipment');
});

app.post('/shipments', requireAdminAuth, async (req, res) => {
  const { 
    senderName, senderAddress, senderCity, senderState, senderZip, senderPhone,
    recipientName, recipientAddress, recipientCity, recipientState, recipientZip, recipientPhone,
    originCity, destinationCity, weightKg, packageType, serviceType, 
    length, width, height, shipDate,
    signatureConfirmation, insurance, certifiedMail, returnReceipt
  } = req.body;
  
  if (!senderName || !senderAddress || !senderCity || !senderState || !senderZip || 
      !recipientName || !recipientAddress || !recipientCity || !recipientState || !recipientZip || 
      !weightKg || !packageType || !serviceType || !shipDate) {
    return res.status(400).render('create-shipment', { error: 'All required fields must be filled.' });
  }
  
  const id = uuidv4();
  const trackingNumber = await generateUniqueTrackingNumber();
  const createdAt = dayjs().toISOString();
  
  // Calculate distance based on ZIP codes (simplified - in production use real ZIP distance API)
  const distanceKm = Math.max(50, Math.abs(parseInt(senderZip) - parseInt(recipientZip)) * 2);
  
  // Calculate rate based on service type, weight, and additional services
  let baseRate = calcRate({ weightKg: parseFloat(weightKg), distanceKm });
  
  // Service type multipliers
  const serviceMultipliers = {
    'priority-mail-express': 2.5,
    'priority-mail': 1.5,
    'first-class-mail': 1.0,
    'retail-ground': 0.8,
    'media-mail': 0.6
  };
  baseRate *= (serviceMultipliers[serviceType] || 1.0);
  
  // Add additional service fees
  if (signatureConfirmation) baseRate += 3.10;
  if (insurance) baseRate += 2.45;
  if (certifiedMail) baseRate += 4.00;
  if (returnReceipt) baseRate += 2.00;
  
  const rate = parseFloat(baseRate.toFixed(2));
  
  // Calculate estimated delivery based on service type
  const deliveryDays = {
    'priority-mail-express': 2,
    'priority-mail': 3,
    'first-class-mail': 5,
    'retail-ground': 8,
    'media-mail': 8
  };
  const estimatedDays = deliveryDays[serviceType] || 5;
  const estimatedDelivery = dayjs(shipDate).add(estimatedDays, 'day').toISOString();

  const fullSenderAddress = `${senderAddress}, ${senderCity}, ${senderState} ${senderZip}`;
  const fullRecipientAddress = `${recipientAddress}, ${recipientCity}, ${recipientState} ${recipientZip}`;

  createShipment({
    id,
    trackingNumber,
    senderName,
    senderAddress: fullSenderAddress,
    recipientName,
    recipientAddress: fullRecipientAddress,
    originCity: `${senderCity}, ${senderState}`,
    destinationCity: `${recipientCity}, ${recipientState}`,
    weightKg: parseFloat(weightKg),
    distanceKm,
    rate,
    currentStatus: 'Accepted',
    estimatedDelivery,
    createdAt
  });

  res.redirect(`/track/${trackingNumber}`);
});

app.get('/admin/shipments', requireAdminAuth, async (req, res) => {
  const shipments = await getAllShipments();
  res.render('admin-shipments', { shipments });
});

app.post('/admin/shipments/:id/status', requireAdminAuth, async (req, res) => {
  const { id } = req.params;
  const { status, note } = req.body;
  
  if (!status) return res.redirect('/admin/shipments');
  
  const shipment = await updateShipmentStatus(id, status, note || null);
  broadcastShipmentUpdate(shipment);
  await sendStatusUpdate(shipment);
  
  res.redirect('/admin/shipments');
});

app.get('/api/track/:trackingNumber', async (req, res) => {
  const shipment = await getShipment(req.params.trackingNumber);
  if (!shipment) return res.status(404).json({ error: 'Not found' });
  res.json(shipment);
});

app.post('/api/shipments', async (req, res) => {
  const { senderName, senderAddress, recipientName, recipientAddress, originCity, destinationCity, weightKg } = req.body || {};
  if (!senderName || !senderAddress || !recipientName || !recipientAddress || !originCity || !destinationCity || weightKg == null) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  const id = uuidv4();
  const trackingNumber = await generateUniqueTrackingNumber();
  const createdAt = dayjs().toISOString();
  const distanceKm = Math.max(50, Math.floor(Math.random() * 2000));
  const rate = calcRate({ weightKg: parseFloat(weightKg), distanceKm });
  const estimatedDays = Math.ceil(distanceKm / 500);
  const estimatedDelivery = dayjs(createdAt).add(estimatedDays, 'day').toISOString();

  await createShipment({
    id,
    trackingNumber,
    senderName,
    senderAddress,
    recipientName,
    recipientAddress,
    originCity,
    destinationCity,
    weightKg: parseFloat(weightKg),
    distanceKm,
    rate,
    currentStatus: 'Accepted',
    estimatedDelivery,
    createdAt
  });

  const shipment = await getShipmentById(id);
  res.status(201).json(shipment);
});

app.patch('/api/shipments/:id/status', requireAdminAuth, async (req, res) => {
  const { status } = req.body || {};
  if (!status) return res.status(400).json({ error: 'Status required' });
  
  const shipment = await updateShipmentStatus(req.params.id, status);
  if (!shipment) return res.status(404).json({ error: 'Not found' });
  
  broadcastShipmentUpdate(shipment);
  await sendStatusUpdate(shipment);
  res.json(shipment);
});

app.get('/api/shipments/:id', async (req, res) => {
  const shipment = await getShipmentById(req.params.id);
  if (!shipment) return res.status(404).json({ error: 'Not found' });
  res.json(shipment);
});

app.get('/api/shipments/:id/label.png', async (req, res) => {
  const shipment = await getShipmentById(req.params.id);
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
  const shipment = await getShipmentById(req.params.id);
  if (!shipment) return res.status(404).send('Label not found');
  
  // Generate QR code
  const qrDataUrl = await QRCode.toDataURL(shipment.trackingNumber);
  
  // Generate Code128 barcode as PNG data URL
  let barcodeDataUrl = null;
  try {
    const barcodeBuffer = await bwipjs.toBuffer({
      bcid: 'code128',
      text: shipment.trackingNumber,
      scale: 3,
      height: 12,
      includetext: false,
      textxalign: 'center'
    });
    barcodeDataUrl = `data:image/png;base64,${barcodeBuffer.toString('base64')}`;
  } catch (err) {
    console.error('Barcode generation error:', err);
  }
  
  // Calculate postage based on service type and weight
  const serviceRates = {
    'priority-express': 28.75,
    'priority': 9.35,
    'first-class': 0.73,
    'retail-ground': 9.95,
    'media': 4.63
  };
  const basePostage = serviceRates[shipment.serviceType] || 9.35;
  const weightFactor = shipment.weight ? Math.ceil(shipment.weight) * 1.5 : 0;
  const additionalServices = (
    (shipment.signatureConfirmation ? 3.10 : 0) +
    (shipment.insurance ? 2.45 : 0) +
    (shipment.certifiedMail ? 4.00 : 0) +
    (shipment.returnReceipt ? 2.00 : 0)
  );
  const totalPostage = (basePostage + weightFactor + additionalServices).toFixed(2);
  
  res.render('label', { shipment, qrDataUrl, barcodeDataUrl, postage: totalPostage });
});

app.get('/track-multiple', (req, res) => {
  res.render('track-multiple');
});

app.post('/track-multiple', async (req, res) => {
  const { trackingNumbers } = req.body;
  if (!trackingNumbers) return res.redirect('/track-multiple');
  const numbers = trackingNumbers.split(/[,\n\s]+/).map(n => n.trim()).filter(Boolean);
  const results = [];
  for (const num of numbers) {
    const shipment = await getShipment(num);
    results.push({ trackingNumber: num, shipment });
  }
  res.render('track-multiple', { results });
});

app.get('/shipments/:id/preferences', async (req, res) => {
  const shipment = await getShipmentById(req.params.id);
  if (!shipment) return res.redirect('/');
  res.render('delivery-preferences', { shipment });
});

app.post('/shipments/:id/preferences', async (req, res) => {
  const { holdForPickup, deliveryInstructions, signatureRequired, safePlaceLocation } = req.body;
  const shipment = await getShipmentById(req.params.id);
  if (!shipment) return res.redirect('/');
  
  await updateShipmentPreferences(req.params.id, {
    holdForPickup: holdForPickup === 'on',
    deliveryInstructions: deliveryInstructions || '',
    signatureRequired: signatureRequired === 'on',
    safePlaceLocation: safePlaceLocation || ''
  });
  
  res.redirect(`/track/${shipment.trackingNumber}`);
});

app.get('/shipments/:id/redelivery', async (req, res) => {
  const shipment = await getShipmentById(req.params.id);
  if (!shipment) return res.redirect('/');
  res.render('redelivery', { shipment });
});

app.post('/shipments/:id/redelivery', async (req, res) => {
  const { redeliveryDate } = req.body;
  const shipment = await getShipmentById(req.params.id);
  if (!shipment) return res.redirect('/');
  
  await updateShipmentStatus(req.params.id, 'Redelivery Scheduled', `Scheduled for ${redeliveryDate}`);
  res.redirect(`/track/${shipment.trackingNumber}`);
});

app.get('/shipments/:id/notifications', async (req, res) => {
  const shipment = await getShipmentById(req.params.id);
  if (!shipment) return res.redirect('/');
  res.render('notifications', { shipment });
});

app.post('/shipments/:id/notifications', async (req, res) => {
  const { email, phone, smsUpdates, emailUpdates } = req.body;
  const shipment = await getShipmentById(req.params.id);
  if (!shipment) return res.redirect('/');
  
  await updateShipmentNotifications(req.params.id, {
    email: email || '',
    phone: phone || '',
    smsUpdates: smsUpdates === 'on',
    emailUpdates: emailUpdates === 'on'
  });
  
  res.redirect(`/track/${shipment.trackingNumber}`);
});

app.get('/rates', (req, res) => {
  res.render('rates', { quote: null });
});

app.post('/rates/quote', (req, res) => {
  const { weightLbs, weightOz, serviceType, originZip, destZip } = req.body;
  
  // Convert lbs/oz to kg
  const lbs = parseFloat(weightLbs || '0');
  const oz = parseFloat(weightOz || '0');
  const weightKg = ((lbs + oz / 16) * 0.453592).toFixed(2);
  
  // Simple distance calculation based on ZIP code difference (mock)
  const distanceKm = Math.abs(parseInt(destZip || '0') - parseInt(originZip || '0')) * 0.5;
  
  const price = calcRate({ weightKg: parseFloat(weightKg), distanceKm });
  res.render('rates', { quote: { weightKg, distanceKm, price } });
});

app.get('/locations', (req, res) => {
  res.render('locations', { locations: LOCATIONS });
});

app.get('/help', (req, res) => {
  res.render('help');
});

app.get('/support', (req, res) => {
  res.render('support');
});

app.post('/support/claim', async (req, res) => {
  const { trackingNumber, claimType, description, email } = req.body;
  res.render('support', { success: true, claimType });
});

app.listen(PORT, async () => {
  await initDb();
  const DEMO_MODE = process.env.DEMO_MODE === 'true';

  if (!process.env.ADMIN_USER || !process.env.ADMIN_PASSWORD) {
    console.warn('⚠️  ADMIN_USER and ADMIN_PASSWORD were not set; using fallback demo credentials. Set them in Vercel for production.');
  }
  if (!process.env.SENDGRID_API_KEY && !DEMO_MODE) {
    console.warn('⚠️  SENDGRID_API_KEY is missing; using DEMO_MODE fallback for local/dev. Set DEMO_MODE=true or add SendGrid credentials.');
  }

  const databaseLabel = process.env.MONGODB_URI ? 'MongoDB Atlas' : 'SQLite (data/parceltrack.db)';
  console.log(`\n✨ SwiftTrack Express Server running on http://localhost:${PORT}`);
  console.log(`✓ Admin panel: http://localhost:${PORT}/admin/shipments`);
  console.log(`✓ Database: ${databaseLabel}`);
  console.log(`✓ Email: ${DEMO_MODE ? 'Demo Mode (console logging)' : (process.env.SENDGRID_API_KEY ? 'SendGrid configured' : 'Demo Mode fallback')}\n`);
  if (DEMO_MODE || (!process.env.ADMIN_USER || !process.env.ADMIN_PASSWORD)) {
    console.log('⚠️  Using fallback/default admin credentials for this environment\n');
  }
});
