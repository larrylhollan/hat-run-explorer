#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from typing import Optional

import requests

sys.path.insert(0, "/Users/larry/hat-workspace")
from coordinator import rebuild_dep_graph_from_children  # type: ignore

API_URL = os.environ.get("PAPERCLIP_API_URL", "http://127.0.0.1:3100").rstrip("/")
API_KEY = os.environ.get("PAPERCLIP_API_KEY", "")
COMPANY_ID = os.environ.get("PAPERCLIP_COMPANY_ID", "8b2d40ce-d5a7-404c-bea8-7ae41a071502")
STATE_PATH = os.environ.get(
    "HAT_WATCHER_STATE",
    "/Users/larry/.openclaw/workspace-radar/state/hat-fair-watcher-state.json",
)
POLL_SEC = int(os.environ.get("HAT_WATCHER_POLL_SEC", "180"))
STALE_SEC = int(os.environ.get("HAT_WATCHER_STALE_SEC", "1200"))
MAX_RESETS = int(os.environ.get("HAT_WATCHER_MAX_RESETS", "3"))
TERMINAL = {"done", "blocked", "cancelled"}
FAILURE = {"blocked", "cancelled"}
RETRYABLE_TOKENS = [
    "ssh", "jit", "token", "credential", "unknown error", "instant failure",
    "0s", "queued forever", "rate limit", "429", "timeout", "timed out",
    "connection refused", "connection reset", "temporary", "transient",
    "agent error", "adapter", "session died", "ghost session", "wake",
    "permission denied", "auth", "authorization", "unauthorized",
]
AUTO_CANCEL_RE = re.compile(r"auto-cancelled: prerequisite\(s\).+failed", re.I)


class PC:
    def __init__(self) -> None:
        self.s = requests.Session()
        self.s.headers.update({
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
        })

    def list_children(self, parent_id: str) -> list[dict]:
        r = self.s.get(f"{API_URL}/api/companies/{COMPANY_ID}/issues", params={"parentId": parent_id, "limit": "200"})
        r.raise_for_status()
        return r.json()

    def get_comments(self, issue_id: str) -> list[dict]:
        r = self.s.get(f"{API_URL}/api/issues/{issue_id}/comments")
        r.raise_for_status()
        return r.json()

    def add_comment(self, issue_id: str, body: str) -> None:
        r = self.s.post(f"{API_URL}/api/issues/{issue_id}/comments", json={"body": body})
        r.raise_for_status()

    def update_issue(self, issue_id: str, **fields) -> None:
        r = self.s.patch(f"{API_URL}/api/issues/{issue_id}", json=fields)
        r.raise_for_status()


def load_state() -> dict:
    try:
        with open(STATE_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"resetCounts": {}, "revivedAt": {}, "lastSummary": None}


def save_state(state: dict) -> None:
    os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
    with open(STATE_PATH, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2, sort_keys=True)


def parse_ts(value: Optional[str]) -> Optional[float]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except Exception:
        return None


def last_comment(comments: list[dict]) -> tuple[str, Optional[float]]:
    if not comments:
        return "", None
    c = comments[-1]
    return c.get("body", "") or "", parse_ts(c.get("createdAt"))


def retryable_text(text: str) -> bool:
    low = (text or "").lower()
    return any(tok in low for tok in RETRYABLE_TOKENS)


def stale_issue(issue: dict, comments: list[dict], now_ts: float) -> bool:
    stamps = [parse_ts(issue.get("updatedAt")), parse_ts(issue.get("startedAt")), parse_ts(issue.get("lastActivityAt"))]
    _, last_comment_ts = last_comment(comments)
    if last_comment_ts:
        stamps.append(last_comment_ts)
    stamps = [s for s in stamps if s]
    if not stamps:
        return False
    return now_ts - max(stamps) >= STALE_SEC


def resurrect_dependents(pc: PC, issue_id: str, by_id: dict[str, dict], reverse_deps: dict[str, list[str]], state: dict) -> int:
    revived = 0
    seen = set()
    stack = list(reverse_deps.get(issue_id, []))
    while stack:
        cid = stack.pop()
        if cid in seen:
            continue
        seen.add(cid)
        child = by_id.get(cid)
        if not child:
            continue
        if child.get("status") == "cancelled":
            try:
                pc.update_issue(cid, status="backlog")
                state.setdefault("revivedAt", {})[cid] = int(time.time())
                revived += 1
            except Exception:
                pass
        stack.extend(reverse_deps.get(cid, []))
    return revived


def maybe_reset_issue(pc: PC, issue: dict, reason: str, state: dict, by_id: dict[str, dict], reverse_deps: dict[str, list[str]]) -> bool:
    iid = issue["id"]
    ident = issue.get("identifier", iid)
    resets = int(state.setdefault("resetCounts", {}).get(iid, 0))
    if resets >= MAX_RESETS:
        return False
    note = (
        "## Fairness watcher reset\n\n"
        f"Resetting **{ident}** back to `todo` for another fair attempt.\n\n"
        f"Reason: {reason}\n\n"
        "If this keeps failing without reaching substantive scenario work, treat it as harness/runtime trouble rather than a sample failure."
    )
    try:
        pc.add_comment(iid, note)
    except Exception:
        pass
    pc.update_issue(iid, status="todo")
    state["resetCounts"][iid] = resets + 1
    resurrect_dependents(pc, iid, by_id, reverse_deps, state)
    return True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("parent_id")
    ap.add_argument("--max-runtime", type=int, default=28800)
    args = ap.parse_args()

    if not API_KEY:
        print("PAPERCLIP_API_KEY not set", file=sys.stderr)
        return 1

    pc = PC()
    state = load_state()
    start = time.time()

    while True:
        now_ts = time.time()
        if now_ts - start > args.max_runtime:
            print("watcher timeout")
            save_state(state)
            return 0

        children = pc.list_children(args.parent_id)
        by_id = {c["id"]: c for c in children}
        dep_graph = rebuild_dep_graph_from_children(children)
        reverse_deps: dict[str, list[str]] = {}
        for child_id, deps in dep_graph.items():
            for dep_id, _dep_type in deps:
                reverse_deps.setdefault(dep_id, []).append(child_id)

        counts: dict[str, int] = {}
        for c in children:
            counts[c["status"]] = counts.get(c["status"], 0) + 1
        summary = ", ".join(f"{k}={v}" for k, v in sorted(counts.items()))
        if summary != state.get("lastSummary"):
            print(f"[{datetime.now(timezone.utc).isoformat()}] {summary}", flush=True)
            state["lastSummary"] = summary

        if children and sum(1 for c in children if c["status"] in TERMINAL) == len(children):
            print("all issues terminal", flush=True)
            save_state(state)
            return 0

        for child in children:
            status = child.get("status")
            if status not in {"blocked", "in_progress", "cancelled"}:
                continue
            iid = child["id"]
            comments = pc.get_comments(iid)
            body, _ = last_comment(comments)

            if status == "blocked":
                if retryable_text(body):
                    maybe_reset_issue(pc, child, f"retryable blocked state detected from latest journal: {body[:240]}", state, by_id, reverse_deps)
            elif status == "in_progress":
                if stale_issue(child, comments, now_ts):
                    maybe_reset_issue(pc, child, f"no new activity for >= {STALE_SEC // 60} minutes", state, by_id, reverse_deps)
            elif status == "cancelled":
                if AUTO_CANCEL_RE.search(body):
                    for dep_id, _dep_type in dep_graph.get(iid, []):
                        dep_status = by_id.get(dep_id, {}).get("status")
                        if dep_status not in FAILURE:
                            try:
                                pc.update_issue(iid, status="backlog")
                                state.setdefault("revivedAt", {})[iid] = int(now_ts)
                            except Exception:
                                pass
                            break

        save_state(state)
        time.sleep(POLL_SEC)


if __name__ == "__main__":
    raise SystemExit(main())
