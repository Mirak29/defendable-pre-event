# Unlike tournament, the image keeps the Deno runtime (no `deno compile`):
# the sandbox (api/sandbox.ts) runs the candidate's code in a `deno`
# subprocess (Deno.execPath()), offline (--cached-only), so the modules the
# candidate may import (jsr:@std/assert) are cached at build time.
FROM denoland/deno:alpine
WORKDIR /app

# SQLite for @db/sqlite (FFI), like tournament
RUN apk add --no-cache sqlite-libs
ENV DENO_SQLITE_PATH=/usr/lib/libsqlite3.so.0

COPY deno.json .
COPY qa/deno.json qa/deno.json
COPY build-config.ts task-prod.ts prod-server.ts ./
COPY api/ api/
COPY web/ web/
COPY fixtures/ fixtures/
COPY migrations/ migrations/

# Build the front (dist/), then cache the server and the candidate's modules
RUN deno run -A task-prod.ts \
  && deno cache prod-server.ts \
  && echo 'import "jsr:@std/assert@1"' > /tmp/candidate-deps.ts \
  && deno cache /tmp/candidate-deps.ts \
  && rm /tmp/candidate-deps.ts

ENV APP_ENV=prod
ENV PORT=8000
# path the app is served under (<base href>), required by @01edu/api in prod
ENV BASE_URL=/
ENV DATABASE_PATH=/app/data/defendable.db
# the demo space always has the assessment of the brief and its report
# (seeded into the volume when missing), and « Essayer la démo » opens it
ENV SEED_DEMO=1
ENV DEMO_ACCESS=1
RUN mkdir -p /app/data

# Required at run time: REDIRECT_URI (public URL of the app). Optional:
# NVIDIA_API_KEY and GEMINI_API_KEY (without them, every AI step replays the
# recorded answers), RESEND_API_KEY and RESEND_FROM (the personal link is sent
# by e-mail). `deno task deploy` keeps them in ~/defendable/.env-prod.
EXPOSE 8000
VOLUME /app/data
CMD ["deno", "run", "-A", "--unstable-ffi", "prod-server.ts"]
