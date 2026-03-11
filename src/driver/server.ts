#!/usr/bin/env node
/**
 * DIF Universal Resolver Driver — did:sns
 *
 * Lightweight HTTP server conforming to the DIF Universal Resolver driver spec.
 * Exposes GET /1.0/identifiers/{did} returning W3C DID Resolution Results.
 *
 * Environment variables:
 *   SOLANA_RPC_URL   — Custom Solana RPC endpoint (defaults to mainnet public)
 *   PORT             — HTTP port (defaults to 8080)
 *   LOG_LEVEL        — "debug" | "info" | "warn" | "error" (defaults to "info")
 *
 * @see https://github.com/decentralized-identity/universal-resolver
 * @see https://w3c-ccg.github.io/did-resolution/
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { DidSnsResolver } from '../resolver.js'

const PORT = Number(process.env.PORT || 8080)
const LOG_LEVEL = process.env.LOG_LEVEL || 'info'
const VERSION = '0.1.0'

const resolver = new DidSnsResolver({
  rpcUrl: process.env.SOLANA_RPC_URL,
})

function log(level: string, message: string, data?: Record<string, unknown>) {
  const levels = ['debug', 'info', 'warn', 'error']
  if (levels.indexOf(level) < levels.indexOf(LOG_LEVEL)) return
  const entry = { timestamp: new Date().toISOString(), level, message, ...data }
  console.log(JSON.stringify(entry))
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body, null, 2)
  res.writeHead(status, {
    'Content-Type': 'application/did+ld+json',
    'Content-Length': Buffer.byteLength(json),
  })
  res.end(json)
}

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`)
  const method = req.method || 'GET'

  // Health check
  if (url.pathname === '/health' || url.pathname === '/') {
    sendJson(res, 200, {
      status: 'ok',
      driver: 'did-sns',
      version: VERSION,
      supportedMethods: ['sns'],
    })
    return
  }

  // Properties endpoint (DIF driver convention)
  if (url.pathname === '/1.0/properties') {
    sendJson(res, 200, {
      'driver-0': {
        http: {
          pattern: '^did:sns:.+$',
          resolverUri: `http://localhost:${PORT}/1.0/identifiers/`,
          testIdentifiers: [
            'did:sns:bonfida',
            'did:sns:devnet:test.attestto',
          ],
        },
        method: 'sns',
        implementation: 'Attestto did:sns Resolver',
        implementationUrl: 'https://github.com/Attestto-com/did-sns-resolver',
      },
    })
    return
  }

  // DID Resolution endpoint
  const identifierMatch = url.pathname.match(/^\/1\.0\/identifiers\/(.+)$/)
  if (identifierMatch && method === 'GET') {
    const did = decodeURIComponent(identifierMatch[1])

    // Validate method
    if (!did.startsWith('did:sns:')) {
      sendJson(res, 400, {
        '@context': 'https://w3id.org/did-resolution/v1',
        didDocument: null,
        didResolutionMetadata: {
          error: 'methodNotSupported',
          errorMessage: `This driver only resolves did:sns DIDs, got: ${did}`,
        },
        didDocumentMetadata: {},
      })
      return
    }

    log('info', 'Resolving DID', { did })

    const result = await resolver.resolve(did)

    const status = result.didResolutionMetadata.error ? 404 : 200

    log(
      result.didResolutionMetadata.error ? 'warn' : 'info',
      result.didResolutionMetadata.error ? 'Resolution failed' : 'Resolution successful',
      { did, duration: result.didResolutionMetadata.duration, error: result.didResolutionMetadata.error }
    )

    sendJson(res, status, result)
    return
  }

  // 404 for everything else
  sendJson(res, 404, { error: 'Not found', path: url.pathname })
}

const server = createServer(async (req, res) => {
  try {
    await handleRequest(req, res)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    log('error', 'Unhandled error', { error: message })
    sendJson(res, 500, {
      '@context': 'https://w3id.org/did-resolution/v1',
      didDocument: null,
      didResolutionMetadata: { error: 'internalError', errorMessage: message },
      didDocumentMetadata: {},
    })
  }
})

server.listen(PORT, () => {
  log('info', `did:sns Universal Resolver driver listening on port ${PORT}`, {
    version: VERSION,
    rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com (default)',
  })
})
