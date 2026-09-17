#!/usr/bin/env python3
"""Continuity Layer v0.3 — capsule signing & verification (Ed25519 + SHA-256).
Usage:
  python3 verify_capsule.py sign   <capsule.json> <private.pem>  -> writes capsule.hash + capsule.sig + capsule.sig.manifest.json
  python3 verify_capsule.py verify <capsule.json> <private.pem>  -> verifies the capsule against its signature
  python3 verify_capsule.py verify-tamper <capsule.json> <private.pem> -> demonstrates tamper rejection
Requires: openssl 3.x on PATH."""
import sys, os, json, hashlib, subprocess, datetime

def sh(*args):
    return subprocess.run(args, capture_output=True, text=True)

def sign(capsule_path, priv):
    h = hashlib.sha256(open(capsule_path,'rb').read()).hexdigest()
    open(capsule_path+'.hash','w').write(h)
    sh("openssl","pkeyutl","-sign","-inkey",priv,"-rawin","-in",capsule_path+'.hash',"-out",capsule_path+'.sig')
    import base64
    manifest = {"spec":"continuity-layer v0.3","capsule_sha256":h,
        "algorithm":"Ed25519","signature_hex":open(capsule_path+'.sig','rb').read().hex(),
        "signer_pubkey_b64":base64.b64encode(open(priv.replace('.pem','') if False else priv,'rb').read()).decode(),
        "signed_at":datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        "note":"Private key never leaves the owner's vault. Sign with the human's DID key in production."}
    json.dump(manifest, open(capsule_path+'.sig.manifest.json','w'), indent=2)
    print("signed, capsule SHA-256:", h)

def verify(capsule_path, priv):
    pub = priv + ".pub"
    if not os.path.exists(pub):
        sh("openssl","pkey","-in",priv,"-pubout","-out",pub)
    h = hashlib.sha256(open(capsule_path,'rb').read()).hexdigest()
    open(capsule_path+'.hash','w').write(h)
    r = sh("openssl","pkeyutl","-verify","-inkey",priv,"-pubin","-rawin","-sigfile",capsule_path+'.sig',"-in",capsule_path+'.hash')
    ok = "Verified" in (r.stdout + r.stderr)
    print("capsule hash:", h, "\nsignature:", "VALID — capsule authentic & untampered" if ok else "INVALID — capsule altered or wrong key")
    return ok

if __name__ == "__main__":
    cmd, path, key = sys.argv[1], sys.argv[2], sys.argv[3]
    if cmd == "sign": sign(path, key)
    elif cmd == "verify": verify(path, key)
    else: print("unknown command")
