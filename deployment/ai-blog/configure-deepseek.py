#!/usr/bin/env python3
"""Save the owner's DeepSeek key from hidden server-terminal input."""
import getpass
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request

ENV_PATH = Path("/opt/cjw-ai-blog/secrets/openclaw.env")
CONFIG_PATH = Path("/opt/cjw-ai-blog/openclaw.json")


def select_model(result):
    if not isinstance(result, dict) or not isinstance(result.get("data"), list):
        raise ValueError("Unexpected model-list response; configuration was not changed.")
    models = sorted({m["id"] for m in result["data"]
                     if isinstance(m, dict) and isinstance(m.get("id"), str)
                     and re.fullmatch(r"deepseek-[A-Za-z0-9._-]+", m["id"])})
    if not models:
        raise ValueError("No DeepSeek models were returned; configuration was not changed.")
    print("Available models:", ", ".join(models))
    for preferred in ("deepseek-flash", "deepseek-v4-flash"):
        if preferred in models:
            print("Selected model:", preferred)
            return preferred
    # Do not silently select a different model or price tier.
    choice = input("Enter one of the available model IDs above: ").strip()
    if choice not in models:
        raise ValueError("Model was not in the returned list; configuration was not changed.")
    return choice


def stage_file(path, content):
    stat = path.stat()
    fd, temporary = tempfile.mkstemp(prefix=".deepseek-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            os.fchmod(stream.fileno(), 0o600)
            if os.geteuid() == 0:
                os.fchown(stream.fileno(), stat.st_uid, stat.st_gid)
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
    except BaseException:
        os.unlink(temporary)
        raise
    return temporary


def save_configuration(secret, model):
    # OpenClaw 2026.9.4's official adapter recognizes the V4 alias. DeepSeek
    # explicitly routes this supported alias to the current Flash model.
    runtime_model = "deepseek-v4-flash" if model == "deepseek-flash" else model
    config = json.loads(CONFIG_PATH.read_text())
    provider = config["models"]["providers"]["deepseek"]
    provider.update({"baseUrl": "https://api.deepseek.com",
                     "apiKey": "${DEEPSEEK_API_KEY}", "api": "openai-completions"})
    # Flash supports a 1M context. Keep the response cap independent of context.
    # Preserve configured limits when rotating credentials, including custom models.
    existing = next((m for m in provider.get("models", []) if m.get("id") == runtime_model), {})
    context_window = 1000000 if runtime_model == "deepseek-v4-flash" else existing.get("contextWindow", 64000)
    provider["models"] = [{"id": runtime_model, "name": model, "input": ["text"],
                           "reasoning": True, "contextWindow": context_window, "maxTokens": existing.get("maxTokens", 8192),
                           "compat": {"supportsReasoningEffort": True,
                                      "maxTokensField": "max_tokens"}}]
    defaults = config["agents"]["defaults"]
    defaults["model"] = {"primary": "deepseek/" + runtime_model}
    defaults["thinkingDefault"] = "off"
    lines = [line for line in ENV_PATH.read_text().splitlines()
             if line.split("=", 1)[0] != "DEEPSEEK_API_KEY"]
    lines.append("DEEPSEEK_API_KEY=" + secret)
    staged = []
    try:
        staged.append((CONFIG_PATH, stage_file(CONFIG_PATH, json.dumps(config, ensure_ascii=False, indent=2) + "\n")))
        staged.append((ENV_PATH, stage_file(ENV_PATH, "\n".join(lines) + "\n")))
        for path, temporary in staged:
            os.replace(temporary, path)
    finally:
        for _, temporary in staged:
            if os.path.exists(temporary):
                os.unlink(temporary)
    print("OpenClaw model:", runtime_model)


def main():
    if not sys.stdin.isatty():
        raise SystemExit("Run this script in an interactive server terminal.")
    state = subprocess.run(["docker", "inspect", "cjw-ai-blog-openclaw-1",
                            "--format", "{{.State.Running}}"], capture_output=True, text=True)
    if state.returncode != 0 or state.stdout.strip() != "false":
        raise SystemExit("Stop the OpenClaw container before changing credentials.")
    secret = getpass.getpass("Paste YOUR DeepSeek API key (input is hidden): ")
    if not re.fullmatch(r"sk-[A-Za-z0-9_-]{16,256}", secret):
        raise SystemExit("Unexpected key format; configuration was not changed.")
    request = urllib.request.Request(
        "https://api.deepseek.com/models",
        headers={"Authorization": "Bearer " + secret},
    )
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        raise SystemExit(f"DeepSeek returned HTTP {error.code}; configuration was not changed.")
    except (OSError, ValueError, urllib.error.URLError):
        raise SystemExit("Cannot read the model list; configuration was not changed.")
    try:
        model = select_model(result)
    except ValueError as error:
        raise SystemExit(str(error))
    save_configuration(secret, model)
    print("CJW_DEEPSEEK_KEY_READY — verified and saved; bot not started yet.")


if __name__ == "__main__":
    main()
