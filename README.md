# lab-status-widget

A status line for a personal site: `17 of 17 services up`, a light, and the age of the data. The data comes
from a homelab, and no request from a visitor reaches the lab.

Three parts, in the order you set them up:

| Part | Directory | What it is |
|---|---|---|
| The Worker | `worker/` | A Cloudflare Worker with a KV store. It takes a small document by POST and serves it by GET. |
| The push job | `push/` | A Python loop in a container. Every 300 s it counts your services and POSTs the document. |
| The widget | `widget/` | A plain script and a stylesheet. One element on any page shows the count. |

## What a visitor learns, and what you expose

The lab pushes out. The push job sends three integers, and nothing else:

```json
{"up": 16, "total": 17, "at": 1789859963}
```

The Worker refuses a document with any other field, so a mistake in the push job cannot publish a name or an
address. The Worker holds no address or route into the lab, and nothing in the lab listens to the internet.

The price is a public read, and a Worker on hardware you do not own. A visitor learns three integers: how
many services you run, how many are up, and when the last send landed. Decide whether that fits your risk
tolerance before you deploy it.

## 1. The Worker

Prerequisites: a Cloudflare account, and Node 22 or later.

1. Clone this repo and run `npm install --save-dev wrangler`.
2. In the Cloudflare dashboard, make a KV namespace under Storage & Databases, KV. Put its id in
   `wrangler.jsonc`. The id is an identifier and not a secret.
3. Run `npx wrangler deploy`. It prints the Worker's URL.
4. Make a token with `openssl rand -hex 32`. Save it on the Worker as the secret `PUSH_TOKEN`, under
   Settings, Variables and Secrets. A later deploy keeps the secret.

`GET <worker>/api/status` now answers 503 `no status yet`. The Worker answers every other path with 404.

The Worker answers `GET` from any origin, with `Access-Control-Allow-Origin: *`. `POST` needs the bearer
token. Run `npm test` to run the tests of the handler.

If you already run a Worker for your site, import the handler instead of deploying this one:

```js
import { handleStatus, STATUS_PATH } from 'lab-status-widget';

export default {
	fetch: (request, env) =>
		new URL(request.url).pathname === STATUS_PATH ? handleStatus(request, env) : env.ASSETS.fetch(request),
};
```

That Worker needs the same KV binding `STATUS` and the same secret `PUSH_TOKEN`.

## 2. The push job

Prerequisites: a host in the lab with Docker, and a source of counts.

1. Copy `push/.env.example` to `push/.env`. Set `STATUS_URL` to the Worker's URL plus `/api/status`, and
   `PUSH_TOKEN` to the token from step 4 above.
2. Pick the source with `SOURCE`. `prometheus` counts Uptime Kuma monitors through Prometheus, and needs
   `PROMETHEUS_URL` and the network in `push/docker-compose.yml`. `static` sends `STATIC_UP` and
   `STATIC_TOTAL`, and needs no monitoring. Start with `static` to prove the path.
3. Run `docker compose up -d --build` in `push/`.
4. Read `docker logs lab-status-push`. A good line is `pushed up=17 total=17, answer 204`.

The answers of the Worker to a send:

| Answer | Meaning |
|---|---|
| 204 | Written to KV. |
| 401 | The token is wrong, or the Worker has no `PUSH_TOKEN` secret. |
| 422 | The document broke the schema. The answer body names the rule. |
| 3xx | Something in front of the Worker redirected the request. The job refuses every redirect, because a redirect would carry the token to another host. |

A compose file elsewhere builds the job from this repo at a tag, with no clone:

```yaml
build:
  context: https://github.com/sbiondolillo/lab-status-widget.git#v1.0.0:push
```

### Write your own source

A source is a module in `push/sources/` with one function, `count()`, that returns `(up, total)`. Name it
with `SOURCE`. Raise on any doubt. A pass that raises sends nothing, and the widget shows stale.
`push/sources/static.py` is the model.

## 3. The widget

One element, the stylesheet and the script. `widget/index.html` is the whole example.

```html
<link rel="stylesheet" href="lab-status.css" />
<p data-lab-status="https://lab-status.example.workers.dev/api/status" data-href="/posts/how-this-works"></p>
<script src="lab-status.js" defer></script>
```

| Attribute | Meaning |
|---|---|
| `data-lab-status` | The Worker's status URL. Required. |
| `data-href` | The count becomes a link to this target. Optional. |
| `data-title` | The link's `title` attribute. Optional. |

The widget shows one of four states, and the text carries the meaning without the light:

| State | Text | Light |
|---|---|---|
| live, all up | `17 of 17 services up · 3 minutes ago` | green |
| live, some down | `16 of 17 services up · 3 minutes ago` | yellow |
| stale | `17 of 17 services up · stale, 20 minutes ago` | red |
| no data | `no data` | red |

The stylesheet reads six CSS variables, and each has a default in the file. Set `--text-muted`,
`--font-code`, `--accent`, `--status-green`, `--status-yellow`, `--status-red` and `--status-grey` on your
page to match it.

### Astro

```
npm install github:sbiondolillo/lab-status-widget#v1.0.0
```

```astro
---
import LabStatus from 'lab-status-widget/astro';
---
<LabStatus url="/api/status" href="/posts/how-this-works" title="How this widget works" />
```

The component loads the stylesheet and the script, and prints the element. `url` defaults to `/api/status`
on the same origin, for a site whose own Worker imports the handler.

## The numbers depend on each other

| Number | Value | Where | Reason |
|---|---|---|---|
| Push interval | 300 s | `INTERVAL_SECONDS` in `push/.env` | The Workers free plan allows 1,000 KV writes each day across the account. 300 s is 288 writes each day for one job. 60 s is 1,440. |
| Stale limit | 900 s | `STALE_AFTER_SECONDS` in `widget/lab-status.js` | Three missed sends. |
| The Worker's and the widget's copy of the interval | 300 s | `PUSH_INTERVAL_SECONDS` in `worker/handler.js` and in `widget/lab-status.js` | The Worker sets `Cache-Control: max-age` to the time until the next send, with a floor of 30 s. The widget asks again only when the next send is due. |
| Clock tolerance | 300 s | `MAX_CLOCK_SKEW_SECONDS` in `worker/handler.js` | The Worker refuses an `at` that is further from its own clock. |

**A change to the interval is a change to three files:** `push/.env`, `worker/handler.js` and
`widget/lab-status.js`. A browser that holds an answer past a new send, or a widget that shows stale after
one missed send, is the sign that one file was missed.

## A failed pass sends nothing, and that is the design

A stale number that looks live is the one failure that nobody can see. So every fault ends in the same
visible state: the widget shows `stale` and the age of the last good send. Nobody reloads the page for it.
The age comes from the visitor's clock, so an open tab goes stale by itself.

- **The source is down, or the Worker refuses the send:** the job logs one `FAIL` line and tries again
  after the interval.
- **The Prometheus source finds no series:** Prometheus drops a series 5 minutes after its last scrape, so
  a total of 0 means that the scrape is broken. The job sends nothing.
- **The lab's clock is wrong by more than 300 s:** the Worker answers 422, `at does not agree with the
  clock`.

## Who runs it

The site of [@sbiondolillo](https://github.com/sbiondolillo) runs this package at the tag `v1.0.0`: its
Worker imports the handler, its layout imports the Astro component, and a job in the lab builds `push/` from
the git URL above. A change to the widget is a new tag and a site update.

## License

MIT. See `LICENSE`.
