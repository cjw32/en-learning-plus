"""Private blog publisher with reviewed edits and version-bound deletion. Never executes repo code."""
import base64
import datetime as dt
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
from urllib.parse import quote, parse_qs, urlsplit
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DATA = Path(os.environ.get("PUBLISHER_DATA", "/data"))
REPO = DATA / "repository.git"
REMOTE = os.environ.get("BLOG_GIT_REMOTE", "ssh://git@ssh.github.com:443/cjw260/blog-page.git")
BASE = "https://cjw32.xyz/blog"
LOCK = threading.Lock()
SECRET_PATTERN = re.compile(r"-----BEGIN (?:OPENSSH|RSA|EC|PRIVATE).*KEY-----|github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9]{20,}|\bsk-[A-Za-z0-9_-]{20,}")


def digest(value):
    return hashlib.sha256(value).hexdigest()


def validate(payload):
    if not isinstance(payload, dict):
        raise ValueError("Request must be an object")
    allowed = {"message_id", "title", "date", "category", "tags", "summary", "body"}
    if set(payload) != allowed:
        raise ValueError("Expected exactly: " + ", ".join(sorted(allowed)))
    for field, limit in {"message_id": 200, "title": 160, "date": 10, "category": 50, "summary": 500, "body": 100000}.items():
        value = payload[field]
        if not isinstance(value, str) or not value.strip() or len(value) > limit:
            raise ValueError("Invalid " + field)
        if field != "body" and any(ord(c) < 32 for c in value):
            raise ValueError("Control characters in " + field)
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", payload["date"]):
        raise ValueError("Date must be YYYY-MM-DD")
    dt.date.fromisoformat(payload["date"])
    tags = payload["tags"]
    if not isinstance(tags, list) or len(tags) > 12 or any(not isinstance(t, str) or not t.strip() or len(t) > 40 or any(ord(c) < 32 for c in t) for t in tags):
        raise ValueError("Invalid tags")
    if SECRET_PATTERN.search(json.dumps(payload, ensure_ascii=False)):
        raise ValueError("Possible credential found; remove it before publishing")
    if "\x00" in payload["body"]:
        raise ValueError("NUL in body")
    # YAML accepts JSON strings/arrays, so user text cannot inject extra metadata.
    fields = ["---"] + [f"{k}: {json.dumps(payload[k], ensure_ascii=False)}" for k in ("title", "date", "category", "tags", "summary")]
    source = ("\n".join(fields) + "\n---\n\n" + payload["body"].strip() + "\n").encode()
    job_id = "ai-" + digest(payload["message_id"].encode())[:24]
    return job_id, source


def git(*args, input=None, extra_env=None, check=True):
    env = os.environ.copy()
    env.update({"GIT_TERMINAL_PROMPT": "0", "GIT_AUTHOR_NAME": "CJW Blog Bot", "GIT_AUTHOR_EMAIL": "blog-bot@users.noreply.github.com", "GIT_COMMITTER_NAME": "CJW Blog Bot", "GIT_COMMITTER_EMAIL": "blog-bot@users.noreply.github.com"})
    if extra_env:
        env.update(extra_env)
    result = subprocess.run(["git", "--git-dir", str(REPO), *args], input=input, capture_output=True, env=env, timeout=90)
    if check and result.returncode:
        # Do not return remote diagnostics that could contain credentials.
        raise RuntimeError("Git operation failed: " + args[0])
    return result


def fetch_head():
    DATA.mkdir(parents=True, exist_ok=True)
    if not REPO.exists():
        git("init", "--bare")
        git("remote", "add", "origin", REMOTE)
    git("fetch", "--depth=1", "origin", "main")
    return git("rev-parse", "FETCH_HEAD").stdout.decode().strip()


def save_json(target, value):
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False))
    temporary.replace(target)


def article_path(article_id):
    if not isinstance(article_id, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,159}", article_id):
        raise ValueError("Invalid article ID; use an exact ID from article search")
    return "public/markdown/" + article_id + ".md"


def message_id(value):
    if not isinstance(value, str) or not value.strip() or len(value) > 200 or any(ord(c) < 32 for c in value):
        raise ValueError("Invalid message ID")
    return value


def article_at(head, article_id):
    relative = article_path(article_id)
    entry = git("ls-tree", "-z", head, "--", relative).stdout
    if not entry:
        raise ValueError("Article not found")
    metadata, path = entry.rstrip(b"\0").split(b"\t", 1)
    mode, kind, blob = metadata.decode().split()
    if kind != "blob" or mode not in ("100644", "100755") or path.decode() != relative:
        raise ValueError("Only regular Markdown articles can be deleted")
    if int(git("cat-file", "-s", blob).stdout) > 1000000:
        raise ValueError("Article is too large for this interface")
    source = git("cat-file", "blob", blob).stdout
    title = article_id
    text = source.decode("utf-8-sig", errors="replace")
    if text.startswith("---\n") or text.startswith("---\r\n"):
        for line in text.splitlines()[1:]:
            if line.strip() == "---":
                break
            if line.startswith("title:"):
                value = line.split(":", 1)[1].strip()
                try:
                    parsed = json.loads(value)
                    title = parsed if isinstance(parsed, str) else value
                except ValueError:
                    title = value.strip("'") or article_id
                break
    return {"id": article_id, "title": title[:300], "url": BASE + "/article/" + quote(article_id),
            "path": relative, "blob": blob, "sha256": digest(source)}


def split_article(source):
    text = source.decode('utf-8-sig')
    match = re.match(r'\A---\r?\n(.*?)\r?\n---(?:\r?\n|$)(.*)\Z', text, re.S)
    return (match[1], match[2]) if match else ('', text)


def header_value(header, key, default=''):
    match = re.search(r'^' + re.escape(key) + r':[ \t]*([^\r\n]*)$', header, re.M)
    if not match:
        return default
    raw = match[1].strip()
    try:
        value = json.loads(raw)
        return value if isinstance(value, str) else raw
    except ValueError:
        if raw.startswith("'") and raw.endswith("'"):
            return raw[1:-1].replace("''", "'")
        # Supported legacy frontmatter uses scalar title and summary fields.
        if raw in ('|', '>', '|-', '>-', '|+', '>+'):
            start = match.end() + 1
            block = re.split(r'^[^\s#][^\n]*:', header[start:], maxsplit=1, flags=re.M)[0]
            return '\n'.join(line[2:] if line.startswith('  ') else line for line in block.splitlines()).strip()
        return raw


def set_header_value(header, key, value):
    # Replace only the selected top-level value, preserving all other metadata.
    lines = header.splitlines()
    starts = [i for i, line in enumerate(lines) if re.match(r'^' + re.escape(key) + r':', line)]
    if len(starts) > 1:
        raise ValueError('Duplicate metadata field: ' + key)
    replacement = key + ': ' + json.dumps(value, ensure_ascii=False)
    if not starts:
        return '\n'.join([*lines, replacement])
    start = starts[0]
    end = start + 1
    while end < len(lines) and (not lines[end].strip() or lines[end][0].isspace() or lines[end].startswith('- ')):
        end += 1
    return '\n'.join(lines[:start] + [replacement] + lines[end:])


def article_taxonomy(header):
    # Existing articles use JSON-compatible frontmatter. Also accept simple
    # scalar and block-list legacy values; reject ambiguous YAML, never guess.
    def scalar(raw):
        raw = raw.strip()
        if raw.startswith('"'):
            value = json.loads(raw)
            if not isinstance(value, str):
                raise ValueError('Expected text metadata')
            return value
        if raw.startswith("'") and raw.endswith("'"):
            return raw[1:-1].replace("''", "'")
        if not raw or raw[0] in '[{&*!|>\"\'' or ' #' in raw or ': ' in raw:
            raise ValueError('Unsupported metadata format; use quoted text or JSON string arrays')
        return raw

    def values(key, default):
        matches = list(re.finditer(r'^' + key + r':[ \t]*([^\r\n]*)$', header, re.M))
        if not matches:
            return default
        if len(matches) != 1:
            raise ValueError('Duplicate metadata field: ' + key)
        match = matches[0]
        raw = match[1].strip()
        if raw.startswith('['):
            value = json.loads(raw)
            if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
                raise ValueError('Expected string array: ' + key)
        elif not raw:
            value = []
            for line in header[match.end():].splitlines():
                if not line.strip() or line.lstrip().startswith('#'):
                    continue
                item = re.fullmatch(r'\s*-\s+(.+)', line)
                if item:
                    value.append(scalar(item[1]))
                elif line[0].isspace():
                    raise ValueError('Unsupported nested metadata: ' + key)
                else:
                    break
        else:
            value = scalar(raw).split(',')
        return list(dict.fromkeys(item.strip() for item in value if item.strip()))

    categories = values('category', ['其他'])
    return {'category': categories[0] if categories else '其他', 'tags': values('tags', [])}


def normalize_edit_taxonomy(payload):
    payload = dict(payload)
    if 'index' in payload and (type(payload['index']) is not int or not 0 <= payload['index'] <= 10000):
        raise ValueError('Invalid pin priority; index must be an integer from 0 to 10000')
    if 'category' in payload:
        value = payload['category']
        if not isinstance(value, str) or not value.strip() or len(value) > 50 or ',' in value or any(ord(c) < 32 for c in value):
            raise ValueError('Invalid category; use one nonempty category, at most 50 characters')
        payload['category'] = value.strip()
    if 'tags' in payload:
        tags = payload['tags']
        if not isinstance(tags, list) or len(tags) > 12:
            raise ValueError('Invalid tags; use an array of at most 12 labels')
        normalized = []
        for tag in tags:
            if not isinstance(tag, str) or any(ord(c) < 32 for c in tag):
                raise ValueError('Invalid tag')
            tag = tag.strip().lstrip('#').strip()
            if not tag or len(tag) > 40:
                raise ValueError('Invalid tag; use nonempty labels, at most 40 characters')
            if tag not in normalized:
                normalized.append(tag)
        payload['tags'] = normalized
    return payload


def article_pin(header):
    raw = header_value(header, 'index', '0')
    if not re.fullmatch(r'[0-9]+', raw):
        raise ValueError('Invalid article pin priority')
    return int(raw)


def read_article(article_id):
    with LOCK:
        article = article_at(fetch_head(), article_id)
        header, body = split_article(git('cat-file', 'blob', article['blob']).stdout)
        return {**{k: article[k] for k in ('id', 'title', 'url', 'sha256')},
                **article_taxonomy(header), 'index': article_pin(header),
                'summary': header_value(header, 'summary'), 'body': body,
                'date': header_value(header, 'date'), 'updated_at': header_value(header, 'updated_at'),
                'note': 'Show the full title, category, tags, pin priority (index) and body unchanged, then ask what to modify. This read does not authorize saving.'}


SEARCH_ALIASES = [('防抖', '防抖函数', 'debounce', 'debouncing'),
                  ('节流', '节流函数', 'throttle', 'throttling')]


def search_terms(query):
    # The agent extracts topic keywords from the user's natural-language question.
    terms = [query.strip().casefold()] if query.strip() else []
    for group in SEARCH_ALIASES:
        if any(term in terms for term in group):
            return list(group)
    return terms


def prepare_edit(payload):
    fields = {'article_id', 'expected_sha256', 'message_id', 'title', 'summary', 'body'}
    if not isinstance(payload, dict) or not fields <= set(payload) or set(payload) - fields - {'category', 'tags', 'index'}:
        raise ValueError('Expected article_id, expected_sha256, message_id, title, summary, body; optional category, tags and index')
    payload = normalize_edit_taxonomy(payload)
    article_path(payload['article_id'])
    message_id(payload['message_id'])
    if not isinstance(payload['expected_sha256'], str) or not re.fullmatch('[0-9a-f]{64}', payload['expected_sha256']):
        raise ValueError('Use the article sha256 from the read tool')
    for key, limit in [('title', 160), ('summary', 500), ('body', 100000)]:
        value = payload[key]
        if not isinstance(value, str) or len(value) > limit or (key != 'summary' and not value.strip()):
            raise ValueError('Invalid ' + key)
        if '\x00' in value or (key != 'body' and any(ord(c) < 32 for c in value)):
            raise ValueError('Invalid control characters in ' + key)
    if SECRET_PATTERN.search(json.dumps(payload, ensure_ascii=False)):
        raise ValueError('Possible credential found; remove it before saving')
    draft_id = 'edt-' + digest((payload['article_id'] + '\0' + payload['message_id']).encode())[:24]
    with LOCK:
        path = DATA / 'edits' / (draft_id + '.json')
        latest = DATA / 'edits' / ('latest-' + payload['article_id'] + '.json')
        if path.is_file():
            draft = json.loads(path.read_text())
            if draft['payload'] != payload:
                raise ValueError('This message already has another draft; do not replace a previously shown version')
            if draft.get('commit') or not latest.is_file() or json.loads(latest.read_text())['id'] != draft_id:
                raise ValueError('Draft is no longer current; read the article and use a new user request')
        else:
            article = article_at(fetch_head(), payload['article_id'])
            if article['sha256'] != payload['expected_sha256']:
                raise ValueError('Article changed since reading; read latest content, merge and show a new preview')
            draft = {'id': draft_id, 'article': article, 'payload': payload,
                     'taxonomy': {**article_taxonomy(split_article(git('cat-file', 'blob', article['blob']).stdout)[0]), 'index': article_pin(split_article(git('cat-file', 'blob', article['blob']).stdout)[0])},
                     'expires_at': int(time.time()) + 86400, 'state': 'awaiting_confirmation'}
            save_json(path, draft)
            save_json(latest, {'id': draft_id})
        original = draft.get('taxonomy')
        if original is None:  # Pre-upgrade drafts remain confirmable without changing metadata.
            original = article_taxonomy(split_article(git('cat-file', 'blob', draft['article']['blob']).stdout)[0])
        original.setdefault('index', article_pin(split_article(git('cat-file', 'blob', draft['article']['blob']).stdout)[0]))
        return {'draft_id': draft_id, 'article_id': payload['article_id'], 'url': draft['article']['url'],
                **{key: payload.get(key, original[key]) for key in ('category', 'tags', 'index')},
                'title': payload['title'], 'summary': payload['summary'], 'body': payload['body'],
                'expires_at': draft['expires_at'], 'state': 'awaiting_confirmation',
                'note': 'Show this entire revision, then wait for a new user message approving upload, e.g. 可以了 or 上传吧. No Git changes yet.'}


def edit_confirmation(text):
    if not isinstance(text, str) or len(text) > 100:
        return False
    normalized = re.sub(r'[\s，,。.!！；;：:、]', '', text)
    return bool(re.fullmatch(r'(?:(?:可以了|满意了|没问题了|就这样|好的)(?:(?:请|帮我)?(?:上传|保存|发布|更新)(?:吧|这版|到博客|到网站)?)?|(?:请|帮我)?(?:上传|保存|发布|更新)(?:吧|这版|到博客|到网站)?|确认(?:保存|修改|上传|发布))', normalized))


def complete_edit(draft):
    article = draft['article']
    job = {'id': draft['id'], 'operation': 'edit', 'article_id': article['id'],
           'title': draft['payload']['title'], 'url': article['url'], 'commit': draft['commit'],
           'previous_commit': draft['head'], 'previous_blob': article['blob'],
           'sha256': draft['result_sha256'], 'updated_at': draft['updated_at'],
           'markdown_url': BASE + '/markdown/' + article['id'] + '.md',
           'workflow_url': 'https://github.com/cjw260/blog-page/actions/workflows/container.yml', 'state': 'submitted'}
    save_json(DATA / 'jobs' / (job['id'] + '.json'), job)
    draft['state'] = 'submitted'
    save_json(DATA / 'edits' / (draft['id'] + '.json'), draft)
    return job


def confirm_edit(payload):
    if not isinstance(payload, dict) or set(payload) != {'draft_id', 'confirmation_message_id', 'confirmation_text'}:
        raise ValueError('Expected draft_id, confirmation_message_id and confirmation_text')
    draft_id = payload['draft_id']
    if not isinstance(draft_id, str) or not re.fullmatch('edt-[0-9a-f]{24}', draft_id):
        raise ValueError('Invalid edit draft')
    confirmation_message = message_id(payload['confirmation_message_id'])
    if not edit_confirmation(payload['confirmation_text']):
        raise ValueError('Wait for explicit approval of the shown draft, e.g. 可以了 or 上传吧')
    with LOCK:
        path = DATA / 'edits' / (draft_id + '.json')
        if not path.is_file():
            raise ValueError('Unknown edit draft')
        draft = json.loads(path.read_text())
        if confirmation_message == draft['payload']['message_id']:
            raise ValueError('Approval must be a NEW user message after displaying the draft')
        if draft.get('confirmation_message_id', confirmation_message) != confirmation_message:
            raise ValueError('Reuse the original confirmation message ID when retrying')
        job_path = DATA / 'jobs' / (draft_id + '.json')
        if job_path.is_file():
            return json.loads(job_path.read_text())
        head = fetch_head()
        if draft.get('commit'):
            # Push timeout/crash: inspect the actual remote outcome, never overwrite again.
            current = article_at(head, draft['article']['id'])
            if current['sha256'] == draft['result_sha256']:
                return complete_edit(draft)
            raise ValueError('Previous save outcome is uncertain or article changed; read again and ask for new approval')
        latest = DATA / 'edits' / ('latest-' + draft['article']['id'] + '.json')
        if not latest.is_file() or json.loads(latest.read_text())['id'] != draft_id:
            raise ValueError('A newer draft exists; show and confirm the latest revision')
        if time.time() > draft['expires_at']:
            raise ValueError('Draft expired; read the article and show a new preview')
        current = article_at(head, draft['article']['id'])
        if current['sha256'] != draft['payload']['expected_sha256']:
            raise ValueError('Article changed after preview; read latest content, merge and ask for new approval')
        header, old_body = split_article(git('cat-file', 'blob', current['blob']).stdout)
        values = draft['payload']
        taxonomy = {**article_taxonomy(header), 'index': article_pin(header)} if any(key in values for key in ('category', 'tags', 'index')) else {}
        metadata_changes = [(key, values[key]) for key in ('category', 'tags', 'index') if key in values and values[key] != taxonomy[key]]
        same_body = values['body'].rstrip('\n') == old_body.rstrip('\n')
        if not metadata_changes and values['title'] == current['title'] and values['summary'] == header_value(header, 'summary') and same_body:
            raise ValueError('No content changes to save')
        updated_at = dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).isoformat(timespec='seconds')
        changes = metadata_changes + [('updated_at', updated_at)]
        if values['title'] != current['title']:
            changes.append(('title', values['title']))
        if values['summary'] != header_value(header, 'summary'):
            changes.append(('summary', values['summary']))
        for key, value in changes:
            header = set_header_value(header, key, value)
        body = old_body if same_body else values['body'].rstrip('\n') + '\n'
        source = ('---\n' + header + '\n---\n' + body).encode()
        with tempfile.TemporaryDirectory() as directory:
            env = {'GIT_INDEX_FILE': directory + '/index'}
            blob = git('hash-object', '-w', '--stdin', input=source).stdout.decode().strip()
            git('read-tree', head, extra_env=env)
            git('update-index', '--add', '--cacheinfo', '100644,' + blob + ',' + current['path'], extra_env=env)
            tree = git('write-tree', extra_env=env).stdout.decode().strip()
            commit = git('commit-tree', tree, '-p', head, input=('blog: update ' + current['id'] + '\n\nEdit-Request: ' + draft_id + '\n').encode()).stdout.decode().strip()
        draft.update({'head': head, 'commit': commit, 'result_sha256': digest(source), 'updated_at': updated_at,
                      'confirmation_message_id': confirmation_message, 'confirmation_text': payload['confirmation_text'], 'state': 'pushing'})
        save_json(path, draft)
        result = git('push', 'origin', commit + ':refs/heads/main', check=False)
        if result.returncode:
            current = article_at(fetch_head(), draft['article']['id'])
            if current['sha256'] != draft['result_sha256']:
                raise RuntimeError('Save push uncertain; retry the same confirmation')
        return complete_edit(draft)


def list_articles(query=""):
    if not isinstance(query, str) or len(query) > 160:
        raise ValueError("Invalid search query")
    with LOCK:
        head = fetch_head()
        entries = git("ls-tree", "-r", "-z", "--name-only", head, "--", "public/markdown/").stdout
        matches = []
        terms = search_terms(query)
        for entry in entries.split(b"\0"):
            name = entry.decode("utf-8", errors="replace")
            if not re.fullmatch(r"public/markdown/[A-Za-z0-9][A-Za-z0-9_-]{0,159}\.md", name):
                continue
            try:
                article = article_at(head, name[len("public/markdown/"):-3])
            except ValueError:
                continue  # Unsupported files must not hide other searchable articles.
            header, body = split_article(git('cat-file', 'blob', article['blob']).stdout)
            if re.search(r'^draft:\s*true\s*$', header, re.M | re.I):
                continue
            title_text = (article['id'] + ' ' + article['title']).casefold()
            metadata = header.casefold()
            body_folded = body.casefold()
            matched = [term for term in terms if term in (title_text + '\n' + metadata + '\n' + body_folded)]
            if not terms or matched:
                rank = max((3 if term in title_text else 2 if term in metadata else 1 for term in matched), default=0)
                position = next((body_folded.find(term) for term in matched if term in body_folded), 0)
                excerpt = body[max(0, position - 40):max(0, position - 40) + 220]
                matches.append({**{k: article[k] for k in ('id', 'title', 'url')},
                                'index': article_pin(header), 'excerpt': excerpt, 'matched_terms': matched, 'rank': rank})
        matches.sort(key=lambda item: (item['rank'], item['id']), reverse=True)
        return {"articles": matches[:50], "total": len(matches), "truncated": len(matches) > 50}


def prepare_delete(payload):
    if not isinstance(payload, dict) or set(payload) != {"article_id", "message_id"}:
        raise ValueError("Expected article_id and message_id")
    article_path(payload["article_id"])
    origin_message = message_id(payload["message_id"])
    with LOCK:
        head = fetch_head()
        article = article_at(head, payload["article_id"])
        request_id = "del-" + secrets.token_hex(12)
        code = secrets.token_hex(4).upper()
        request = {"id": request_id, "article": article, "head": head, "message_id": origin_message,
                   "code": code, "expires_at": int(time.time()) + 900, "state": "awaiting_confirmation"}
        save_json(DATA / "deletions" / (request_id + ".json"), request)
        return {"request_id": request_id, "article_id": article["id"], "title": article["title"],
                "url": article["url"], "confirmation_text": "确认删除 " + code,
                "expires_at": request["expires_at"], "state": "awaiting_confirmation",
                "note": "Show title and URL; wait for a NEW user message with the exact confirmation text. Git history retains the article."}


def complete_delete(request):
    article = request["article"]
    job = {"id": request["id"], "operation": "delete", "article_id": article["id"],
           "title": article["title"], "url": article["url"], "commit": request["commit"],
           "previous_commit": request["head"], "deleted_blob": article["blob"],
           "sha256": article["sha256"], "markdown_url": BASE + "/markdown/" + article["id"] + ".md",
           "workflow_url": "https://github.com/cjw260/blog-page/actions/workflows/container.yml", "state": "submitted"}
    save_json(DATA / "jobs" / (job["id"] + ".json"), job)
    request["state"] = "submitted"
    save_json(DATA / "deletions" / (request["id"] + ".json"), request)
    return job


def confirm_delete(payload):
    if not isinstance(payload, dict) or set(payload) != {"request_id", "confirmation_message_id", "confirmation_text"}:
        raise ValueError("Expected request_id, confirmation_message_id and confirmation_text")
    request_id = payload["request_id"]
    if not isinstance(request_id, str) or not re.fullmatch(r"del-[0-9a-f]{24}", request_id):
        raise ValueError("Invalid deletion request")
    confirmation_message = message_id(payload["confirmation_message_id"])
    with LOCK:
        path = DATA / "deletions" / (request_id + ".json")
        if not path.is_file():
            raise ValueError("Unknown deletion request")
        request = json.loads(path.read_text())
        if payload["confirmation_text"] != "确认删除 " + request["code"]:
            raise ValueError("Exact confirmation text is required")
        if confirmation_message == request["message_id"]:
            raise ValueError("Confirmation must be a separate user message")
        if request.get("confirmation_message_id", confirmation_message) != confirmation_message:
            raise ValueError("Reuse the original confirmation message ID when retrying")
        job_path = DATA / "jobs" / (request_id + ".json")
        if job_path.is_file():
            return json.loads(job_path.read_text())  # Never delete a restored article on retry.
        head = fetch_head()
        relative = request["article"]["path"]
        if request.get("commit"):
            # A push may have succeeded before a timeout/crash. Do not push again.
            if not git("ls-tree", "-z", head, "--", relative).stdout:
                return complete_delete(request)
            raise ValueError("Previous deletion outcome is uncertain or article was restored; prepare a new preview")
        if time.time() > request["expires_at"]:
            raise ValueError("Confirmation expired; prepare a new preview")
        current = article_at(head, request["article"]["id"])
        if current["blob"] != request["article"]["blob"]:
            raise ValueError("Article changed after preview; prepare a new preview")
        with tempfile.TemporaryDirectory() as directory:
            env = {"GIT_INDEX_FILE": directory + "/index"}
            git("read-tree", head, extra_env=env)
            # Index plumbing works in a bare repository without a working tree.
            git("update-index", "--index-info", input=("0 " + "0" * len(current["blob"]) + "\t" + relative + "\n").encode(), extra_env=env)
            tree = git("write-tree", extra_env=env).stdout.decode().strip()
            commit = git("commit-tree", tree, "-p", head,
                         input=("blog: delete " + request["article"]["id"] + "\n\nDeletion-Request: " + request_id + "\n").encode()).stdout.decode().strip()
        request.update({"commit": commit, "head": head, "confirmation_message_id": confirmation_message, "state": "pushing"})
        save_json(path, request)  # Durable intent before external mutation.
        result = git("push", "origin", commit + ":refs/heads/main", check=False)
        if result.returncode:
            head = fetch_head()
            if git("ls-tree", "-z", head, "--", relative).stdout:
                raise RuntimeError("Delete push uncertain; retry the same confirmation, never select another article")
        return complete_delete(request)


def publish(payload):
    job_id, source = validate(payload)
    relative = "public/markdown/" + job_id + ".md"
    with LOCK:
        DATA.mkdir(parents=True, exist_ok=True)
        if not REPO.exists():
            git("init", "--bare")
            git("remote", "add", "origin", REMOTE)
        for attempt in range(3):
            git("fetch", "--depth=1", "origin", "main")
            head = git("rev-parse", "FETCH_HEAD").stdout.decode().strip()
            existing = git("show", head + ":" + relative, check=False)
            if existing.returncode == 0:
                if existing.stdout != source:
                    raise ValueError("This message already has a different published article; refusing to overwrite")
                commit = head
                break
            for deletion in (DATA / "deletions").glob("del-*.json"):
                record = json.loads(deletion.read_text())
                if record.get("commit") and record["article"]["id"] == job_id:
                    raise ValueError("This article was deleted; refusing to recreate it from an old publish retry")
            with tempfile.TemporaryDirectory() as directory:
                env = {"GIT_INDEX_FILE": directory + "/index"}
                blob = git("hash-object", "-w", "--stdin", input=source).stdout.decode().strip()
                git("read-tree", head, extra_env=env)
                git("update-index", "--add", "--cacheinfo", "100644," + blob + "," + relative, extra_env=env)
                tree = git("write-tree", extra_env=env).stdout.decode().strip()
                commit = git("commit-tree", tree, "-p", head, input=("blog: publish " + job_id + "\n").encode()).stdout.decode().strip()
                result = git("push", "origin", commit + ":refs/heads/main", check=False)
                if result.returncode == 0:
                    break
        else:
            raise RuntimeError("Push did not complete; retry the same message, never create a new message ID")
        job = {"id": job_id, "commit": commit, "sha256": digest(source), "url": BASE + "/article/" + job_id, "markdown_url": BASE + "/markdown/" + job_id + ".md", "workflow_url": "https://github.com/cjw260/blog-page/actions/workflows/container.yml", "state": "submitted"}
        (DATA / "jobs").mkdir(exist_ok=True)
        target = DATA / "jobs" / (job_id + ".json")
        temporary = target.with_suffix(".tmp")
        temporary.write_text(json.dumps(job))
        temporary.replace(target)
        return job


def status(job_id):
    if not re.fullmatch(r"(?:ai|del|edt)-[0-9a-f]{24}", job_id):
        raise ValueError("Invalid article ID")
    target = DATA / "jobs" / (job_id + ".json")
    if not target.is_file():
        raise ValueError("Unknown article ID")
    job = json.loads(target.read_text())
    if job.get("operation") == "delete":
        job["state"] = "deploying"
        try:
            # This site's missing Markdown routes return the SPA shell with HTTP 200.
            # Verify a healthy, exact shell match; arbitrary error HTML is not proof.
            def fetch(url):
                req = urllib.request.Request(url + "?release=" + job["commit"], headers={"Cache-Control": "no-cache"})
                with urllib.request.urlopen(req, timeout=15) as response:
                    return response.read(200001)
            shell = fetch(BASE + "/")
            if b'<div id="app"' not in shell or b'<script' not in shell:
                return job
            try:
                missing = fetch(job["markdown_url"])
                if missing == shell:
                    job["state"] = "removed"
            except urllib.error.HTTPError as exc:
                if exc.code in (404, 410):
                    job["state"] = "removed"
        except (urllib.error.URLError, TimeoutError):
            pass
        return job
    try:
        req = urllib.request.Request(job["markdown_url"] + "?release=" + job["commit"], headers={"Cache-Control": "no-cache", "User-Agent": "CJW-Blog-Publisher"})
        with urllib.request.urlopen(req, timeout=15) as response:
            content = response.read(1000001)
        job["state"] = "live" if digest(content) == job["sha256"] else "deploying"
    except (urllib.error.URLError, TimeoutError):
        job["state"] = "deploying"
    return job


def ocr(payload):
    if not isinstance(payload, dict) or set(payload) != {"image_base64"}:
        raise ValueError("Expected image_base64")
    image = base64.b64decode(payload["image_base64"], validate=True)
    if len(image) > 8 * 1024 * 1024 or not (image.startswith(b"\x89PNG\r\n\x1a\n") or image.startswith(b"\xff\xd8\xff")):
        raise ValueError("Use a PNG or JPEG under 8 MiB")
    # Run serially with publishing to cap CPU/memory pressure on the small server.
    with LOCK:
        result = subprocess.run(["tesseract", "stdin", "stdout", "-l", "chi_sim+eng"], input=image, capture_output=True, timeout=45, env={**os.environ, "OMP_THREAD_LIMIT": "1"})
    if result.returncode:
        raise ValueError("Image recognition failed; resend a clearer PNG/JPEG")
    return {"text": result.stdout.decode("utf-8")[:100000], "note": "OCR may contain errors; preserve uncertainty and verify code/numbers."}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass  # Never log article bodies or credentials.

    def reply(self, code, value):
        body = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def authorized(self):
        token = os.environ.get("PUBLISHER_TOKEN", "")
        return len(token) >= 32 and hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + token)

    def do_GET(self):
        if self.path == "/healthz":
            return self.reply(200, {"ok": True})
        if not self.authorized():
            return self.reply(401, {"error": "Unauthorized"})
        try:
            if urlsplit(self.path).path.startswith('/articles/'):
                return self.reply(200, read_article(urlsplit(self.path).path.removeprefix('/articles/')))
            if urlsplit(self.path).path == "/articles":
                return self.reply(200, list_articles(parse_qs(urlsplit(self.path).query).get("query", [""])[0]))
            if not self.path.startswith("/status/"):
                return self.reply(404, {"error": "Not found"})
            self.reply(200, status(self.path.removeprefix("/status/")))
        except ValueError as exc:
            self.reply(400, {"error": str(exc)})
        except Exception:
            self.reply(502, {"error": "Read operation unavailable; retry later"})

    def do_POST(self):
        if not self.authorized():
            return self.reply(401, {"error": "Unauthorized"})
        try:
            limit = 12 * 1024 * 1024 if self.path == "/ocr" else 1000000
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > limit:
                return self.reply(413, {"error": "Request too large or missing length"})
            payload = json.loads(self.rfile.read(length))
            if self.path == "/publish":
                self.reply(200, publish(payload))
            elif self.path == '/edit/preview':
                self.reply(200, prepare_edit(payload))
            elif self.path == '/edit/confirm':
                self.reply(200, confirm_edit(payload))
            elif self.path == "/delete/prepare":
                self.reply(200, prepare_delete(payload))
            elif self.path == "/delete/confirm":
                self.reply(200, confirm_delete(payload))
            elif self.path == "/ocr":
                self.reply(200, ocr(payload))
            else:
                self.reply(404, {"error": "Not found"})
        except (ValueError, TypeError) as exc:
            self.reply(400, {"error": str(exc)})
        except Exception:
            self.reply(502, {"error": "Operation incomplete. Retry the same message ID; inspect service logs if it persists."})


if __name__ == "__main__":
    if len(os.environ.get("PUBLISHER_TOKEN", "")) < 32:
        raise SystemExit("PUBLISHER_TOKEN must contain at least 32 characters")
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
