# DIF Universal Resolver Driver — did:sns
#
# Resolves did:sns DIDs via Solana Name Service.
# Exposes GET /1.0/identifiers/{did} per DIF Universal Resolver spec.
#
# Build:  docker build -t attestto/uni-resolver-driver-did-sns .
# Run:    docker run -p 8080:8080 -e SOLANA_RPC_URL=... attestto/uni-resolver-driver-did-sns
#
# Environment:
#   SOLANA_RPC_URL  — Custom Solana RPC (defaults to mainnet public)
#   PORT            — HTTP port (defaults to 8080)
#   LOG_LEVEL       — debug|info|warn|error (defaults to info)

FROM node:22-alpine AS builder

WORKDIR /app
COPY package.json ./
RUN npm install --ignore-scripts
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

FROM node:22-alpine AS runner

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts
COPY --from=builder /app/dist/ ./dist/

ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/health || exit 1

USER node
CMD ["node", "dist/driver/server.js"]
