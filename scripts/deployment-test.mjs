import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../src/deployment.ts', import.meta.url), 'utf8');
const exports = {};
class HttpError extends Error { constructor(message, status) { super(message); this.status = status; } }
runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
  { exports, require: name => { assert.equal(name, './http'); return { HttpError }; } });
const { canManageSurveillance, allowanceAmount } = exports;
const admin = { kind: 'staff', email: 'manager@example.test', role: 'ADMIN' };
assert.equal(canManageSurveillance({}, admin), false);
assert.equal(canManageSurveillance({ SURVEILLANCE_MANAGER_EMAIL: ' ' }, admin), false);
const env = { SURVEILLANCE_MANAGER_EMAIL: ' Manager@Example.Test ' };
assert.equal(canManageSurveillance(env, admin), true);
for (const session of [null, { ...admin, role: 'VIEWER' }, { ...admin, email: 'other@example.test' }, { ...admin, kind: 'cadre' }]) {
  assert.equal(canManageSurveillance(env, session), false);
}
assert.equal(allowanceAmount({}), 100000);
assert.equal(allowanceAmount({ SBM_ALLOWANCE_AMOUNT: '125000' }), 125000);
for (const value of ['0', '-1', 'NaN', '1.5', '', '9007199254740992']) {
  assert.throws(() => allowanceAmount({ SBM_ALLOWANCE_AMOUNT: value }), error => error.status === 503);
}
console.log('Deployment checks OK: explicit manager, ADMIN role, missing configuration denied, configurable positive OH.');
