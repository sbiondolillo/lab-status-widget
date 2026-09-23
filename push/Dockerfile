# The push job. It needs Python and nothing else.
FROM python:3.12-slim
WORKDIR /app
COPY push.py ./
COPY sources/ ./sources/
# The job writes nothing, so it runs as nobody.
USER 65534:65534
CMD ["python3", "/app/push.py"]
