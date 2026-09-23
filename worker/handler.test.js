import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cacheSeconds, handleStatus, validate } from './handler.js';

const NOW = 1_700_000_000;

test('validate accepts the three fields', () => {
	assert.equal(validate({ up: 3, total: 4, at: NOW }, NOW), null);
	assert.equal(validate({ at: NOW - 299, total: 1, up: 0 }, NOW), null);
});

test('validate refuses a shape that is not the schema', () => {
	assert.equal(validate(null, NOW), 'document is not an object');
	assert.equal(validate([1, 2, 3], NOW), 'document is not an object');
	assert.equal(validate({ up: 1, total: 1 }, NOW), 'fields must be exactly: up, total, at');
	assert.equal(validate({ up: 1, total: 1, at: NOW, host: 'x' }, NOW), 'fields must be exactly: up, total, at');
});

test('validate refuses a value that is not a non-negative integer', () => {
	assert.equal(validate({ up: 1.5, total: 2, at: NOW }, NOW), 'up must be a non-negative integer');
	assert.equal(validate({ up: '1', total: 2, at: NOW }, NOW), 'up must be a non-negative integer');
	assert.equal(validate({ up: 1, total: -2, at: NOW }, NOW), 'total must be a non-negative integer');
});

test('validate refuses a count out of range', () => {
	assert.equal(validate({ up: 0, total: 0, at: NOW }, NOW), 'total is out of range');
	assert.equal(validate({ up: 0, total: 10001, at: NOW }, NOW), 'total is out of range');
	assert.equal(validate({ up: 5, total: 4, at: NOW }, NOW), 'up is more than total');
});

test('validate refuses a clock that disagrees by more than 300 s', () => {
	assert.equal(validate({ up: 1, total: 1, at: NOW - 301 }, NOW), 'at does not agree with the clock');
	assert.equal(validate({ up: 1, total: 1, at: NOW + 301 }, NOW), 'at does not agree with the clock');
	assert.equal(validate({ up: 1, total: 1, at: NOW + 300 }, NOW), null);
});

test('cacheSeconds runs until the next send, between 30 s and 300 s', () => {
	assert.equal(cacheSeconds(NOW, NOW), 300);
	assert.equal(cacheSeconds(NOW, NOW + 100), 200);
	assert.equal(cacheSeconds(NOW, NOW + 290), 30);
	assert.equal(cacheSeconds(NOW, NOW + 5000), 30);
	assert.equal(cacheSeconds(NOW + 60, NOW), 300);
});

function env(stored, token = 'secret') {
	const store = new Map(stored === null ? [] : [['status', stored]]);
	return {
		PUSH_TOKEN: token,
		STATUS: {
			get: async (key) => store.get(key) ?? null,
			put: async (key, value) => store.set(key, value),
		},
		store,
	};
}

test('GET answers the document with the CORS header', async () => {
	const doc = JSON.stringify({ up: 3, total: 4, at: Math.floor(Date.now() / 1000) });
	const response = await handleStatus(new Request('https://w.example/api/status'), env(doc));
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
	assert.equal(await response.text(), doc);
});

test('GET with no document answers 503, still with the CORS header', async () => {
	const response = await handleStatus(new Request('https://w.example/api/status'), env(null));
	assert.equal(response.status, 503);
	assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
});

test('POST with a wrong bearer token answers 401 and writes nothing', async () => {
	const e = env(null);
	const response = await handleStatus(
		new Request('https://w.example/api/status', {
			method: 'POST',
			headers: { Authorization: 'Bearer wrong' },
			body: JSON.stringify({ up: 1, total: 1, at: Math.floor(Date.now() / 1000) }),
		}),
		e,
	);
	assert.equal(response.status, 401);
	assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
	assert.equal(e.store.size, 0);
});

test('POST with no PUSH_TOKEN on the Worker answers 401', async () => {
	const response = await handleStatus(
		new Request('https://w.example/api/status', { method: 'POST', headers: { Authorization: 'Bearer secret' } }),
		env(null, ''),
	);
	assert.equal(response.status, 401);
});

test('POST with the right token writes the three fields by name', async () => {
	const e = env(null);
	const at = Math.floor(Date.now() / 1000);
	const response = await handleStatus(
		new Request('https://w.example/api/status', {
			method: 'POST',
			headers: { Authorization: 'Bearer secret' },
			body: JSON.stringify({ at, total: 4, up: 3 }),
		}),
		e,
	);
	assert.equal(response.status, 204);
	assert.equal(e.store.get('status'), JSON.stringify({ up: 3, total: 4, at }));
});

test('POST with a bad document answers 422 and names the rule', async () => {
	const response = await handleStatus(
		new Request('https://w.example/api/status', {
			method: 'POST',
			headers: { Authorization: 'Bearer secret' },
			body: JSON.stringify({ up: 5, total: 4, at: Math.floor(Date.now() / 1000) }),
		}),
		env(null),
	);
	assert.equal(response.status, 422);
	assert.deepEqual(await response.json(), { error: 'up is more than total' });
});
