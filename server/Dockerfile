# ---- Build stage ----
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Production stage ----
FROM node:20-alpine

WORKDIR /app

# yt-dlp (music playback) — installed via pip since Alpine is musl-based
# and yt-dlp's standalone PyInstaller binaries target glibc. Left unpinned
# on purpose: yt-dlp needs frequent updates to keep up with YouTube's
# anti-bot changes, so rebuild the image periodically to pick up fixes.
#
# deno + yt-dlp-ejs-rt-deno: YouTube protects real stream URLs behind an
# obfuscated-JS signature/"n challenge" that yt-dlp must execute to
# decipher. Without a JS runtime for this, yt-dlp silently falls back to
# only offering formats that don't need deciphering (storyboard
# thumbnails), even with valid auth — no error, just near-empty results.
RUN apk add --no-cache python3 py3-pip ffmpeg deno yt-dlp-ejs-rt-deno && \
    pip3 install --no-cache-dir --break-system-packages yt-dlp

COPY --from=builder /app/package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 3001

CMD ["node", "dist/main"]
