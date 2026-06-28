# =========================================================================
# STAGE 1: INSTALL DEPENDENCIES
# =========================================================================
FROM node:20-alpine AS deps
# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy package manifests
COPY package.json package-lock.json ./
RUN npm ci

# =========================================================================
# STAGE 2: BUILD APPLICATION
# =========================================================================
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Set build-time environment variables
ENV NEXT_TELEMETRY_DISABLED 1
ENV NODE_ENV production

# Accept Supabase public credentials from docker build --build-arg
ARG NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL

ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY

# Run the build script (triggers Next.js build + widget.js bundling)
RUN npm run build

# =========================================================================
# STAGE 3: RUNTIME RUNNER (MINIFIED BASE)
# =========================================================================
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1
ENV PORT 3000
ENV HOSTNAME "0.0.0.0"

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
