import sgMail from '@sendgrid/mail';

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const SENDER_EMAIL = process.env.SENDER_EMAIL || 'noreply@swifttrack.com';
const DEMO_MODE = process.env.DEMO_MODE === 'true' || !SENDGRID_API_KEY;

if (!SENDGRID_API_KEY) {
  console.warn('⚠️  SENDGRID_API_KEY not set — running in DEMO_MODE (emails will be logged, not sent)');
} else {
  sgMail.setApiKey(SENDGRID_API_KEY);
}

export async function sendStatusUpdate(shipment) {
  if (!shipment.recipientEmail || !shipment.emailUpdates) return;

  if (DEMO_MODE) {
    console.log('[DEMO MODE] Email would be sent to:', shipment.recipientEmail);
    console.log('[DEMO MODE] Subject: Shipment', shipment.trackingNumber, '-', shipment.currentStatus);
    return;
  }

  try {
    const lastHistory = shipment.statusHistory[shipment.statusHistory.length - 1] || {};
    const msg = {
      to: shipment.recipientEmail,
      from: SENDER_EMAIL,
      subject: `Shipment ${shipment.trackingNumber} - ${shipment.currentStatus}`,
      html: `
        <h2>Shipment Status Update</h2>
        <p>Your package <strong>${shipment.trackingNumber}</strong> is now <strong>${shipment.currentStatus}</strong>.</p>
        <p><strong>From:</strong> ${shipment.originCity}</p>
        <p><strong>To:</strong> ${shipment.destinationCity}</p>
        <p><strong>Recipient:</strong> ${shipment.recipientName}</p>
        <p><strong>Updated:</strong> ${new Date(lastHistory.at).toLocaleString()}</p>
        ${lastHistory.note ? `<p><strong>Note:</strong> ${lastHistory.note}</p>` : ''}
        <p>Track your shipment: <a href="${process.env.PUBLIC_URL || 'http://localhost:3000'}/track/${shipment.trackingNumber}">Click here</a></p>
      `
    };
    await sgMail.send(msg);
    console.log(`✓ Email sent to ${shipment.recipientEmail}`);
  } catch (error) {
    console.error('SendGrid error:', error.message);
    throw error;
  }
}

export function getEmailConfig() {
  return {
    configured: !DEMO_MODE,
    demoMode: DEMO_MODE,
    senderEmail: SENDER_EMAIL
  };
}

export default sgMail;