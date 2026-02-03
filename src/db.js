import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'data', 'parceltrack.db');

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

export function initDb() {
  db.exec(`
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

export function createShipment(data) {
  const stmt = db.prepare(`
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

export function getShipment(trackingNumber) {
  const stmt = db.prepare(`SELECT * FROM shipments WHERE trackingNumber = ?`);
  const shipment = stmt.get(trackingNumber);
  if (!shipment) return null;
  
  const histStmt = db.prepare(`SELECT status, note, timestamp FROM shipment_history WHERE shipmentId = ? ORDER BY timestamp ASC`);
  const history = histStmt.all(shipment.id);
  
  return {
    ...shipment,
    sender: {
      name: shipment.senderName,
      address: shipment.senderAddress
    },
    recipient: {
      name: shipment.recipientName,
      address: shipment.recipientAddress
    },
    statusHistory: history.map(h => ({
      status: h.status,
      at: h.timestamp,
      ...(h.note && { note: h.note })
    }))
  };
}

export function getShipmentById(id) {
  const stmt = db.prepare(`SELECT * FROM shipments WHERE id = ?`);
  const shipment = stmt.get(id);
  if (!shipment) return null;
  
  const histStmt = db.prepare(`SELECT status, note, timestamp FROM shipment_history WHERE shipmentId = ? ORDER BY timestamp ASC`);
  const history = histStmt.all(id);
  
  return {
    ...shipment,
    sender: {
      name: shipment.senderName,
      address: shipment.senderAddress
    },
    recipient: {
      name: shipment.recipientName,
      address: shipment.recipientAddress
    },
    statusHistory: history.map(h => ({
      status: h.status,
      at: h.timestamp,
      ...(h.note && { note: h.note })
    }))
  };
}

export function getAllShipments() {
  const stmt = db.prepare(`SELECT * FROM shipments ORDER BY createdAt DESC`);
  const shipments = stmt.all();
  
  return shipments.map(s => {
    const histStmt = db.prepare(`SELECT status, note, timestamp FROM shipment_history WHERE shipmentId = ? ORDER BY timestamp ASC`);
    const history = histStmt.all(s.id);
    return {
      ...s,
      sender: {
        name: s.senderName,
        address: s.senderAddress
      },
      recipient: {
        name: s.recipientName,
        address: s.recipientAddress
      },
      statusHistory: history.map(h => ({
        status: h.status,
        at: h.timestamp,
        ...(h.note && { note: h.note })
      }))
    };
  });
}

export function updateShipmentStatus(id, status, note = null) {
  const timestamp = new Date().toISOString();
  addHistory(id, status, note, timestamp);
  
  const updateStmt = db.prepare(`UPDATE shipments SET currentStatus = ? WHERE id = ?`);
  updateStmt.run(status, id);
  
  if (status === 'Delivered') {
    const deliverStmt = db.prepare(`UPDATE shipments SET deliveredAt = ? WHERE id = ?`);
    deliverStmt.run(timestamp, id);
  }
  
  return getShipmentById(id);
}

export function addHistory(shipmentId, status, note = null, timestamp = null) {
  const ts = timestamp || new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO shipment_history (shipmentId, status, note, timestamp)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(shipmentId, status, note, ts);
}

export function updateShipmentPreferences(id, preferences) {
  const stmt = db.prepare(`
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

export function updateShipmentNotifications(id, notif) {
  const stmt = db.prepare(`
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

export function trackingNumberExists(trackingNumber) {
  const stmt = db.prepare(`SELECT 1 FROM shipments WHERE trackingNumber = ?`);
  return !!stmt.get(trackingNumber);
}

export default db;
