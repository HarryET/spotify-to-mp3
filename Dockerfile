# ---- Base ----
FROM node:20-alpine AS base
WORKDIR /app

# npm is included with Node.js, no extra install needed

# ---- Dependencies ----
FROM base AS deps
WORKDIR /app

# Install OS dependencies for native builds (canvas), ffmpeg, yt-dlp, and git
RUN apk add --no-cache \
    build-base \
    pkgconfig \
    cairo-dev \
    jpeg-dev \
    giflib-dev \
    pango-dev \
    librsvg-dev \
    ffmpeg \
    yt-dlp \
    git

# Copy dependency definitions
# Use package-lock.json for npm
COPY package.json package-lock.json ./

# Install dependencies using npm ci (clean install based on lockfile)
# This will build native dependencies like canvas
RUN npm ci

# ---- Builder ----
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build the Next.js app using npm
RUN npm run build

# ---- Runner ----
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
# Uncomment the following line in case you want to disable telemetry during runtime.
# ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Install runtime OS dependencies ONLY (ffmpeg, yt-dlp)
# Build dependencies are NOT needed here
RUN apk add --no-cache ffmpeg yt-dlp

# Set paths explicitly (standard location after apk add)
ENV YT_DLP_PATH=/usr/bin/yt-dlp
ENV FFMPEG_PATH=/usr/bin/ffmpeg

# Copy built application artifacts from builder
# First, copy the standalone output which includes necessary node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./

# Explicitly copy youtubei.js to ensure all its files are present
# This might overwrite parts of the node_modules copied by standalone, but ensures this specific dependency is complete.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/youtubei.js ./node_modules/youtubei.js

# Copy static assets and public folder
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs

EXPOSE 3000

ENV PORT=3000

CMD ["node", "server.js"] 