"""The static source: two numbers from the environment.

It proves the path from the job to the widget with no monitoring behind it,
and it is the model for a new source. A source is a module in this directory
with one function, `count()`, that returns `(up, total)`. Raise on any doubt:
a pass that raises sends nothing, and the widget shows stale.
"""

import os

STATIC_UP = int(os.environ.get("STATIC_UP", "1"))
STATIC_TOTAL = int(os.environ.get("STATIC_TOTAL", "1"))


def count():
    return STATIC_UP, STATIC_TOTAL
