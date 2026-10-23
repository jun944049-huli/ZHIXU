/* Shared by the desktop response boundary and historical message rendering. */
(function () {
  function display(value) {
    let text = String(value || '').trim();
    if (text.startsWith('{')) {
      try {
        const data = JSON.parse(text);
        if (typeof data.reply === 'string' && Array.isArray(data.actions)) text = data.reply;
      } catch { /* Only the trailing protocol fragment is recoverable here. */ }
    }
    const leaked = !text.includes('```') && /["”]\s*[,，]\s*["“]actions["”]\s*:\s*\[[\s\S]*\]\s*}\s*$/.test(text);
    if (leaked) {
      text = text.replace(/["”]\s*[,，]\s*["“]actions["”]\s*:[\s\S]*$/, '');
      text = text.replace(/^\s*(?:\{\s*)?["“]?reply["”]?\s*:\s*["“]?/, '');
    }
    if (leaked || !text.includes('\n') && /\\n(?:\\n|\s*[-*•]|\s*[\u3400-\u9fff])/.test(text)) {
      text = text.split(/(```[\s\S]*?```|`[^`\n]*`)/g).map((part, index) => index % 2 ? part :
        part.replace(/\\r\\n|\\n/g, '\n').replace(/\\"/g, '"')).join('');
    }
    return text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function parse(value) {
    let text = String(value || '').trim();
    const warnings = [];
    for (let layer = 0; layer < 3; layer++) {
      try {
        const data = JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim());
        if (typeof data === 'string') { text = data; continue; }
        if (data && typeof data.reply === 'string' && data.reply.trim()) {
          if (data.actions !== undefined && !Array.isArray(data.actions)) warnings.push('模型动作格式无效，未执行操作。');
          return { reply: display(data.reply), actions: Array.isArray(data.actions) ? data.actions : [], warnings };
        }
      } catch { /* Look for a complete envelope surrounded by commentary. */ }
      const quoted = text.match(/"(?:\\.|[^"\\])*"\s*$/);
      if (quoted) {
        try {
          const decoded = JSON.parse(quoted[0]);
          if (typeof decoded === 'string' && decoded.trimStart().startsWith('{') && decoded.includes('"reply"')) {
            text = decoded; continue;
          }
        } catch { /* Not an encoded envelope. */ }
      }
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start >= 0 && end > start && (start > 0 || end < text.length - 1)) {
        const candidate = text.slice(start, end + 1);
        try {
          const data = JSON.parse(candidate);
          if (data && typeof data.reply === 'string' && data.reply.trim()) { text = candidate; continue; }
        } catch { /* Malformed envelopes never provide executable actions. */ }
      }
      break;
    }
    const structured = /(?:^```|^\s*\{|["“]reply["”]\s*:|["”]\s*,\s*["“]actions["”]\s*:)/.test(text);
    if (structured) {
      // Recover only a complete reply string. Never recover actions from broken JSON.
      const match = text.match(/"reply"\s*:\s*("(?:\\.|[^"\\])*")/);
      let reply = '';
      if (match) { try { reply = display(JSON.parse(match[1])); } catch { /* handled below */ } }
      else if (!text.trimStart().startsWith('{')) reply = display(text);
      if (!reply || reply === text) throw new Error('模型返回的指令结构不完整，请重试；尚未执行任何操作');
      return { reply, actions: [], warnings: ['回复结构异常，已保留可读内容；尚未执行任何操作，请重试。'] };
    }
    return { reply: display(text), actions: [], warnings };
  }
  globalThis.ZhixuChatFormatting = Object.freeze({ display, parse });
})();
