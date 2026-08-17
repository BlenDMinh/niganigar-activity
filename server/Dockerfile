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
RUN apk add --no-cache python3 py3-pip ffmpeg && \
    pip3 install --no-cache-dir --break-system-packages yt-dlp

COPY --from=builder /app/package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 3001

CMD ["node", "dist/main"]
