# The render service behind check_app and preview_app, on Playwright's image (WebKit and its
# system libraries, browsers at /ms-playwright) with Deno. Built from the folder deploy.sh stages.
FROM mcr.microsoft.com/playwright:v1.63.0-noble
COPY --from=denoland/deno:bin-2.9.7 /deno /usr/local/bin/deno
# Inter stands in for Apple's system font (fonts.conf), JetBrains Mono for ui-monospace.
RUN apt-get update && apt-get install -y --no-install-recommends fonts-inter fonts-jetbrains-mono && rm -rf /var/lib/apt/lists/*
COPY fonts.conf /etc/fonts/local.conf
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright DENO_DIR=/deno-dir DENO_NO_UPDATE_CHECK=1
WORKDIR /app
COPY . .
RUN deno cache --no-config scripts/page-render/server.ts && chown -R pwuser /app /deno-dir
USER pwuser
# All permissions inside the container: Playwright spawns WebKit and uses temp files. The pages
# themselves get no network (render.ts aborts every request but the app's own files and libraries).
CMD ["deno", "run", "--no-config", "-A", "scripts/page-render/server.ts"]
