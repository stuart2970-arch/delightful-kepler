# =========================================================================
# STAGE 1: INSTALL DEPENDENCIES
# =========================================================================
FROM node:22-alpine AS deps
# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk update && apk upgrade --no-cache && apk add --no-cache libc6-compat
WORKDIR /app

# Copy package manifests
COPY package.json package-lock.json ./
RUN npm ci

# =========================================================================
# STAGE 2: BUILD APPLICATION
# =========================================================================
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Set build-time environment variables
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# STYL-203: NO live Supabase URL/anon-key fallbacks.
# Production Cloud Run must pass these via docker build --build-arg (see deploy.yml).
# A build with missing args fails loudly instead of silently pointing at live.
ARG APP_ENV=
ENV APP_ENV=$APP_ENV

ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY

RUN if [ -z "$NEXT_PUBLIC_SUPABASE_URL" ] || [ -z "$NEXT_PUBLIC_SUPABASE_ANON_KEY" ]; then \
      echo "ERROR (STYL-203): NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY build-args are required. No live-project fallback."; \
      exit 1; \
    fi

# Staging Docker builds (if ever used) must never embed the live project ref.
RUN if [ "$APP_ENV" = "staging" ] && echo "$NEXT_PUBLIC_SUPABASE_URL" | grep -q "tkoasyjvrgaglofpzduq"; then \
      echo "ERROR (STYL-203): APP_ENV=staging but NEXT_PUBLIC_SUPABASE_URL references the LIVE Supabase project."; \
      exit 1; \
    fi

ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY

ARG NEXT_PUBLIC_GA_MEASUREMENT_ID=
ENV NEXT_PUBLIC_GA_MEASUREMENT_ID=$NEXT_PUBLIC_GA_MEASUREMENT_ID

ARG NEXT_PUBLIC_FB_PIXEL_ID=
ENV NEXT_PUBLIC_FB_PIXEL_ID=$NEXT_PUBLIC_FB_PIXEL_ID

# Run the build script (triggers Next.js build + widget.js bundling)
RUN npm run build

# =========================================================================
# STAGE 3: RUNTIME RUNNER (MINIFIED BASE)
# =========================================================================
FROM node:22-alpine AS runner
RUN apk update && apk upgrade --no-cache && \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME="0.0.0.0"

# Create a non-root system user and group for runtime security (GDPR compliance best practice)
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy public folder (contains favicon, test pages, and compiled widget.js)
COPY --from=builder /app/public ./public

# Set permissions for pre-rendered cache directories
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Copy standalone build output and static folders
# Next.js standalone output contains only the minimal dependencies needed for runner
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Switch to the non-root execution user
USER nextjs

EXPOSE 3000

# Start the Node server (default standalone Next.js entrypoint)
CMD ["node", "server.js"]
