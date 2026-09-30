import test from 'node:test';
import assert from 'node:assert/strict';
import { safeDiagnostic } from './sync-diagnostic.js';

test('redacted diagnostics expose only allowlisted codes and safe text', () => {
  const secret = 'customer@example.test secret-role-key-123';
  const diagnostic = safeDiagnostic({ code: secret, message: secret, status: 400 });
  assert.equal(diagnostic.code, 'UNCLASSIFIED');
  assert.equal(diagnostic.message.includes(secret), false);
  assert.equal(JSON.stringify(diagnostic).includes(secret), false);
  assert.equal(safeDiagnostic({ code: '42501', message: secret }).kind, 'permission');
  const revoked = safeDiagnostic({ code: 'DEVICE_REVOKED', message: secret, details: secret });
  assert.equal(revoked.kind, 'permission');
  assert.equal(revoked.code, 'DEVICE_REVOKED');
  assert.equal(revoked.message.includes(secret), false);
  const unavailable = safeDiagnostic({ code: 'AUTHORIZATION_UNAVAILABLE', message: secret });
  assert.equal(unavailable.kind, 'permission');
  assert.equal(unavailable.code, 'AUTHORIZATION_UNAVAILABLE');
  assert.equal(unavailable.message.includes(secret), false);
  assert.equal(safeDiagnostic({ status: 503 }).code, 'HTTP_503');
  assert.equal(safeDiagnostic({ status: 9000 }).code, 'UNCLASSIFIED');
  assert.equal(safeDiagnostic({ status: Infinity }).code, 'UNCLASSIFIED');
});
