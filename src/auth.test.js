import test from 'node:test';
import assert from 'node:assert/strict';

import { createAdminToken, verifyAdminToken } from './auth.js';

test('createAdminToken and verifyAdminToken work for valid issued tokens', () => {
  const username = 'admin';
  const token = createAdminToken(username);

  assert.equal(verifyAdminToken(token, username), true);
  assert.equal(verifyAdminToken(token, 'other-user'), false);
});

test('tampered token is rejected', () => {
  const token = createAdminToken('admin');
  const tampered = `${token}bad`;

  assert.equal(verifyAdminToken(tampered, 'admin'), false);
});
