// The standalone Worker: the status endpoint, and 404 on every other path.
import { handleStatus, STATUS_PATH } from './handler.js';

export default {
	fetch: (request, env) =>
		new URL(request.url).pathname === STATUS_PATH ? handleStatus(request, env) : new Response(null, { status: 404 }),
};
