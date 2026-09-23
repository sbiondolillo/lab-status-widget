// The lab status widget. It reads the Worker's `/api/status` and shows
// `N of M services up`, a light and the age of the data.
//
// The snippet is one element, and this script fills it:
//
//   <p data-lab-status="https://lab-status.example.workers.dev/api/status"
//      data-href="/posts/how-this-works"></p>
//
// data-lab-status  the Worker URL. Required.
// data-href        the count becomes a link to this target. Optional.
// data-title       the link's title attribute. Optional.
//
// Every state shows its age. Past STALE_AFTER_SECONDS the widget shows the
// stale state, because a stale number that looks live is the one failure
// nobody can see. The push job sends every 300 seconds, so the limit is
// three missed sends. A change to the push interval is a change to the
// two numbers below and to the Worker's copy. See the table in README.md.
//
// The light beside the count, and the text carries the meaning without it:
//   green   fresh data, and all services are up
//   yellow  fresh data, and fewer than all services are up
//   red     stale data, no data, or 0 services up
//   grey    the first load, before an answer
//
// This file is a plain script with no import and no export, so a page loads
// it with a script tag, and a bundler loads it as a module.

(function () {
	var STALE_AFTER_SECONDS = 900;
	var PUSH_INTERVAL_SECONDS = 300;
	// The widget asks again only when the next send is due, plus a margin for
	// the send to land. The wait when a send is late, or when the data is
	// stale. The age text ticks from the visitor's clock with no request.
	var SEND_MARGIN_SECONDS = 20;
	var RETRY_SECONDS = 60;
	var AGE_TICK_SECONDS = 30;

	function ageLabel(seconds) {
		if (seconds < 90) return '1 minute ago';
		if (seconds < 5400) return Math.round(seconds / 60) + ' minutes ago';
		if (seconds < 129600) return Math.round(seconds / 3600) + ' hours ago';
		return Math.round(seconds / 86400) + ' days ago';
	}

	function build(root) {
		root.classList.add('lab-status');
		root.dataset.state = 'loading';
		var count = root.dataset.href ? document.createElement('a') : document.createElement('span');
		count.className = 'count';
		if (root.dataset.href) count.href = root.dataset.href;
		if (root.dataset.title) count.title = root.dataset.title;
		var light = document.createElement('span');
		light.className = 'light';
		light.dataset.light = 'grey';
		light.setAttribute('aria-hidden', 'true');
		var text = document.createElement('span');
		text.dataset.count = '';
		text.textContent = '…';
		count.appendChild(light);
		count.appendChild(text);
		var age = document.createElement('small');
		age.dataset.age = '';
		root.textContent = '';
		root.appendChild(count);
		root.appendChild(age);
		return { light: light, count: text, age: age };
	}

	function start(root) {
		var url = root.dataset.labStatus;
		var parts = build(root);
		var status = null;

		// The age comes from the clock on every pass, so a tab that stays
		// open goes stale by itself when the sends stop.
		function render() {
			if (!status) {
				root.dataset.state = 'unavailable';
				parts.light.dataset.light = 'red';
				parts.count.textContent = 'no data';
				parts.age.textContent = '';
				return;
			}
			var seconds = Math.max(0, Math.floor(Date.now() / 1000) - status.at);
			var stale = seconds > STALE_AFTER_SECONDS;
			root.dataset.state = stale ? 'stale' : 'live';
			if (stale || status.up === 0) parts.light.dataset.light = 'red';
			else parts.light.dataset.light = status.up < status.total ? 'yellow' : 'green';
			parts.count.textContent = status.up + ' of ' + status.total + ' services up';
			parts.age.textContent = stale ? 'stale, ' + ageLabel(seconds) : ageLabel(seconds);
		}

		function refresh() {
			return fetch(url, { headers: { Accept: 'application/json' } })
				.then(function (response) {
					if (!response.ok) throw new Error(String(response.status));
					return response.json();
				})
				.then(function (doc) {
					if (![doc.up, doc.total, doc.at].every(Number.isSafeInteger)) throw new Error('shape');
					status = { up: doc.up, total: doc.total, at: doc.at };
				})
				.catch(function () {
					// Keep the last good answer. Its age keeps it honest.
				})
				.then(render);
		}

		// The next request waits until new data can exist. A late send gets a
		// short retry. Stale data means the path is broken, so the retry is
		// one push interval.
		function nextWait() {
			if (!status) return RETRY_SECONDS;
			var now = Math.floor(Date.now() / 1000);
			if (now - status.at > STALE_AFTER_SECONDS) return PUSH_INTERVAL_SECONDS;
			return Math.max(RETRY_SECONDS, status.at + PUSH_INTERVAL_SECONDS + SEND_MARGIN_SECONDS - now);
		}

		function loop() {
			refresh().then(function () {
				setTimeout(loop, nextWait() * 1000);
			});
		}

		loop();
		setInterval(render, AGE_TICK_SECONDS * 1000);
	}

	function startAll() {
		var roots = document.querySelectorAll('[data-lab-status]:not([data-state])');
		for (var i = 0; i < roots.length; i++) start(roots[i]);
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', startAll);
	} else {
		startAll();
	}
})();
