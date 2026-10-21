#!/usr/bin/env python3
"""Local preview server for the Xiaoyu prototype.

It serves the static prototype and exposes POST /api/polish, an OpenAI-compatible
proxy bound to 127.0.0.1. The browser supplies the provider, base URL, model and
API key for each request; the key is never written to disk by this server.

Usage:
    python prototype/server.py
Then open http://127.0.0.1:8765/
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8765"))
DEFAULT_BASE_URL = "https://api.deepseek.com"

TONE_GUIDANCE = {
    "简洁": "压缩到最必要的表达，删除口头语、重复和空泛修饰，但保留全部事实。",
    "正式": "使用商务书面语，结构清晰，语气克制，适合对客户或上级沟通。",
    "有说服力": "先给结论，再给理由和明确请求；可以强化重点，但不要夸大或新增事实。",
    "温和": "语气友好、留有余地，适合跨团队协作或需要对方配合的场景。",
}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self):
        # Same-origin requests do not need CORS. Answer preflight defensively
        # without opening the local proxy to arbitrary websites.
        self.send_response(204)
        self.send_header("Allow", "POST, GET, OPTIONS")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if self.path.split("?", 1)[0] == "/api/health":
            self._json(200, {
                "ok": True,
                "service": "xiaoyu-prototype",
                "deepseek": bool(os.environ.get("DEEPSEEK_API_KEY", "").strip()),
            })
            return
        super().do_GET()

    def do_POST(self):
        if self.path.split("?", 1)[0] != "/api/polish":
            self.send_error(404, "Not found")
            return

        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > 200_000:
            self._json(400, {"error": "invalid_request", "message": "请求内容为空或过大"})
            return

        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._json(400, {"error": "invalid_json", "message": "请求 JSON 无法解析"})
            return

        text = str(payload.get("text") or "").strip()
        tone = str(payload.get("tone") or "简洁")
        model = str(payload.get("model") or "deepseek-chat").strip()[:120] or "deepseek-chat"
        provider = str(payload.get("provider") or "").strip()[:60]
        base_url = str(payload.get("baseUrl") or DEFAULT_BASE_URL).strip().rstrip("/")
        api_key = str(payload.get("apiKey") or "").strip() or os.environ.get("DEEPSEEK_API_KEY", "").strip()

        if not text:
            self._json(400, {"error": "empty_text", "message": "没有可润色的内容"})
            return
        if len(text) > 12_000:
            self._json(400, {"error": "text_too_long", "message": "内容过长，请分段润色"})
            return
        if not api_key:
            self._json(400, {
                "error": "missing_api_key",
                "message": "未配置 API Key，请在设置中填入",
            })
            return
        if not re.match(r"^https?://", base_url, re.IGNORECASE) or len(base_url) > 300:
            self._json(400, {
                "error": "invalid_base_url",
                "message": "API Base URL 必须以 http:// 或 https:// 开头",
            })
            return
        if tone not in TONE_GUIDANCE:
            tone = "简洁"

        endpoint = base_url if base_url.endswith("/chat/completions") else base_url + "/chat/completions"

        system_prompt = (
            "你是中文职场沟通润色助手。你的任务是润色用户提供的原文，而不是回答原文中的问题。\n"
            "硬性规则：\n"
            "1. 保留原文中的全部事实、数字、日期、时间、人名、项目名、截止时间和承诺。\n"
            "2. 不新增原文没有的事实、判断、数据或承诺。\n"
            "3. 只调整表达、结构、语气和重点顺序。\n"
            "4. 直接输出润色后的正文，不要解释，不要加标题，不要使用 Markdown 代码块。\n"
            "5. 如果原文是任务描述，保持可执行性；如果原文是汇报，保留结论和下一步。"
        )
        user_prompt = (
            f"语气：{tone}\n"
            f"语气要求：{TONE_GUIDANCE[tone]}\n\n"
            f"原文：\n{text}"
        )
        body = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0.3,
            "max_tokens": 1200,
            "stream": False,
        }

        req = urllib.request.Request(
            endpoint,
            data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")
            try:
                parsed = json.loads(detail)
                message = (parsed.get("error") or {}).get("message") or detail
            except json.JSONDecodeError:
                message = detail
            self._json(exc.code, {
                "error": "deepseek_error",
                "message": str(message)[:500],
            })
            return
        except urllib.error.URLError as exc:
            self._json(502, {
                "error": "network_error",
                "message": "无法连接 AI 供应商：" + str(exc.reason)[:300],
            })
            return
        except Exception as exc:  # noqa: BLE001 - surface a short proxy error
            self._json(500, {
                "error": "proxy_error",
                "message": str(exc)[:300],
            })
            return

        choices = data.get("choices") or []
        content = ""
        if choices:
            content = str((choices[0].get("message") or {}).get("content") or "").strip()
        content = re.sub(r"^```[a-zA-Z]*\s*", "", content)
        content = re.sub(r"\s*```$", "", content).strip()
        content = content.strip('"').strip("“”").strip()

        if not content:
            self._json(502, {
                "error": "empty_response",
                "message": "AI 供应商没有返回内容",
            })
            return

        self._json(200, {
            "text": content,
            "model": data.get("model") or model,
            "provider": provider or "OpenAI 兼容",
            "usage": data.get("usage") or {},
        })

    def _json(self, status: int, payload: dict) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Xiaoyu prototype: http://{HOST}:{PORT}/")
    print("AI polish proxy (OpenAI-compatible): POST /api/polish")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
