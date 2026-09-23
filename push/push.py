#!/usr/bin/env python3
"""The lab status push job.

The lab pushes out. Every INTERVAL_SECONDS this job asks its source for two
counts and POSTs three integers to the Worker:

    {"up": 16, "total": 17, "at": 1789859963}

Those three fields are the whole payload. The Worker refuses any other field,
so this file must never add a name, a label or an address to the document.

The source is the module `sources/<SOURCE>.py`, and its `count()` returns
`(up, total)`. `prometheus` counts Uptime Kuma monitors, and `static` returns
two numbers from the environment.

A failed pass sends nothing, and the widget on the site then goes stale by
itself. That is the correct result: a stale widget is honest, and a wrong
count is not. So every error is logged and the loop continues.
"""

import importlib
import json
import os
import sys
import time
import urllib.error
import urllib.request

STATUS_URL = os.environ["STATUS_URL"]
PUSH_TOKEN = os.environ["PUSH_TOKEN"]
SOURCE = os.environ.get("SOURCE", "prometheus")
INTERVAL_SECONDS = int(os.environ.get("INTERVAL_SECONDS", "300"))
TIMEOUT_SECONDS = 15

source = importlib.import_module(f"sources.{SOURCE}")


def log(message):
    print(time.strftime("%Y-%m-%dT%H:%M:%S%z"), message, flush=True)


def push_once():
    up, total = source.count()
    document = {"up": up, "total": total, "at": int(time.time())}
    request = urllib.request.Request(
        STATUS_URL,
        data=json.dumps(document).encode(),
        method="POST",
        headers={
            "Authorization": f"Bearer {PUSH_TOKEN}",
            "Content-Type": "application/json",
            # Cloudflare refuses the default Python-urllib agent with 403.
            "User-Agent": "lab-status-push/1",
        },
    )
    with OPENER.open(request, timeout=TIMEOUT_SECONDS) as response:
        if response.status != 204:
            raise RuntimeError(f"the Worker answered {response.status}, and only 204 is a write")
        log(f"pushed up={up} total={total}, answer 204")


class RefuseRedirect(urllib.request.HTTPRedirectHandler):
    """A redirect is never the Worker. Following one sends the bearer token
    to another host, and the login page it lands on answers 200."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


OPENER = urllib.request.build_opener(RefuseRedirect)


def main():
    log(f"start, source {SOURCE}, every {INTERVAL_SECONDS} s")
    while True:
        try:
            push_once()
        except urllib.error.HTTPError as error:
            # The answer body names the refused field. It never holds the token.
            log(f"FAIL the Worker answered {error.code}: {error.read(200).decode(errors='replace')}")
        except Exception as error:  # noqa: BLE001 - the loop must survive every fault
            log(f"FAIL {type(error).__name__}: {error}")
        time.sleep(INTERVAL_SECONDS)


if __name__ == "__main__":
    sys.exit(main())
