#!/usr/bin/env python3
"""HAT v2 Radar Watcher — runs every 10 minutes during active runs.

Checks for stuck/active HAT v2 issues and pokes Radar to investigate.
Designed to run via launchd/cron on the mac mini (ops gateway host).
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta
from pathlib import Path

API_URL = "http://127.0.0.1:3100/api"
KEY_PATH = os.path.expanduser("~/.openclaw/workspace/paperclip-claimed-api-key.json")
COMPANY_ID = "8b2d40ce-d5a7-404c-bea8-7ae41a071502"
PROJECT_ID = "c024edfb-295d-490c-b55d-ba41d680ef50"
STATE_FILE = os.path.expanduser("~/.openclaw/workspace-radar/state/hat-v2-watcher.json")

# Radar's session key on ops gateway
RADAR_SESSION = "agent:radar:paperclip:radar"

# Conduit relay for cross-gateway messaging
CONDUIT_RELAY = os.path.expanduser("~/.openclaw/workspace/scripts/conduit_relay.py")

with open(KEY_PATH) as f:
    TOKEN = json.load(f).get("token", "")


def api_get(path):
    req = urllib.request.Request(f"{API_URL}{path}")
    req.add_header("Authorization", f"Bearer {TOKEN}")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())
    except Exception as e:
        print(f"API error: {e}", file=sys.stderr)
        return None


def load_state():
    try:
        with open(STATE_FILE) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"lastCheck": None, "lastPoke": None, "stuckIssues": []}


def save_state(state):
    Path(STATE_FILE).parent.mkdir(parents=True, exist_ok=True)
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)


def wake_radar(message):
    """Wake Radar via conduit relay (cross-gateway safe)."""
    import subprocess
    try:
        result = subprocess.run(
            ["python3", CONDUIT_RELAY, "radar", message,
             "--topic", "hat-v2-watcher", "--caller", "hat-v2-cron"],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode == 0:
            print(f"Woke Radar: {message[:80]}...")
            return True
        else:
            print(f"Failed to wake Radar: {result.stderr[:200]}", file=sys.stderr)
            return False
    except Exception as e:
        print(f"Wake error: {e}", file=sys.stderr)
        return False


def api_patch(path, body):
    """PATCH an API endpoint."""
    data = json.dumps(body).encode()
    req = urllib.request.Request(f"{API_URL}{path}", data=data, method="PATCH")
    req.add_header("Authorization", f"Bearer {TOKEN}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())
    except Exception as e:
        print(f"API PATCH error: {e}", file=sys.stderr)
        return None


def api_post(path, body):
    """POST to an API endpoint."""
    data = json.dumps(body).encode()
    req = urllib.request.Request(f"{API_URL}{path}", data=data, method="POST")
    req.add_header("Authorization", f"Bearer {TOKEN}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())
    except Exception as e:
        print(f"API POST error: {e}", file=sys.stderr)
        return None


import re


def parse_deps(description):
    """Parse 'Depends on: HOL-123, HOL-456' from issue description."""
    if not description:
        return []
    m = re.findall(r'Depends on:\s*([^\n]+)', description)
    if not m:
        return []
    # Extract HOL-NNNN identifiers, strip dep type annotations like (hard)/(soft)
    return re.findall(r'HOL-\d+', m[0])


def auto_promote_backlog(issues):
    """Find backlog issues whose deps are all done/cancelled and promote them to todo.
    Returns list of promoted issue identifiers."""
    # Build status lookup by identifier
    status_by_id = {i["identifier"]: i["status"] for i in issues}
    id_by_identifier = {i["identifier"]: i["id"] for i in issues}
    terminal = {"done", "cancelled"}
    promoted = []

    backlog = [i for i in issues if i["status"] == "backlog"]
    for issue in backlog:
        deps = parse_deps(issue.get("description", ""))
        if not deps:
            # No deps — don't auto-promote (intentionally parked per AGENTS.md)
            continue
        # Check if ALL deps are terminal
        all_met = True
        for dep in deps:
            dep_status = status_by_id.get(dep)
            if dep_status is None:
                # Dep is in another project or doesn't exist — skip this issue
                all_met = False
                break
            if dep_status not in terminal:
                all_met = False
                break
        if all_met:
            # Promote!
            issue_id = issue["id"]
            identifier = issue["identifier"]
            print(f"AUTO-PROMOTE: {identifier} — all deps met ({', '.join(deps)})")
            result = api_patch(
                f"/issues/{issue_id}",
                {"status": "todo"}
            )
            if result and result.get("status") == "todo":
                # Add audit comment
                api_post(
                    f"/issues/{issue_id}/comments",
                    {"body": f"Auto-promoted by HAT v2 watcher — all deps met: {', '.join(deps)}"}
                )
                promoted.append(identifier)
                status_by_id[identifier] = "todo"  # Update for cascading within this run
            else:
                print(f"  Failed to promote {identifier}", file=sys.stderr)

    return promoted


def main():
    now = datetime.now(timezone.utc)
    state = load_state()

    # Get all HAT v2 issues (including backlog for promotion checks)
    issues = api_get(f"/companies/{COMPANY_ID}/issues?projectId={PROJECT_ID}&limit=50")
    if not issues:
        print("Could not fetch issues, skipping.")
        state["lastCheck"] = now.isoformat()
        save_state(state)
        return

    # --- Auto-promote backlog issues whose deps are met ---
    promoted = auto_promote_backlog(issues)
    if promoted:
        print(f"Promoted {len(promoted)} issue(s): {', '.join(promoted)}")
        # Re-fetch to get updated statuses
        issues = api_get(f"/companies/{COMPANY_ID}/issues?projectId={PROJECT_ID}&limit=50") or issues

    active = [i for i in issues if i["status"] in ("todo", "in_progress", "blocked")]
    in_progress = [i for i in active if i["status"] == "in_progress"]
    blocked = [i for i in active if i["status"] == "blocked"]
    todo = [i for i in active if i["status"] == "todo"]

    state["lastCheck"] = now.isoformat()

    if not active:
        print("No active HAT v2 issues. Sleeping.")
        state["stuckIssues"] = []
        save_state(state)
        return

    print(f"Active: {len(active)} (in_progress={len(in_progress)}, todo={len(todo)}, blocked={len(blocked)})")

    # Check for stuck issues: in_progress for >30 minutes without recent comments
    stuck = []
    for i in in_progress:
        started = i.get("startedAt") or i.get("updatedAt")
        if started:
            try:
                started_dt = datetime.fromisoformat(started.replace("Z", "+00:00"))
                age_min = (now - started_dt).total_seconds() / 60
                if age_min > 30:
                    stuck.append({
                        "identifier": i["identifier"],
                        "title": i["title"][:60],
                        "ageMinutes": round(age_min),
                        "id": i["id"],
                    })
            except Exception:
                pass

    # Check for blocked issues
    blocked_info = []
    for i in blocked:
        blocked_info.append({
            "identifier": i["identifier"],
            "title": i["title"][:60],
            "id": i["id"],
        })

    # Decide whether to poke Radar
    should_poke = False
    poke_reason = []

    if stuck:
        should_poke = True
        poke_reason.append(f"{len(stuck)} stuck issue(s): " + ", ".join(s["identifier"] for s in stuck))

    if blocked_info:
        should_poke = True
        poke_reason.append(f"{len(blocked_info)} blocked issue(s): " + ", ".join(b["identifier"] for b in blocked_info))

    # Also poke every 30 min as a general status check if there are active issues
    last_poke = state.get("lastPoke")
    if last_poke:
        try:
            last_poke_dt = datetime.fromisoformat(last_poke)
            minutes_since = (now - last_poke_dt).total_seconds() / 60
            if minutes_since >= 30 and in_progress:
                should_poke = True
                poke_reason.append(f"30-min status check ({len(in_progress)} in-progress)")
        except Exception:
            pass
    elif in_progress:
        should_poke = True
        poke_reason.append("First check with active issues")

    if should_poke:
        reason_str = "; ".join(poke_reason)
        summary_parts = []
        if in_progress:
            summary_parts.append(f"In progress: {', '.join(i['identifier'] for i in in_progress)}")
        if todo:
            summary_parts.append(f"Queued: {', '.join(i['identifier'] for i in todo)}")
        if blocked_info:
            summary_parts.append(f"BLOCKED: {', '.join(b['identifier'] for b in blocked_info)}")
        if stuck:
            stuck_strs = [s['identifier'] + ' (' + str(s['ageMinutes']) + 'min)' for s in stuck]
            summary_parts.append('STUCK (>30min): ' + ', '.join(stuck_strs))

        message = (
            f"HAT v2 watcher check — {reason_str}\n\n"
            f"{chr(10).join(summary_parts)}\n\n"
            f"Check on stuck/blocked issues. If an agent is genuinely stuck, "
            f"add a comment to unstick it or escalate. "
            f"Project: {PROJECT_ID}"
        )

        if wake_radar(message):
            state["lastPoke"] = now.isoformat()
            state["stuckIssues"] = [s["identifier"] for s in stuck]
        else:
            print("Failed to wake Radar, will retry next cycle.")
    else:
        print("No action needed this cycle.")

    save_state(state)


if __name__ == "__main__":
    main()
