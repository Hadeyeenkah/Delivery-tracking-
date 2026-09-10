import crypto from 'crypto';

function getAdminSessionSecret() {
  return process.env.ADMIN_SESSION_SECRET || 'swifttrack-dev-session-secret';
}

export function createAdminToken(username) {
  const payload = JSON.stringify({ username, issuedAt: Date.now() });
  const encodedPayload = Buffer.from(payload, 'utf8').toString('base64url');
  const signature = crypto
    .createHmac('sha256', getAdminSessionSecret())
    .update(encodedPayload)
    .digest('base64url');

  return `${encodedPayload}.${signature}`;
}

export function verifyAdminToken(token, expectedUsername) {
  if (!token || typeof token !== 'string') return false;

  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) return false;

  const expectedSignature = crypto
    .createHmac('sha256', getAdminSessionSecret())
    .update(encodedPayload)
    .digest('base64url');

  try {
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
      return false;
    }

    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (!payload || typeof payload.username !== 'string' || !Number.isFinite(payload.issuedAt)) {
      return false;
    }

    if (expectedUsername && payload.username !== expectedUsername) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}
