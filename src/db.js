import { MongoClient, ObjectId } from 'mongodb';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function hasPersistentStorageConfig(env = process.env) {
  return Boolean(
    env.MONGODB_URI ||
    env.POSTGRES_URL ||
    env.DATABASE_URL ||
    env.VERCEL_POSTGRES_URL
  );
}

export function getStorageMode(env = process.env) {
  if (env.MONGODB_URI) return 'mongodb';
  if (env.POSTGRES_URL || env.DATABASE_URL || env.VERCEL_POSTGRES_URL) return 'postgres';
  if (env.VERCEL) return 'ephemeral-sqlite';
  return 'local-sqlite';
}

const mongoUri = process.env.MONGODB_URI;
const useMongo = Boolean(mongoUri);
const storageMode = getStorageMode();

if (process.env.VERCEL && !hasPersistentStorageConfig()) {
  const message = '[DB] Vercel detected without a durable database. SQLite in /tmp is ephemeral and shipments will disappear on cold starts. Configure MONGODB_URI or a Postgres DATABASE_URL before deploying.';
  console.error(message);
  throw new Error(message);
}

const dbPath =
  process.env.VERCEL
    ? '/tmp/parceltrack.db'
    : path.join(__dirname, '..', 'data', 'parceltrack.db');

if (process.env.VERCEL && !fs.existsSync(dbPath)) {
  const seedPath = path.join(__dirname, '..', 'data', 'parceltrack.db');
  if (fs.existsSync(seedPath)) {
    fs.copyFileSync(seedPath, dbPath);
  }
}

const sqliteDb = new Database(dbPath);
sqliteDb.pragma(process.env.VERCEL ? 'journal_mode = DELETE' : 'journal_mode = WAL');

let mongoClient = null;
let mongoDb = null;

if (useMongo) {
  mongoClient = new MongoClient(mongoUri, {
    serverSelectionTimeoutMS: 15000,
  });
  await mongoClient.connect();
  mongoDb = mongoClient.db(process.env.MONGODB_DB || 'swifttrack');
  console.log('[DB] Using MongoDB Atlas for persistent storage.');
}

function normalizeMongoRow(doc) {
  if (!doc) return null;

  return {
    id: doc.id || String(doc._id),
    trackingNumber: doc.trackingNumber,
    senderName: doc.senderName,
    senderAddress: doc.senderAddress,
    recipientName: doc.recipientName,
    recipientAddress: doc.recipientAddress,
    recipientEmail: doc.recipientEmail || null,
    recipientPhone: doc.recipientPhone || null,
    originCity: doc.originCity,
    destinationCity: doc.destinationCity,
    weightKg: doc.weightKg,
    distanceKm: doc.distanceKm,
    rate: doc.rate,
    currentStatus: doc.currentStatus || 'Accepted',
    estimatedDelivery: doc.estimatedDelivery || null,
    deliveredAt: doc.deliveredAt || null,
    createdAt: doc.createdAt,
    holdForPickup: Boolean(doc.holdForPickup),
    signatureRequired: Boolean(doc.signatureRequired),
    deliveryInstructions: doc.deliveryInstructions || null,
    safePlaceLocation: doc.safePlaceLocation || null,
    emailUpdates: Boolean(doc.emailUpdates),
    smsUpdates: Boolean(doc.smsUpdates),
    sender: {
      name: doc.senderName,
      address: doc.senderAddress,
    },
    recipient: {
      name: doc.recipientName,
      address: doc.recipientAddress,
    },
    statusHistory: Array.isArray(doc.statusHistory) ? doc.statusHistory.map((h) => ({
      status: h.status,
      at: h.at,
      ...(h.note ? { note: h.note } : {}),
    })) : [],
  };
}

export async function initDb() {
  if (useMongo && mongoDb) {
    const shipments = mongoDb.collection('shipments');
    await shipments.createIndex({ trackingNumber: 1 }, { unique: true });
    await shipments.createIndex({ createdAt: -1 });
    return;
  }

  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS shipments (
      id TEXT PRIMARY KEY,
      trackingNumber TEXT UNIQUE NOT NULL,
      senderName TEXT NOT NULL,
      senderAddress TEXT NOT NULL,
      recipientName TEXT NOT NULL,
      recipientAddress TEXT NOT NULL,
      recipientEmail TEXT,
      recipientPhone TEXT,
      originCity TEXT NOT NULL,
      destinationCity TEXT NOT NULL,
      weightKg REAL NOT NULL,
      distanceKm REAL NOT NULL,
      rate REAL NOT NULL,
      currentStatus TEXT DEFAULT 'Accepted',
      estimatedDelivery TEXT,
      deliveredAt TEXT,
      createdAt TEXT NOT NULL,
      holdForPickup INTEGER DEFAULT 0,
      signatureRequired INTEGER DEFAULT 0,
      deliveryInstructions TEXT,
      safePlaceLocation TEXT,
      emailUpdates INTEGER DEFAULT 0,
      smsUpdates INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS shipment_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shipmentId TEXT NOT NULL,
      status TEXT NOT NULL,
      note TEXT,
      timestamp TEXT NOT NULL,
      FOREIGN KEY(shipmentId) REFERENCES shipments(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_tracking ON shipments(trackingNumber);
    CREATE INDEX IF NOT EXISTS idx_shipment_history ON shipment_history(shipmentId);
  `);
}

export async function createShipment(data) {
  if (useMongo && mongoDb) {
    const shipments = mongoDb.collection('shipments');
    const doc = {
      _id: new ObjectId(),
      id: data.id,
      trackingNumber: data.trackingNumber,
      senderName: data.senderName,
      senderAddress: data.senderAddress,
      recipientName: data.recipientName,
      recipientAddress: data.recipientAddress,
      originCity: data.originCity,
      destinationCity: data.destinationCity,
      weightKg: data.weightKg,
      distanceKm: data.distanceKm,
      rate: data.rate,
      currentStatus: data.currentStatus || 'Accepted',
      estimatedDelivery: data.estimatedDelivery || null,
      deliveredAt: data.deliveredAt || null,
      createdAt: data.createdAt,
      holdForPickup: !!data.holdForPickup,
      signatureRequired: !!data.signatureRequired,
      deliveryInstructions: data.deliveryInstructions || null,
      safePlaceLocation: data.safePlaceLocation || null,
      emailUpdates: !!data.emailUpdates,
      smsUpdates: !!data.smsUpdates,
      statusHistory: [{ status: 'Accepted', at: data.createdAt }],
    };

    await shipments.insertOne(doc);
    return;
  }

  const stmt = sqliteDb.prepare(`
    INSERT INTO shipments (
      id, trackingNumber, senderName, senderAddress, recipientName, recipientAddress,
      originCity, destinationCity, weightKg, distanceKm, rate, currentStatus,
      estimatedDelivery, createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    data.id, data.trackingNumber, data.senderName, data.senderAddress,
    data.recipientName, data.recipientAddress, data.originCity, data.destinationCity,
    data.weightKg, data.distanceKm, data.rate, data.currentStatus,
    data.estimatedDelivery, data.createdAt
  );
  addHistory(data.id, 'Accepted', null, data.createdAt);
}

export async function getShipment(trackingNumber) {
  if (useMongo && mongoDb) {
    const shipments = mongoDb.collection('shipments');
    const doc = await shipments.findOne({ trackingNumber });
    return normalizeMongoRow(doc);
  }

  const stmt = sqliteDb.prepare(`SELECT * FROM shipments WHERE trackingNumber = ?`);
  const shipment = stmt.get(trackingNumber);
  if (!shipment) return null;

  const histStmt = sqliteDb.prepare(`SELECT status, note, timestamp FROM shipment_history WHERE shipmentId = ? ORDER BY timestamp ASC`);
  const history = histStmt.all(shipment.id);

  return {
    ...shipment,
    sender: { name: shipment.senderName, address: shipment.senderAddress },
    recipient: { name: shipment.recipientName, address: shipment.recipientAddress },
    statusHistory: history.map((h) => ({ status: h.status, at: h.timestamp, ...(h.note && { note: h.note }) }))
  };
}

export async function getShipmentById(id) {
  if (useMongo && mongoDb) {
    const shipments = mongoDb.collection('shipments');
    const doc = await shipments.findOne({ id });
    return normalizeMongoRow(doc);
  }

  const stmt = sqliteDb.prepare(`SELECT * FROM shipments WHERE id = ?`);
  const shipment = stmt.get(id);
  if (!shipment) return null;

  const histStmt = sqliteDb.prepare(`SELECT status, note, timestamp FROM shipment_history WHERE shipmentId = ? ORDER BY timestamp ASC`);
  const history = histStmt.all(id);

  return {
    ...shipment,
    sender: { name: shipment.senderName, address: shipment.senderAddress },
    recipient: { name: shipment.recipientName, address: shipment.recipientAddress },
    statusHistory: history.map((h) => ({ status: h.status, at: h.timestamp, ...(h.note && { note: h.note }) }))
  };
}

export async function getAllShipments() {
  if (useMongo && mongoDb) {
    const shipments = mongoDb.collection('shipments');
    const docs = await shipments.find({}).sort({ createdAt: -1 }).toArray();
    return docs.map(normalizeMongoRow);
  }

  const stmt = sqliteDb.prepare(`SELECT * FROM shipments ORDER BY createdAt DESC`);
  const shipments = stmt.all();

  return shipments.map((s) => {
    const histStmt = sqliteDb.prepare(`SELECT status, note, timestamp FROM shipment_history WHERE shipmentId = ? ORDER BY timestamp ASC`);
    const history = histStmt.all(s.id);
    return {
      ...s,
      sender: { name: s.senderName, address: s.senderAddress },
      recipient: { name: s.recipientName, address: s.recipientAddress },
      statusHistory: history.map((h) => ({ status: h.status, at: h.timestamp, ...(h.note && { note: h.note }) }))
    };
  });
}

export async function updateShipmentStatus(id, status, note = null) {
  if (useMongo && mongoDb) {
    const shipments = mongoDb.collection('shipments');
    const timestamp = new Date().toISOString();
    const result = await shipments.findOneAndUpdate(
      { id },
      {
        $set: { currentStatus: status },
        $push: { statusHistory: { status, at: timestamp, ...(note ? { note } : {}) } },
      },
      { returnDocument: 'after' }
    );

    if (result.value && status === 'Delivered') {
      await shipments.updateOne({ id }, { $set: { deliveredAt: timestamp } });
    }

    return normalizeMongoRow(result.value);
  }

  const timestamp = new Date().toISOString();
  addHistory(id, status, note, timestamp);

  const updateStmt = sqliteDb.prepare(`UPDATE shipments SET currentStatus = ? WHERE id = ?`);
  updateStmt.run(status, id);

  if (status === 'Delivered') {
    const deliverStmt = sqliteDb.prepare(`UPDATE shipments SET deliveredAt = ? WHERE id = ?`);
    deliverStmt.run(timestamp, id);
  }

  return getShipmentById(id);
}

export async function addHistory(shipmentId, status, note = null, timestamp = null) {
  const ts = timestamp || new Date().toISOString();

  if (useMongo && mongoDb) {
    const shipments = mongoDb.collection('shipments');
    await shipments.updateOne(
      { id: shipmentId },
      { $push: { statusHistory: { status, at: ts, ...(note ? { note } : {}) } } }
    );
    return;
  }

  const stmt = sqliteDb.prepare(`
    INSERT INTO shipment_history (shipmentId, status, note, timestamp)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(shipmentId, status, note, ts);
}

export async function updateShipmentPreferences(id, preferences) {
  if (useMongo && mongoDb) {
    const shipments = mongoDb.collection('shipments');
    await shipments.updateOne(
      { id },
      {
        $set: {
          holdForPickup: !!preferences.holdForPickup,
          signatureRequired: !!preferences.signatureRequired,
          deliveryInstructions: preferences.deliveryInstructions || null,
          safePlaceLocation: preferences.safePlaceLocation || null,
        },
      }
    );
    return;
  }

  const stmt = sqliteDb.prepare(`
    UPDATE shipments SET
      holdForPickup = ?,
      signatureRequired = ?,
      deliveryInstructions = ?,
      safePlaceLocation = ?
    WHERE id = ?
  `);
  stmt.run(
    preferences.holdForPickup ? 1 : 0,
    preferences.signatureRequired ? 1 : 0,
    preferences.deliveryInstructions || null,
    preferences.safePlaceLocation || null,
    id
  );
}

export async function updateShipmentNotifications(id, notif) {
  if (useMongo && mongoDb) {
    const shipments = mongoDb.collection('shipments');
    await shipments.updateOne(
      { id },
      {
        $set: {
          recipientEmail: notif.email || null,
          recipientPhone: notif.phone || null,
          emailUpdates: !!notif.emailUpdates,
          smsUpdates: !!notif.smsUpdates,
        },
      }
    );
    return;
  }

  const stmt = sqliteDb.prepare(`
    UPDATE shipments SET
      recipientEmail = ?,
      recipientPhone = ?,
      emailUpdates = ?,
      smsUpdates = ?
    WHERE id = ?
  `);
  stmt.run(
    notif.email || null,
    notif.phone || null,
    notif.emailUpdates ? 1 : 0,
    notif.smsUpdates ? 1 : 0,
    id
  );
}

export async function trackingNumberExists(trackingNumber) {
  if (useMongo && mongoDb) {
    const shipments = mongoDb.collection('shipments');
    const doc = await shipments.findOne({ trackingNumber }, { projection: { _id: 1 } });
    return Boolean(doc);
  }

  const stmt = sqliteDb.prepare(`SELECT 1 FROM shipments WHERE trackingNumber = ?`);
  return !!stmt.get(trackingNumber);
}

export default mongoDb || sqliteDb;
