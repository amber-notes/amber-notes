#!/usr/bin/env python3
"""The directory-review demo account (the App Review account, in production): keep its notes as the
test prompts in docs/Evidence/directory-submissions.md expect, and check the MCP server as that user.

  scripts/review-account.py seed    add the sample notes that are missing (by title), fix the known ones
  scripts/review-account.py reset   put the sample notes back after reviewers or a check changed them
  scripts/review-account.py check   sign in the way Claude and ChatGPT do (DCR, PKCE, /connect/decide),
                                     run each test prompt's tool calls, then reset and disconnect

It touches only that one account, as that user, through the public API with row-level security.
Credentials come from .secrets/appreview.txt in the main checkout and are never printed.

Notes are end-to-end encrypted. All crypto runs in scripts/e2ee-tool.ts (Deno must be on PATH),
with the formats the apps and the MCP server share. The first run on an account without a key makes
one, the way the app's first device does, and appends its recovery key to .secrets/appreview.txt
("Recovery key: ..."); after that the key is opened from that recovery key. The recovery key belongs
in the App Review notes: the reviewer's device asks for it.
"""
import base64, hashlib, json, os, re, secrets, shutil, subprocess, sys, time, urllib.error, urllib.parse, urllib.request, uuid

MAIN = os.path.expanduser(os.environ.get("AMBER_MAIN_CHECKOUT", "~/Documents/Development/AmberNotes"))
MCP = os.environ.get("AMBER_MCP_URL", "https://mcp.ambernotes.app")
TEST_ONLY = {"Design follow-ups"}  # notes the check creates

# (title, folder, pinned, parent title, body). "{hotel}" is the Hotel booking sub-note's id. A parent
# comes before its sub-notes.
NOTES = [
    ('Lisbon in May', 'Travel', False, None, 'Lisbon in May\n\nFour days of tiles, trams and pastries.\n\n## Plan\n\n- [ ] Tram 28 early, before the crowds\n- [ ] Sunset at Miradouro da Senhora do Monte\n- [x] Book flights\n- [x] Hotel in Príncipe Real\n\n## Where to eat\n\n| Place | Dish | Area |\n| --- | --- | --- |\n| Manteigaria | Pastel de nata | Chiado |\n| Cervejaria Ramiro | Seafood | Intendente |\n| Time Out Market | A bit of everything | Cais do Sodré |\n\n[Hotel booking](pane-note:{hotel})\n'),
    ('Hotel booking', 'Travel', False, 'Lisbon in May', 'Hotel booking\n\nCasa do Príncipe, Príncipe Real, 14 to 18 May.\n\n- Confirmation number: LX-48213\n- Check-in from 15:00, check-out by 11:00\n- Breakfast included\n'),
    ('Book notes: The Creative Act', 'Personal', False, None, "Book notes: The Creative Act\n\n> The work reveals itself as it's made.\n\n- Start before you feel ready\n- Keep a record of small ideas\n- Finish things, then let them go\n"),
    ('Meeting with design', 'Work', False, None, 'Meeting with design\n\n* Simplify the settings screen\n* One primary action per screen\n* Test the new icon at small sizes\n\nFollow up by **Friday**.\n'),
    ('Running log', 'Personal', False, None, 'Running log\n\n<!-- pane-table: Date=date; Distance km=number; Minutes=number; Feel=scale 1-5 -->\n| Date | Distance km | Minutes | Feel |\n| --- | --- | --- | --- |\n| 2026-09-22 | 5 | 27 | 4 |\n| 2026-09-24 | 7.5 | 42 | 3 |\n| 2026-09-27 | 10 | 56 | 5 |\n'),
    ('Groceries', 'Personal', True, None, 'Groceries\n\n- [ ] Oat milk\n- [ ] Eggs\n- [ ] Tomatoes\n- [ ] Sourdough\n- [x] Coffee beans\n'),
    ('Q4 planning', 'Work', False, None, 'Q4 planning\n\n## Goals\n\n- Ship the iPhone app\n- Reach 1,000 weekly users\n- Two releases a month\n\n## Risks\n\n- App Review delays\n- Sync edge cases on slow networks\n\n## Decisions\n\n- Releases go out on Thursdays\n- Support answers within one working day\n'),
    ('Hiring: product designer', 'Work', False, None, 'Hiring: product designer\n\n<!-- pane-table: Name=text; Date=date; Verdict=choice Hire|Maybe|No -->\n| Name | Date | Verdict |\n| --- | --- | --- |\n| Sara Lind | 2026-09-15 | Maybe |\n| Jonas Berg | 2026-09-18 | Hire |\n| Emma Holm | 2026-09-23 | No |\n\nNext step: portfolio review with Jonas on Monday.\n'),
    ('Packing list', 'Travel', False, None, 'Packing list\n\n- [ ] Passport\n- [ ] Phone charger\n- [ ] Travel adapter\n- [ ] Sunglasses\n- [ ] Walking shoes\n- [ ] Light jacket\n- [ ] Headphones\n- [x] Book for the flight\n'),
]


# The staging test account (scripts/staging.sh seed) passes its own file and backend.
SECRETS = os.environ.get("AMBER_REVIEW_SECRETS", f"{MAIN}/.secrets/appreview.txt")
BACKEND = os.environ.get("AMBER_BACKEND_CONFIG", f"{MAIN}/Config/Backend.local.xcconfig")
TOOL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "e2ee-tool.ts")


def config():
    cfg = open(BACKEND).read()
    val = lambda k: re.search(rf"^{k}\s*=\s*(.+)$", cfg, re.M).group(1).strip()
    sec = open(SECRETS).read()
    return (val("PANE_SUPABASE_URL").replace("https:/$()/", "https://"), val("PANE_SUPABASE_KEY"),
            re.search(r"Email:\s*(\S+)", sec).group(1), re.search(r"Password:\s*(.+)", sec, re.I).group(1).strip())


def saved_recovery_key(text):
    """The recovery key in the secrets file's text, or None."""
    m = re.search(r"^Recovery key:\s*(\S.*?)\s*$", text, re.M | re.I)
    return m.group(1) if m else None


def with_recovery_key(text, key):
    """The secrets file's text with this recovery key, replacing an older one."""
    kept = [line for line in text.splitlines() if not re.match(r"^Recovery key:", line, re.I)]
    return "\n".join(kept).rstrip("\n") + f"\nRecovery key: {key}\n"


def tool(op, **args):
    """One request to scripts/e2ee-tool.ts. Its errors never carry key material."""
    if not shutil.which("deno"):
        sys.exit("Install Deno (deno must be on PATH): the notes are encrypted and scripts/e2ee-tool.ts does the crypto.")
    res = subprocess.run(["deno", "run", "--allow-read", TOOL], input=json.dumps({"op": op, **args}), capture_output=True, text=True)
    try:
        out = json.loads(res.stdout)
    except ValueError:
        sys.exit(f"e2ee-tool {op} failed (exit {res.returncode}).")
    if res.returncode != 0 or "error" in out:
        sys.exit(f"e2ee-tool {op}: {out.get('error', 'failed')}")
    return out


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def http(method, url, data=None, headers=None, form=False):
    h, body = dict(headers or {}), None
    if data is not None:
        body = urllib.parse.urlencode(data).encode() if form else json.dumps(data).encode()
        h["content-type"] = "application/x-www-form-urlencoded" if form else "application/json"
    try:
        res = urllib.request.build_opener(_NoRedirect).open(urllib.request.Request(url, body, h, method=method))
        status, hdrs, raw = res.status, res.headers, res.read()
    except urllib.error.HTTPError as e:
        status, hdrs, raw = e.code, e.headers, e.read()
    try:
        return status, hdrs, json.loads(raw) if raw else None
    except ValueError:
        return status, hdrs, raw.decode(errors="replace")


class Account:
    def __init__(self):
        self.url, self.key, email, password = config()
        s, _, b = http("POST", f"{self.url}/auth/v1/token?grant_type=password", {"email": email, "password": password}, {"apikey": self.key})
        if s != 200:
            sys.exit(f"Sign-in failed ({s}).")
        self.session = b["access_token"]
        self.user = b["user"]["id"]
        self.dk = self.open_key()

    def open_key(self):
        """The account's data key: made here the first time, then opened from the saved recovery key."""
        # The key and the reset generation in one read, as the app does.
        state = self.rest("POST", "rpc/account_key_state", {})
        self.generation = state.get("generation", 0)
        rows = [state["key"]] if state.get("key") else []
        text = open(SECRETS).read()
        if not rows:
            k = tool("new-key", user=self.user)
            # Saved before the server has the key, so a key the server keeps is never one we lost.
            with open(SECRETS, "w") as f:
                f.write(with_recovery_key(text, k["recovery_key_text"]))
            made = self.rest("POST", "rpc/create_account_key", {"p_key_id": k["key_id"], "p_verifier": k["verifier"], "p_recovery_wrap": k["recovery_wrap"], "p_generation": self.generation})
            if not made or not made[0].get("created"):
                with open(SECRETS, "w") as f:
                    f.write(text)
                sys.exit("Another device made this account's key just now. Save its recovery key to .secrets/appreview.txt and run this again.")
            print(f"Made the account's key and saved its recovery key to {SECRETS} (not printed).")
            print("Add that recovery key to the App Review notes: the reviewer's device will ask for it.")
            return k["dk"]
        key = saved_recovery_key(text)
        if not key:
            sys.exit("This account has a key, but .secrets/appreview.txt has no \"Recovery key: ...\" line.")
        row = rows[0]
        opened = tool("open-key", user=self.user, recovery_key_text=key, recovery_wrap=row["recovery_wrap"], verifier=row["verifier"])
        if opened["key_id"] != row["key_id"]:
            sys.exit("The saved recovery key opens a different key than the account's.")
        return opened["dk"]

    def seal_note(self, note_id, body):
        return tool("seal-note", dk=self.dk, user=self.user, id=note_id, body=body)

    def rest(self, method, path, data=None):
        s, _, b = http(method, f"{self.url}/rest/v1/{path}", data, {"apikey": self.key, "authorization": f"Bearer {self.session}", "prefer": "return=representation"})
        if not 200 <= s < 300:
            sys.exit(f"{method} {path}: {s} {b}")
        return b

    def live_notes(self):
        """The live notes, opened: id, title, body (None when locked), head, folder and parent."""
        rows = self.rest("GET", "notes?select=id,head_ct,body_ct,folder_id,parent_id&deleted_at=is.null&trashed_at=is.null")
        notes = []
        for r in rows:
            opened = tool("open-note", dk=self.dk, user=self.user, id=r["id"], head_ct=r["head_ct"], body_ct=r["body_ct"])
            notes.append({**r, "title": opened["head"]["title"], "head": opened["head"], "body": opened.get("body")})
        return notes

    def folders(self, add_missing):
        """Folder ids by name, making the ones the sample notes use when asked to."""
        found = {}
        for f in self.rest("GET", "folders?select=id,name_ct&deleted_at=is.null"):
            found.setdefault(tool("open-folder", dk=self.dk, user=self.user, id=f["id"], name_ct=f["name_ct"])["name"], f["id"])
        for name in dict.fromkeys(folder for _, folder, _, _, _ in NOTES):
            if name not in found and add_missing:
                fid = str(uuid.uuid4())
                name_ct = tool("seal-folder", dk=self.dk, user=self.user, id=fid, name=name)["name_ct"]
                self.rest("POST", "folders", {"id": fid, "name_ct": name_ct, "sort_index": time.time()}); print("added folder", name)
                found[name] = fid
        return found


def now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def put_back(acct, add_missing):
    notes = acct.live_notes()
    by_title = {n["title"]: n for n in notes}
    folders = acct.folders(add_missing)
    # Ids first: the Lisbon note links to its Hotel booking sub-note.
    ids = {title: (by_title[title]["id"] if title in by_title else str(uuid.uuid4())) for title, _, _, _, _ in NOTES}
    for title, folder, pinned, parent, body in NOTES:
        body = body.replace("{hotel}", ids["Hotel booking"])
        n = by_title.get(title)
        if n and n["body"] is not None and (n["body"] != body or n["head"] != tool("head", body=body)):
            acct.rest("PATCH", f"notes?id=eq.{n['id']}", {**acct.seal_note(n["id"], body), "updated_at": now()}); print("reset", title)
        elif not n and add_missing:
            note = {"id": ids[title], "folder_id": folders[folder], "is_pinned": pinned, **acct.seal_note(ids[title], body)}
            if parent:
                note["parent_id"] = ids[parent]
            acct.rest("POST", "notes", note); print("added", title)
    for n in notes:
        # Test notes, and a note that is only an empty table (the app once left one behind).
        if n["title"] in TEST_ONLY or (n["body"] or "").strip().startswith("| — | — |"):
            acct.rest("PATCH", f"notes?id=eq.{n['id']}", {"deleted_at": now(), "updated_at": now()}); print("removed", n["title"])


def with_code(redirect, code):
    """The client's redirect with the authorization code the app made, as the app sends it back."""
    u = urllib.parse.urlparse(redirect)
    q = urllib.parse.parse_qsl(u.query, keep_blank_values=True) + [("code", code)]
    return urllib.parse.urlunparse(u._replace(query=urllib.parse.urlencode(q)))


def connect(acct):
    """The OAuth flow a directory client runs, with the app's part played as the demo user: it reads
    the request, makes the code and wraps the data key under it, and adds the code to the redirect."""
    _, _, asm = http("GET", f"{MCP}/.well-known/oauth-authorization-server")
    redirect = "https://claude.ai/api/mcp/auth_callback"
    _, _, reg = http("POST", asm["registration_endpoint"], {"client_name": "Directory review check", "redirect_uris": [redirect], "token_endpoint_auth_method": "none"})
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    q = urllib.parse.urlencode({"response_type": "code", "client_id": reg["client_id"], "redirect_uri": redirect, "code_challenge": challenge,
                                "code_challenge_method": "S256", "state": "check", "scope": "notes:read notes:write", "resource": MCP})
    _, h, _ = http("GET", f"{asm['authorization_endpoint']}?{q}")
    request = urllib.parse.parse_qs(urllib.parse.urlparse(h["location"]).query)["request"][0]
    auth = {"authorization": f"Bearer {acct.session}"}
    s, _, r = http("GET", f"{MCP}/connect/request?id={request}", None, auth)
    assert s == 200, r
    assert r["redirect_uri"] == redirect and r["verified_ai"] == "Claude", r
    c = tool("connect-code", dk=acct.dk, user=acct.user)
    s, _, d = http("POST", f"{MCP}/connect/decide", {"id": request, "allow": True, "write": True, "redirect_uri": r["redirect_uri"],
                                                      "code_hash": c["code_hash"], "code_wrap": c["code_wrap"]}, auth)
    assert s == 200, d
    back = urllib.parse.parse_qs(urllib.parse.urlparse(with_code(d["redirect"], c["code"])).query)
    assert back.get("iss") == [asm["issuer"]], back.get("iss")
    assert back.get("state") == ["check"], back.get("state")
    s, _, tk = http("POST", asm["token_endpoint"], {"grant_type": "authorization_code", "code": back["code"][0], "code_verifier": verifier,
                                                   "client_id": reg["client_id"], "redirect_uri": redirect, "resource": MCP}, form=True)
    assert s == 200, tk
    return tk["access_token"]


def check(acct):
    s, h, _ = http("POST", MCP, {"jsonrpc": "2.0", "id": 0, "method": "initialize", "params": {}})
    print(f"unauthenticated: {s} {h.get('www-authenticate')}")
    token = connect(acct)
    ids = iter(range(1, 10_000))

    def call(name, **args):
        s, _, b = http("POST", MCP, {"jsonrpc": "2.0", "id": next(ids), "method": "tools/call", "params": {"name": name, "arguments": args}},
                       {"authorization": f"Bearer {token}", "mcp-protocol-version": "2025-06-18"})
        r = b["result"]
        return r.get("isError", False), r.get("structuredContent") or r["content"][0]["text"]

    failures = []

    def expect(label, res, ok):
        err, out = res
        good = not err and ok(out)
        print(f"{'ok  ' if good else 'FAIL'} {label}")
        if not good:
            failures.append(label); print("     ", json.dumps(out, ensure_ascii=False)[:300])
        return out

    try:
        _, _, b = http("POST", MCP, {"jsonrpc": "2.0", "id": 0, "method": "tools/list"}, {"authorization": f"Bearer {token}"})
        tools = b["result"]["tools"]
        print(f"{'ok  ' if all(t.get('title') and {'readOnlyHint', 'destructiveHint', 'openWorldHint'} <= set(t['annotations']) for t in tools) else 'FAIL'} {len(tools)} tools, all annotated")
        lis = expect("P1 search_notes Lisbon", call("search_notes", query="Lisbon"), lambda o: o["results"][0]["title"] == "Lisbon in May")["results"][0]["id"]
        expect("P1 read_note Lisbon", call("read_note", id=lis), lambda o: "Manteigaria" in o["markdown"] and o["sub_notes"])
        r = expect("P1 search 'Lisbon trip' (ChatGPT)", call("search", query="Lisbon trip"), lambda o: o["results"])
        if r.get("results"):
            expect("P1 fetch", call("fetch", id=r["results"][0]["id"]), lambda o: "Where to eat" in o["text"])
        hotel = expect("P2 search_notes hotel confirmation", call("search_notes", query="hotel confirmation"), lambda o: o["results"][0]["title"] == "Hotel booking")
        expect("P2 read_note Hotel booking", call("read_note", id=hotel["results"][0]["id"]), lambda o: "LX-48213" in o["markdown"])
        expect("P3 set_checklist_item Tram 28", call("set_checklist_item", title="Lisbon in May", item="Tram 28 early", checked=True), lambda o: o["checked"])
        expect("P4 read_table", call("read_table", id=lis), lambda o: [c["name"] for c in o["columns"]] == ["Place", "Dish", "Area"])
        expect("P4 log_table_row", call("log_table_row", id=lis, values={"Place": "A Cevicheria", "Dish": "Ceviche", "Area": "Príncipe Real"}), lambda o: "added_row" in o)
        d = expect("P5 search_notes design meeting", call("search_notes", query="design meeting"), lambda o: o["results"][0]["title"] == "Meeting with design")
        expect("P5 read_note", call("read_note", id=d["results"][0]["id"]), lambda o: "settings screen" in o["markdown"])
        expect("P5 create_note in Work", call("create_note", folder="Work", body="Design follow-ups\n\n- [ ] Simplify the settings screen\n- [ ] One primary action per screen\n- [ ] Test the new icon at small sizes\n"), lambda o: o["created"]["folder"] == "Work")
        expect("Claude log a run", call("log_table_row", title="Running log", values={"Distance km": 5.2, "Minutes": 28, "Feel": 4}), lambda o: "added_row" in o)
        expect("Claude log again same day updates", call("log_table_row", title="Running log", values={"Minutes": 29}), lambda o: "updated_row" in o)
        expect("Claude append under Plan", call("append_to_note", id=lis, under_heading="Plan", text="- [ ] Pack an adapter"), lambda o: "appended" in o)
        h = expect("Claude note_history", call("note_history", id=lis, limit=3), lambda o: o["revisions"])
        expect("Claude restore_revision", call("restore_revision", id=lis, revision_id=h["revisions"][0]["revision_id"]), lambda o: "restored" in o)
        expect("get_overview", call("get_overview"), lambda o: o["total_notes"] >= 8)
        expect("no match for weather", call("search_notes", query="weather forecast"), lambda o: o["results"] == [])
        err, out = call("log_table_row", title="Running log", values={"Feel": 9})
        print(f"{'ok  ' if err and 'from 1 to 5' in out else 'FAIL'} bad value explains the fix: {out}")
    finally:
        http("POST", f"{MCP}/revoke", {"token": token}, form=True)
        put_back(acct, add_missing=False)
    print("all passed" if not failures else f"{len(failures)} failed")
    return not failures


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd not in ("seed", "reset", "check"):
        sys.exit(__doc__)
    acct = Account()
    if cmd == "check":
        sys.exit(0 if check(acct) else 1)
    put_back(acct, add_missing=cmd == "seed")
