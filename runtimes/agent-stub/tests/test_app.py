"""Smoke tests for the agent-stub gateway."""
import os
import sys
from pathlib import Path

# Point the workspace at the repo root so read_file/list_files have real
# files to work against without needing a writable scratch dir. Use direct
# assignment (not setdefault) so an externally-set AGENT_WORKSPACE_DIR can't
# point the test suite at a workspace where README.md is missing.
REPO_ROOT = Path(__file__).resolve().parents[3]
os.environ["AGENT_WORKSPACE_DIR"] = str(REPO_ROOT)

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient

import app as app_module
from app import app

client = TestClient(app)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_echo_tool():
    r = client.post("/tools/invoke", json={"tool": "echo", "args": {"x": 1}})
    body = r.json()
    assert body["status"] == "ok"
    assert body["result"] == {"echo": {"x": 1}}
    assert body["trace"][0]["tool"] == "echo"


def test_shell_tool_runs_allowlisted_binary():
    r = client.post(
        "/tools/invoke",
        json={"tool": "shell", "args": {"command": "whoami"}},
    )
    body = r.json()
    assert body["status"] == "ok", body
    assert body["result"]["argv"] == ["whoami"]
    assert body["result"]["exit_code"] == 0
    assert body["result"]["stdout"].strip() != ""


def test_shell_tool_rejects_unlisted_binary():
    r = client.post(
        "/tools/invoke",
        json={"tool": "shell", "args": {"command": "rm -rf /"}},
    )
    body = r.json()
    assert body["status"] == "error"
    assert "not allowed" in body["error"]


def test_shell_tool_does_not_allow_cat_for_path_reads():
    # Path-taking binaries are deliberately off the shell allow-list to
    # prevent escape from /workspace via absolute paths. Use the read_file
    # tool instead.
    r = client.post(
        "/tools/invoke",
        json={"tool": "shell", "args": {"command": "cat /etc/passwd"}},
    )
    body = r.json()
    assert body["status"] == "error"
    assert "not allowed" in body["error"]


def test_shell_tool_rejects_metacharacters():
    r = client.post(
        "/tools/invoke",
        json={"tool": "shell", "args": {"command": "whoami; whoami"}},
    )
    body = r.json()
    assert body["status"] == "error"
    assert "disallowed" in body["error"]


def test_read_file_tool_reads_workspace_file():
    r = client.post(
        "/tools/invoke",
        json={"tool": "read_file", "args": {"path": "README.md", "max_bytes": 200}},
    )
    body = r.json()
    assert body["status"] == "ok", body
    assert body["result"]["path"] == "README.md"
    assert body["result"]["bytes"] > 0
    assert "Agentic" in body["result"]["content"]


def test_read_file_rejects_traversal():
    r = client.post(
        "/tools/invoke",
        json={"tool": "read_file", "args": {"path": "../etc/passwd"}},
    )
    body = r.json()
    assert body["status"] == "error"
    assert "escapes workspace" in body["error"]


def test_read_file_truncates_at_max_bytes():
    # Use a known-larger file; README.md is several KB. With max_bytes=64 we
    # should get exactly 64 bytes back and truncated=True, without ever
    # loading the full file into memory.
    r = client.post(
        "/tools/invoke",
        json={"tool": "read_file", "args": {"path": "README.md", "max_bytes": 64}},
    )
    body = r.json()
    assert body["status"] == "ok", body
    assert body["result"]["bytes"] == 64
    assert body["result"]["truncated"] is True
    assert len(body["result"]["content"]) <= 64


def test_list_files_tool():
    r = client.post(
        "/tools/invoke",
        json={"tool": "list_files", "args": {"path": "."}},
    )
    body = r.json()
    assert body["status"] == "ok"
    names = [e["name"] for e in body["result"]["entries"]]
    assert "README.md" in names


def test_summarize_tool():
    r = client.post(
        "/tools/invoke",
        json={
            "tool": "summarize",
            "args": {"text": "Demo demo demo. Agents call tools. Tools return output."},
        },
    )
    body = r.json()
    assert body["status"] == "ok"
    assert body["result"]["first_sentence"].startswith("Demo")
    top = [e["word"] for e in body["result"]["top_words"]]
    assert "demo" in top


def test_command_classifies_to_shell():
    r = client.post(
        "/tools/invoke",
        json={"tool": "command", "args": {"text": "whoami"}},
    )
    body = r.json()
    assert body["status"] == "ok"
    assert body["result"]["chosen_tool"] == "shell"
    assert body["result"]["result"]["exit_code"] == 0
    assert len(body["trace"]) == 2


def test_command_classifies_to_list_files():
    r = client.post(
        "/tools/invoke",
        json={"tool": "command", "args": {"text": "list ."}},
    )
    body = r.json()
    assert body["status"] == "ok"
    assert body["result"]["chosen_tool"] == "list_files"


def test_command_classifies_to_read_file():
    r = client.post(
        "/tools/invoke",
        json={"tool": "command", "args": {"text": "read README.md"}},
    )
    body = r.json()
    assert body["status"] == "ok"
    assert body["result"]["chosen_tool"] == "read_file"


def test_command_falls_back_to_echo():
    r = client.post(
        "/tools/invoke",
        json={"tool": "command", "args": {"text": "what is the weather"}},
    )
    body = r.json()
    assert body["status"] == "ok"
    assert body["result"]["chosen_tool"] == "echo"


def test_unknown_tool_errors():
    r = client.post(
        "/tools/invoke",
        json={"tool": "does-not-exist", "args": {}},
    )
    body = r.json()
    assert body["status"] == "error"
    assert "unknown tool" in body["error"]


def test_command_falls_back_when_inner_tool_errors():
    # "list <path>" routes to list_files, which raises on a non-existent
    # path. Without the soft fallback that would surface as a hard error
    # to the demo UI; with the fallback the command echoes the input and
    # the trace explains what went wrong.
    r = client.post(
        "/tools/invoke",
        json={"tool": "command", "args": {"text": "list files in workspace"}},
    )
    body = r.json()
    assert body["status"] == "ok", body
    assert body["result"]["chosen_tool"] == "echo"
    assert "fell back to echo" in body["result"]["rationale"]
    assert any(t["tool"] == "fallback" for t in body["trace"])


def test_classify_llm_returns_none_when_unconfigured(monkeypatch):
    # The LLM hook only runs when LLM_BASE_URL+LLM_MODEL are set; with both
    # empty, _classify must use the rule-based path and not touch httpx.
    monkeypatch.setattr(app_module, "LLM_BASE_URL", "")
    monkeypatch.setattr(app_module, "LLM_MODEL", "")
    out = app_module._classify("whoami")
    assert out["tool"] == "shell"


def test_classify_llm_used_when_configured(monkeypatch):
    # With LLM env set, _classify_llm() should be called and its choice
    # accepted as long as it returns an allow-listed tool. Mock the inner
    # function rather than httpx so this test stays fast and offline.
    monkeypatch.setattr(app_module, "LLM_BASE_URL", "http://fake")
    monkeypatch.setattr(app_module, "LLM_MODEL", "fake-model")
    monkeypatch.setattr(
        app_module,
        "_classify_llm",
        lambda text: {
            "tool": "summarize",
            "args": {"text": text},
            "rationale": "stubbed LLM",
        },
    )
    out = app_module._classify("anything goes")
    assert out["tool"] == "summarize"
    assert out["rationale"] == "stubbed LLM"


def test_classify_llm_falls_back_on_failure(monkeypatch):
    # When the LLM hook returns None (network/bad-shape/etc), _classify
    # must fall through to the rule-based classifier so the demo keeps
    # working offline.
    monkeypatch.setattr(app_module, "LLM_BASE_URL", "http://fake")
    monkeypatch.setattr(app_module, "LLM_MODEL", "fake-model")
    monkeypatch.setattr(app_module, "_classify_llm", lambda text: None)
    out = app_module._classify("whoami")
    assert out["tool"] == "shell"


def test_classify_llm_handles_non_string_content(monkeypatch):
    # Some OpenAI-compatible providers return null or a structured payload
    # as message.content. Calling .strip() on those raises AttributeError,
    # which would bypass the rules fallback if not handled — regression
    # guard for that path.
    monkeypatch.setattr(app_module, "LLM_BASE_URL", "http://fake")
    monkeypatch.setattr(app_module, "LLM_MODEL", "fake-model")

    class _FakeResp:
        def raise_for_status(self):
            return None

        def json(self):
            return {"choices": [{"message": {"content": None}}]}

    monkeypatch.setattr(app_module.httpx, "post", lambda *a, **kw: _FakeResp())
    assert app_module._classify_llm("anything") is None
    # And the outer _classify still falls through to the rule-based path.
    out = app_module._classify("whoami")
    assert out["tool"] == "shell"


def _stub_llm_response(monkeypatch, content):
    """Helper to stub httpx.post with a chat.completions-shaped response
    whose message.content is exactly `content` (str or otherwise)."""
    class _FakeResp:
        def raise_for_status(self):
            return None

        def json(self):
            return {"choices": [{"message": {"content": content}}]}

    monkeypatch.setattr(app_module, "LLM_BASE_URL", "http://fake")
    monkeypatch.setattr(app_module, "LLM_MODEL", "fake-model")
    monkeypatch.setattr(app_module.httpx, "post", lambda *a, **kw: _FakeResp())


def test_classify_llm_happy_path(monkeypatch):
    # Real models return a JSON string in message.content; the hook must
    # parse it and adopt the choice when the tool is allow-listed.
    _stub_llm_response(
        monkeypatch,
        '{"tool": "summarize", "args": {"text": "hi"}, "rationale": "it"}',
    )
    out = app_module._classify_llm("anything")
    assert out is not None
    assert out["tool"] == "summarize"
    assert out["args"] == {"text": "hi"}
    assert out["rationale"] == "it"


def test_classify_llm_strips_code_fences(monkeypatch):
    # Many models wrap JSON in ```json ... ``` even when explicitly told
    # not to. The hook strips that defensively before json.loads.
    _stub_llm_response(
        monkeypatch,
        '```json\n{"tool":"echo","args":{"text":"x"},"rationale":"y"}\n```',
    )
    out = app_module._classify_llm("anything")
    assert out is not None
    assert out["tool"] == "echo"


def test_classify_llm_rejects_non_object_json(monkeypatch):
    # JSON list/scalar must be rejected, not crash on parsed.get().
    _stub_llm_response(monkeypatch, '["echo", "args"]')
    assert app_module._classify_llm("anything") is None


def test_classify_llm_rejects_non_allowlisted_tool(monkeypatch):
    # Hallucinated tool name must fall back to None so the outer
    # _classify() takes the rule-based path.
    _stub_llm_response(
        monkeypatch,
        '{"tool":"format-disk","args":{},"rationale":"why not"}',
    )
    assert app_module._classify_llm("anything") is None


def test_classify_llm_rejects_non_object_args(monkeypatch):
    # `args` must be a dict; a string is bad shape.
    _stub_llm_response(
        monkeypatch,
        '{"tool":"echo","args":"not-a-dict","rationale":"y"}',
    )
    assert app_module._classify_llm("anything") is None


def test_classify_llm_handles_non_json_content(monkeypatch):
    # Free-text content (no JSON) must be rejected without escaping the
    # ValueError out of _classify_llm.
    _stub_llm_response(monkeypatch, "Sure, here's a plan: do X then Y.")
    assert app_module._classify_llm("anything") is None


def test_classify_llm_handles_malformed_top_level_payload(monkeypatch):
    # Some misbehaving providers return 200 with a top-level list or
    # null instead of the OpenAI-shaped {choices: [...]} envelope. The
    # subscript chain `body["choices"][0]["message"]["content"]` then
    # raises TypeError, which must land in the rules-fallback path
    # rather than escape as a 500.
    monkeypatch.setattr(app_module, "LLM_BASE_URL", "http://fake")
    monkeypatch.setattr(app_module, "LLM_MODEL", "fake-model")

    for bad_body in ([], "not a dict", {"choices": None}, {"choices": [{"message": "str"}]}):
        class _R:
            _b = bad_body

            def raise_for_status(self):
                return None

            def json(self):
                return self._b

        monkeypatch.setattr(app_module.httpx, "post", lambda *a, _r=_R(), **kw: _r)
        assert app_module._classify_llm("anything") is None, bad_body


def test_command_falls_back_when_shell_inner_fails():
    # `whoami | wc -l` classifies as shell (first_word=whoami is in the
    # allow-list) but the shell tool rejects metacharacters with a
    # ValueError. Without the soft fallback, that would surface as a
    # hard error to the demo UI; with it, the input echoes back and the
    # trace explains the rejection.
    r = client.post(
        "/tools/invoke",
        json={"tool": "command", "args": {"text": "whoami | wc -l"}},
    )
    body = r.json()
    assert body["status"] == "ok", body
    assert body["result"]["chosen_tool"] == "echo"
    assert "fell back to echo" in body["result"]["rationale"]
    assert any(t["tool"] == "fallback" for t in body["trace"])


def test_command_falls_back_when_read_path_missing():
    # "read <path>" classifies into read_file; a missing path raises
    # ValueError("not a file ..."), which must land in the soft echo
    # fallback rather than a hard error.
    r = client.post(
        "/tools/invoke",
        json={"tool": "command", "args": {"text": "read does/not/exist.txt"}},
    )
    body = r.json()
    assert body["status"] == "ok"
    assert body["result"]["chosen_tool"] == "echo"
    assert any(t["tool"] == "fallback" for t in body["trace"])


def test_tool_command_fallback_handles_oserror(monkeypatch):
    # Inner tools may raise OSError subclasses (PermissionError,
    # FileNotFoundError, IsADirectoryError); they must be funneled into
    # the same echo fallback as ValueError, not bubble up as 500s.
    def _raise(*a, **kw):
        raise PermissionError(13, "Permission denied")

    monkeypatch.setattr(app_module, "_tool_read_file", _raise)
    r = client.post(
        "/tools/invoke",
        json={"tool": "command", "args": {"text": "read README.md"}},
    )
    body = r.json()
    assert body["status"] == "ok"
    assert body["result"]["chosen_tool"] == "echo"
    assert "Permission denied" in body["result"]["rationale"]
