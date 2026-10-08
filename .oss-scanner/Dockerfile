# Build image for the Anthropic OSS Scanner (https://github.com/anthropics/oss-scanner).
# The scanner builds this file with the repository as the build context, then runs
# the image without network access. Everything the tests need is fetched here,
# including the VS Code build that the integration tests launch.
FROM node:22-bookworm

ENV DEBIAN_FRONTEND=noninteractive
# xvfb and the Electron runtime libraries let the VS Code integration tests run headless.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates git python3 xvfb xauth \
      libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libgbm1 libgtk-3-0 \
      libasound2 libxss1 libxkbfile1 libsecret-1-0 libxshmfence1 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=oven/bun:1.3.13 /usr/local/bin/bun /usr/local/bin/bun

COPY . /src
WORKDIR /src

# Install dependencies, compile the TypeScript, bundle the extension, and check the
# vendored PDF.js against the runtime contract.
RUN bun install --frozen-lockfile \
    && bun run compile \
    && bun run bundle \
    && bun run test:compat

# Download the VS Code version the integration tests pin (src/test/runTest.ts) into .vscode-test/.
ENV VSCODE_TEST_VERSION=1.95.0
RUN node -e "require('@vscode/test-electron').downloadAndUnzipVSCode(process.env.VSCODE_TEST_VERSION).then(p => console.log(p))"

# Run the tests once so a broken image is visible in the build log. A failure does not stop the build.
RUN xvfb-run -a node ./out/src/test/runTest.js || echo "WARNING: integration tests reported failures"
