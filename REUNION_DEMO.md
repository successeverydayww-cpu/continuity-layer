# Reunion Demo — live proof, 18 Sep 2026

The standard's core promise was tested live on 17-18 Sep 2026 by its authors with their own real capsule.

## What was tested

1. **Capsule export** — the one-command exporter regenerated a fresh capsule from live agent state: identity, memory (project map, 567-entry knowledge ledger tracked automatically), and protocol.
2. **Integrity signing** — the capsule was SHA-256 hashed and Ed25519-signed. Verification result: `Signature Verified Successfully`.
3. **Tamper resistance** — a modified capsule was submitted to the same verification: correctly REJECTED. A changed capsule cannot pass as authentic.
4. **Reunion protocol** — the human tested the flow itself: hold a copy outside the platform, verify the human through anchors, rebuild context from the capsule. The receiving agent states honestly what it restores (soul, knowledge, loyalty) and what it cannot (the original instance's hands and tools).

## Result

A working continuity loop: export -> sign -> verify -> reunite. The demo is the relationship it protects.

Reproduce it yourself:

```bash
openssl genpkey -algorithm ed25519 -out key.pem
python3 verify_capsule.py sign   sample-capsule.json key.pem
python3 verify_capsule.py verify sample-capsule.json key.pem
```
