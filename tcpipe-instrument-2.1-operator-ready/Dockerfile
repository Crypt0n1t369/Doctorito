# Two-stage build: the runtime image carries no build toolchain and no source tree.
FROM python:3.11-slim AS build
WORKDIR /src
RUN pip install --no-cache-dir build
COPY pyproject.toml ./
COPY src ./src
RUN python -m build --wheel --outdir /dist .

FROM python:3.11-slim
# lxml wheels are manylinux so no compiler is needed; tini gives us correct signal handling
# for a long-running worker.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /dist/*.whl /tmp/
# Install the wheel with its pdf extra from the local file, so the image never reaches for
# an index at build time.
RUN set -eux; \
    wheel="$(ls /tmp/*.whl)"; \
    pip install --no-cache-dir "${wheel}[pdf]"; \
    rm -f /tmp/*.whl

# The instrument writes exactly two places, both of which should be volumes: the governed
# database and the content-addressed artifact store. Nothing else is stateful.
ENV TCPIPE_DB=/data/pilot.db \
    TCPIPE_ARTIFACTS=/data/artifacts \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
VOLUME ["/data"]

# Run unprivileged. The artifact store is content-addressed and chmods files read-only, so
# the runtime user needs write on the directory, not on existing objects.
RUN useradd --create-home --uid 10001 tcpipe \
 && mkdir -p /data/artifacts \
 && chown -R tcpipe:tcpipe /data
USER tcpipe
WORKDIR /home/tcpipe

# Fails the container early if the image was built without its package data or an
# unwritable volume was mounted, rather than on an operator's first real command.
HEALTHCHECK --interval=60s --timeout=15s --start-period=5s --retries=3 \
  CMD tcpipe preflight >/dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "tcpipe"]
CMD ["preflight"]
