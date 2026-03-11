# @attestto/did-sns-resolver

W3C DID Resolution for `did:sns` (Solana Name Service).

Resolves `did:sns` Decentralized Identifiers to W3C DID Documents by querying Solana Name Service on-chain. Includes a DIF Universal Resolver driver.

## Install

```bash
npm install @attestto/did-sns-resolver
```

## Usage

```ts
import { DidSnsResolver } from '@attestto/did-sns-resolver'

const resolver = new DidSnsResolver()
const result = await resolver.resolve('did:sns:alice.attestto')

console.log(result.didDocument)
// {
//   "@context": ["https://www.w3.org/ns/did/v1", ...],
//   "id": "did:sns:alice.attestto",
//   "verificationMethod": [{ id: "did:sns:alice.attestto#key-1", type: "Ed25519VerificationKey2020", ... }],
//   ...
// }
```

### Custom RPC

```ts
const resolver = new DidSnsResolver({
  rpcUrl: 'https://my-rpc.example.com'
})
```

### DID Formats

| Format | Example | Network |
|---|---|---|
| Root domain | `did:sns:attestto` | mainnet |
| Subdomain | `did:sns:alice.attestto` | mainnet |
| With network | `did:sns:devnet:alice.attestto` | devnet |

## Universal Resolver Driver

### Docker

```bash
docker build -t attestto/uni-resolver-driver-did-sns .
docker run -p 8080:8080 attestto/uni-resolver-driver-did-sns
```

### Resolve

```bash
curl http://localhost:8080/1.0/identifiers/did:sns:bonfida
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `SOLANA_RPC_URL` | mainnet public | Solana RPC endpoint |
| `PORT` | `8080` | HTTP port |
| `LOG_LEVEL` | `info` | `debug\|info\|warn\|error` |

## Specification

- [did:sns Method Specification](https://spec.attestto.com)
- [W3C DID Core v1.1](https://www.w3.org/TR/did-core/)

## License

Apache-2.0
