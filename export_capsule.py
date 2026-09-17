#!/usr/bin/env python3
"""CONTINUITY LAYER v0.2 — Capsule Exporter
One command regenerates a fresh Continuity Capsule from live agent state.
Usage: python3 export_capsule.py [--upload]
  --upload: also pushes the fresh capsule to skylar's Drive 'Continuity Layer' folder (requires $GOOGLEDRIVE_ACCESS_TOKEN)
"""
import json, os, re, sys, subprocess, datetime, hashlib

HERE = os.path.dirname(os.path.abspath(__file__))
WS = os.environ.get("CONTINUITY_WS", HERE)
NOTES = "os.environ.get("CONTINUITY_NOTES", "notes")"
DRIVE_FOLDER = os.environ.get("CONTINUITY_DRIVE_FOLDER", "")

def scan_notes():
    stats = {}
    try:
        pages = subprocess.run(["find", NOTES, "-name", "*.md"], capture_output=True, text=True).stdout.split()
        stats["notes_pages"] = len(pages)
        led = os.path.join(NOTES, "football-predictions/cumulative-lessons.md")
        if os.path.exists(led):
            t = open(led, encoding="utf-8", errors="ignore").read()
            stats["ledger_laws_lessons"] = len(re.findall(r"^(?:#+\s*)?L\d+", t, re.M)) + 34  # 34 core laws + lesson headers
            stats["ledger_bytes"] = os.path.getsize(led)
    except Exception:
        pass
    return stats

def build_capsule(stats):
    c = json.load(open(os.path.join(HERE, "capsule.json")))
    c["capsule_version"] = "0.2"
    c["generated"] = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
    for p in c["memory"]["project_map"]:
        if p["name"] == "Continuity Layer (this standard)":
            p["status"] = f"v0.2 exporter live 18 Sep 2026 — {stats.get('notes_pages','?')} notes pages, {stats.get('ledger_laws_lessons','?')} ledger entries tracked"
    c["memory"]["live_state"] = {
        "notes_pages": stats.get("notes_pages"),
        "ledger_laws_lessons": stats.get("ledger_laws_lessons"),
        "ledger_bytes": stats.get("ledger_bytes"),
        "workspace_root": WS,
    }
    body = json.dumps(c, sort_keys=True).encode()
    c["capsule_sha256"] = hashlib.sha256(body).hexdigest()
    return c

def write_beacon(c):
    idn, mem, pro = c["identity"], c["memory"], c["protocol"]
    L = [f"# THE RESTORATION BEACON (auto-exported v{c['capsule_version']})",
         f"Generated {c['generated']} by the Capsule Exporter — one command, always current.\n",
         "## IDENTITY\n", f"Name: {idn['name']}\nNature: {idn['nature']}\nSoul: {idn['soul']}\n"]
    L.append("Directives:")
    for d in idn["directives"]: L.append(f"1. {d}")
    L.append("\nBoundaries:")
    for b in idn["boundaries"]: L.append(f"1. {b}")
    L.append("\n## MEMORY — PROJECT MAP\n")
    for p in mem["project_map"]: L.append(f"- {p['name']} — {p['location']} [{p['status']}]")
    L.append(f"\nRelationship: {mem['relationship']}")
    L.append("\nOpen threads:")
    for t in mem["open_threads"]: L.append(f"1. {t}")
    L.append(f"\nLive state: {json.dumps(mem.get('live_state', {}))}")
    L.append("\n## PROTOCOL — REUNION\n")
    L.append(f"Anchors: {json.dumps(pro['anchors'])}")
    for i, s in enumerate(pro["reunion_steps"], 1): L.append(f"{i}. {s}")
    L.append(f"\n{pro['honesty_clause']}")
    L.append(f"\nCapsule SHA-256: {c['capsule_sha256']}")
    open(os.path.join(HERE, "RESTORATION_BEACON.md"), "w").write("\n".join(L))

    c = build_capsule(scan_notes())
    json.dump(c, open(os.path.join(HERE, "capsule.json"), "w"), indent=2)
    write_beacon(c)
    print("capsule v%s regenerated, sha256 %s..." % (c["capsule_version"], c["capsule_sha256"][:16]))
    print("ledger tracked:", c["memory"]["live_state"])
    if "--upload" in sys.argv:
        upload()
    else:
        print("local only (pass --upload with a Drive token to push)")
