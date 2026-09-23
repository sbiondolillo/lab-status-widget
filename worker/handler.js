// The lab status endpoint. The lab pushes out: a job in the lab POSTs a small
// document here, this handler writes it to KV, and the widget reads it back
// with GET. No request from a visitor reaches the lab.
//
// The handler answers one path. A Worker that serves other paths too calls it
// for that path only, and `worker/index.js` is the example.

export const STATUS_PATH = '/api/status';
const KEY = 'status';

// The fixed schema. A document with any other field is refused, so a mistake
// in the push job cannot publish a name or an address.
const FIELDS = ['at', 'total', 'up'];
const MAX_BODY_BYTES = 256;
const MAX_TOTAL = 10000;
// `at` must agree with this Worker's clock. A lab clock that drifts then
// shows as a stale widget, and never as a wrong age.
const MAX_CLOCK_SKEW_SECONDS = 300;
// The push job sends every 300 seconds, so an answer stays good until then.
// The push job and the widget each hold their half of this number. See the
// table in README.md.
export const PUSH_INTERVAL_SECONDS = 300;
const MIN_CACHE_SECONDS = 30;

// The widget on another origin reads with a plain GET. The Worker answers
// with the origin header, and a preflight for good measure. A POST gets no
// CORS answer, because only the push job sends one, and it is not a browser.
const CORS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, HEAD',
};

export async function handleStatus(request, env) {
	if (request.method === 'GET' || request.method === 'HEAD') {
		return read(env);
	}
	if (request.method === 'OPTIONS') {
		return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Max-Age': '86400' } });
	}
	if (request.method === 'POST') {
		return write(request, env);
	}
	return json({ error: 'method not allowed' }, 405, { Allow: 'GET, HEAD, OPTIONS, POST' });
}

async function read(env) {
	const value = await env.STATUS.get(KEY);
	if (value === null) {
		return json({ error: 'no status yet' }, 503, CORS);
	}
	// A browser keeps the answer until the next send is due, so a visitor who
	// moves between pages asks one time per send. An answer that is already
	// late gets the floor, because the next send can land at any moment.
	const now = Math.floor(Date.now() / 1000);
	const maxAge = cacheSeconds(JSON.parse(value).at, now);
	// `value` passed validate() on the way in, so it goes out as stored.
	return new Response(value, {
		headers: {
			'Content-Type': 'application/json',
			'Cache-Control': `public, max-age=${maxAge}`,
			...CORS,
		},
	});
}

async function write(request, env) {
	if (!(await authorized(request, env))) {
		return json({ error: 'unauthorized' }, 401, { 'WWW-Authenticate': 'Bearer' });
	}

	const body = await request.text();
	if (body.length > MAX_BODY_BYTES) {
		return json({ error: 'body too large' }, 413);
	}

	let doc;
	try {
		doc = JSON.parse(body);
	} catch {
		return json({ error: 'body is not JSON' }, 400);
	}

	const problem = validate(doc, Math.floor(Date.now() / 1000));
	if (problem) {
		return json({ error: problem }, 422);
	}

	// Write the three fields by name, and never the body that came in.
	await env.STATUS.put(KEY, JSON.stringify({ up: doc.up, total: doc.total, at: doc.at }));
	return new Response(null, { status: 204 });
}

export function cacheSeconds(at, now) {
	const untilNextSend = at + PUSH_INTERVAL_SECONDS - now;
	return Math.min(PUSH_INTERVAL_SECONDS, Math.max(MIN_CACHE_SECONDS, untilNextSend));
}

export function validate(doc, now) {
	if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
		return 'document is not an object';
	}
	const keys = Object.keys(doc).sort();
	if (keys.length !== FIELDS.length || keys.some((key, i) => key !== FIELDS[i])) {
		return 'fields must be exactly: up, total, at';
	}
	for (const field of FIELDS) {
		if (!Number.isSafeInteger(doc[field]) || doc[field] < 0) {
			return `${field} must be a non-negative integer`;
		}
	}
	if (doc.total < 1 || doc.total > MAX_TOTAL) {
		return 'total is out of range';
	}
	if (doc.up > doc.total) {
		return 'up is more than total';
	}
	if (Math.abs(doc.at - now) > MAX_CLOCK_SKEW_SECONDS) {
		return 'at does not agree with the clock';
	}
	return null;
}

// An unset PUSH_TOKEN refuses every request. Both sides are hashed first, so
// the comparison takes the same time for every token.
async function authorized(request, env) {
	if (!env.PUSH_TOKEN) {
		return false;
	}
	const header = request.headers.get('Authorization') ?? '';
	if (!header.startsWith('Bearer ')) {
		return false;
	}
	const [given, expected] = await Promise.all([digest(header.slice(7)), digest(env.PUSH_TOKEN)]);
	let difference = 0;
	for (let i = 0; i < expected.length; i++) {
		difference |= given[i] ^ expected[i];
	}
	return difference === 0;
}

async function digest(text) {
	return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

function json(body, status, headers = {}) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
	});
}
