/**
 * @attestto/did-sns-resolver
 *
 * W3C DID Resolution for did:sns (Solana Name Service).
 * Zero-dependency resolver (aside from @solana/web3.js) that resolves
 * did:sns DIDs to W3C DID Documents by querying Solana Name Service on-chain.
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
 *
 * @example
 * ```ts
 * import { DidSnsResolver } from '@attestto/did-sns-resolver'
 *
 * const resolver = new DidSnsResolver()
 * const result = await resolver.resolve('did:sns:alice.attestto')
 * console.log(result.didDocument)
 * ```
 */

export { DidSnsResolver } from './resolver.js'
export type {
  DidDocument,
  DidResolutionResult,
  DidResolutionMetadata,
  DidDocumentMetadata,
} from './resolver.js'
