/**
 * Standalone did:sns Resolver
 *
 * Pure resolution logic with zero framework dependencies.
 * Resolves did:sns DIDs to W3C DID Documents by querying Solana Name Service.
 *
 * Resolution algorithm (per did-sns-method-specification.md §4.2):
 * 1. Parse DID → extract sns-name and optional network
 * 2. Hash domain → derive PDA via SNS program
 * 3. Fetch on-chain account → extract owner public key
 * 4. Construct DID Document with verification methods + services
 *
 * @see https://spec.attestto.com
 * @see https://www.w3.org/TR/did-core/
 * @see https://w3c-ccg.github.io/did-resolution/
 */

import { Connection, PublicKey } from '@solana/web3.js'
import { createHash } from 'node:crypto'

// ── SNS Constants ────────────────────────────────────────────────────────────

const SNS_PROGRAM_ID = new PublicKey('namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX')
const SOL_TLD_PARENT = new PublicKey('58PwtjSDuFHuUkYjH9BYnnQKHfwo9reZhC2zMJv9JPkx')
const HASH_PREFIX = 'SPL Name Service'

const NETWORK_ENDPOINTS: Record<string, string> = {
  mainnet: 'https://api.mainnet-beta.solana.com',
  devnet: 'https://api.devnet.solana.com',
  testnet: 'https://api.testnet.solana.com',
}

const DID_CONTEXT = [
  'https://www.w3.org/ns/did/v1',
  'https://w3id.org/security/suites/ed25519-2020/v1',
  'https://w3id.org/security/suites/secp256k1-2019/v1',
  'https://w3id.org/security/suites/x25519-2020/v1',
]

// ── Types ────────────────────────────────────────────────────────────────────

interface ParsedSnsDid {
  did: string
  name: string
  network: string
}

export interface DidDocument {
  '@context': string[]
  'id': string
  'controller': string[]
  'verificationMethod': VerificationMethod[]
  'authentication': string[]
  'assertionMethod': string[]
  'keyAgreement'?: string[]
  'service'?: ServiceEndpoint[]
}

interface VerificationMethod {
  id: string
  type: string
  controller: string
  publicKeyBase58?: string
  publicKeyMultibase?: string
}

interface ServiceEndpoint {
  id: string
  type: string
  serviceEndpoint: string | Record<string, unknown>
}

export interface DidResolutionResult {
  '@context': string
  didDocument: DidDocument | null
  didResolutionMetadata: DidResolutionMetadata
  didDocumentMetadata: DidDocumentMetadata
}

export interface DidResolutionMetadata {
  contentType?: string
  error?: string
  errorMessage?: string
  duration?: number
  snsMetadata?: Record<string, unknown>
}

export interface DidDocumentMetadata {
  created?: string
  updated?: string
  deactivated?: boolean
  versionId?: string
}

export interface DidSnsResolverOptions {
  /** Custom Solana RPC endpoint */
  rpcUrl?: string
}

// ── Resolver ─────────────────────────────────────────────────────────────────

export class DidSnsResolver {
  private connectionCache: Map<string, Connection> = new Map()
  private defaultRpcUrl?: string

  constructor(options?: DidSnsResolverOptions) {
    this.defaultRpcUrl = options?.rpcUrl
  }

  /**
   * Resolve a did:sns DID to a W3C DID Resolution Result.
   */
  async resolve(did: string): Promise<DidResolutionResult> {
    const startTime = Date.now()

    try {
      // Step 1: Parse
      const parsed = this.parseDid(did)
      if (!parsed) {
        return this.errorResult('invalidDid', `Cannot parse DID: ${did}`)
      }

      // Step 2: Derive PDA
      const domainParts = parsed.name.split('.')
      if (domainParts.length > 2) {
        return this.errorResult(
          'invalidDid',
          'SNS supports max 2 levels (parent.subdomain)'
        )
      }

      // Step 3: Fetch on-chain
      const rpcUrl =
        this.defaultRpcUrl ||
        process.env.SOLANA_RPC_URL ||
        NETWORK_ENDPOINTS[parsed.network] ||
        NETWORK_ENDPOINTS.mainnet
      const connection = this.getConnection(rpcUrl)

      const domainData = await this.fetchDomainData(connection, parsed.name)
      if (!domainData) {
        return this.errorResult('notFound', `Domain not found: ${parsed.name}.sol`)
      }

      // Check for deactivated (zero owner)
      if (domainData.owner === '11111111111111111111111111111111') {
        return {
          '@context': 'https://w3id.org/did-resolution/v1',
          didDocument: null,
          didResolutionMetadata: { contentType: 'application/did+ld+json' },
          didDocumentMetadata: { deactivated: true },
        }
      }

      // Step 4: Build DID Document
      const didDocument = this.buildDidDocument(parsed, domainData)

      const duration = Date.now() - startTime

      return {
        '@context': 'https://w3id.org/did-resolution/v1',
        didDocument,
        didResolutionMetadata: {
          contentType: 'application/did+ld+json',
          duration,
          snsMetadata: {
            owner: domainData.owner,
            network: parsed.network,
            classKey: domainData.classKey,
          },
        },
        didDocumentMetadata: {
          versionId: domainData.owner,
        },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return this.errorResult('internalError', message)
    }
  }

  /**
   * Parse a did:sns DID string.
   *
   * Formats:
   *   did:sns:alice.attestto          → mainnet, name = alice.attestto
   *   did:sns:devnet:alice.attestto   → devnet, name = alice.attestto
   *   did:sns:alice                   → mainnet, name = alice (root domain)
   */
  parseDid(did: string): ParsedSnsDid | null {
    const match = did.match(/^did:sns:(?:(mainnet|devnet|testnet):)?([a-zA-Z0-9][\w.-]*)$/)
    if (!match) return null

    const network = match[1] || 'mainnet'
    const name = match[2]

    if (!name || name.length === 0) return null

    return { did, name, network }
  }

  // ── On-Chain Fetching ────────────────────────────────────────────────────

  /**
   * Hash a domain name for SNS PDA derivation.
   */
  private hashDomainName(name: string): Buffer {
    const input = `${HASH_PREFIX}${name}`
    return createHash('sha256').update(input, 'utf8').digest()
  }

  /**
   * Fetch domain data from Solana Name Service.
   */
  private async fetchDomainData(
    connection: Connection,
    name: string
  ): Promise<{ owner: string; classKey: string | null } | null> {
    const parts = name.split('.')

    let domainKey: PublicKey

    // SNS PDA derivation uses 3 seeds: [hash, classKey, parent]
    // classKey is 32 zero bytes for standard domains (no class lock)
    const zeroClassKey = Buffer.alloc(32)

    if (parts.length === 1) {
      // Root domain: alice → hash("alice") with parent = SOL_TLD
      const hashedName = this.hashDomainName(parts[0])
      const [key] = PublicKey.findProgramAddressSync(
        [hashedName, zeroClassKey, SOL_TLD_PARENT.toBuffer()],
        SNS_PROGRAM_ID
      )
      domainKey = key
    } else {
      // Subdomain: alice.attestto → hash("attestto") for parent, then hash("\0alice") with parent key
      const parentHash = this.hashDomainName(parts[1])
      const [parentKey] = PublicKey.findProgramAddressSync(
        [parentHash, zeroClassKey, SOL_TLD_PARENT.toBuffer()],
        SNS_PROGRAM_ID
      )

      const subHash = this.hashDomainName(`\0${parts[0]}`)
      const [subKey] = PublicKey.findProgramAddressSync(
        [subHash, zeroClassKey, parentKey.toBuffer()],
        SNS_PROGRAM_ID
      )
      domainKey = subKey
    }

    const accountInfo = await connection.getAccountInfo(domainKey)
    if (!accountInfo || accountInfo.data.length < 96) {
      return null
    }

    // SNS NameRegistry header layout:
    // bytes 0-31:  parentName (PublicKey)
    // bytes 32-63: owner (PublicKey)
    // bytes 64-95: class (PublicKey) — zero = unlocked
    const ownerBytes = accountInfo.data.slice(32, 64)
    const owner = new PublicKey(ownerBytes).toBase58()

    let classKey: string | null = null
    const classKeyBytes = accountInfo.data.slice(64, 96)
    const classKeyPub = new PublicKey(classKeyBytes)
    if (!classKeyPub.equals(PublicKey.default)) {
      classKey = classKeyPub.toBase58()
    }

    return { owner, classKey }
  }

  // ── DID Document Construction ──────────────────────────────────────────

  /**
   * Build a W3C DID Document from parsed DID and on-chain data.
   */
  private buildDidDocument(
    parsed: ParsedSnsDid,
    domainData: { owner: string; classKey: string | null }
  ): DidDocument {
    const did = parsed.did
    const ownerKey = domainData.owner

    const verificationMethods: VerificationMethod[] = [
      {
        id: `${did}#key-1`,
        type: 'Ed25519VerificationKey2020',
        controller: did,
        publicKeyBase58: ownerKey,
      },
    ]

    const services: ServiceEndpoint[] = [
      {
        id: `${did}#sns-domain`,
        type: 'LinkedDomains',
        serviceEndpoint: `https://${parsed.name}.sol`,
      },
    ]

    // Add Attestto platform service if this is an attestto subdomain
    if (parsed.name.includes('attestto')) {
      services.push({
        id: `${did}#attestto-platform`,
        type: 'VerifiablePresentationService',
        serviceEndpoint: {
          origins: ['https://app.attestto.com'],
          presentations: `https://api.attestto.com/ssi/my-credentials`,
        },
      })
    }

    // Revocation status list service
    services.push({
      id: `${did}#status-list`,
      type: 'BitstringStatusList',
      serviceEndpoint: `https://api.attestto.com/api/status/`,
    })

    // Controller hierarchy — subdomains are controlled by parent
    const controller: string[] = [did]
    const nameParts = parsed.name.split('.')
    if (nameParts.length === 2) {
      const networkPrefix = parsed.network !== 'mainnet' ? `${parsed.network}:` : ''
      controller.push(`did:sns:${networkPrefix}${nameParts[1]}`)
    }

    const doc: DidDocument = {
      '@context': DID_CONTEXT,
      'id': did,
      'controller': controller,
      'verificationMethod': verificationMethods,
      'authentication': [`${did}#key-1`],
      'assertionMethod': [`${did}#key-1`],
      'service': services,
    }

    return doc
  }

  /**
   * Build an error resolution result.
   */
  private errorResult(error: string, errorMessage: string): DidResolutionResult {
    return {
      '@context': 'https://w3id.org/did-resolution/v1',
      didDocument: null,
      didResolutionMetadata: { error, errorMessage },
      didDocumentMetadata: {},
    }
  }

  /**
   * Get or create a cached Solana connection.
   */
  private getConnection(rpcUrl: string): Connection {
    let conn = this.connectionCache.get(rpcUrl)
    if (!conn) {
      conn = new Connection(rpcUrl, 'confirmed')
      this.connectionCache.set(rpcUrl, conn)
    }
    return conn
  }
}
