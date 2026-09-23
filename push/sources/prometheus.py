"""The Prometheus source: Uptime Kuma monitors, scraped by Prometheus.

PROMETHEUS_URL names the server. The default is the compose service name.
"""

import json
import os
import urllib.parse
import urllib.request

PROMETHEUS_URL = os.environ.get("PROMETHEUS_URL", "http://prometheus:9090")
TIMEOUT_SECONDS = 15

# monitor_status: 0 DOWN, 1 UP, 2 PENDING, 3 MAINTENANCE. Only 1 counts as up.
QUERY_TOTAL = "count(monitor_status)"
QUERY_UP = "count(monitor_status == 1)"


def query(promql):
    """Return the integer result of a PromQL count. An empty vector is 0."""
    url = f"{PROMETHEUS_URL}/api/v1/query?" + urllib.parse.urlencode({"query": promql})
    with urllib.request.urlopen(url, timeout=TIMEOUT_SECONDS) as response:
        answer = json.load(response)
    if answer.get("status") != "success":
        raise RuntimeError(f"Prometheus answered {answer.get('status')!r} for {promql!r}")
    result = answer["data"]["result"]
    if not result:
        return 0
    return int(float(result[0]["value"][1]))


def count():
    total = query(QUERY_TOTAL)
    up = query(QUERY_UP)
    # Prometheus drops a series 5 minutes after its last scrape. A total of 0
    # therefore means that the scrape is broken, and not that the lab has no
    # services. Send nothing, and let the widget go stale.
    if total == 0:
        raise RuntimeError("Prometheus holds no monitor_status series")
    return up, total
