/* ============================================================
   集思 · Delphi — 极简 Markdown 渲染（Phase 9 / ADR-0015）

   主席综合结论被要求以 Markdown 输出（machine.ts `buildChairpersonPrompt`），但插件抓到的是**纯文本**。
   这里把该 Markdown 渲染成富文本展示，让结论更易读。**不引入第三方库**（README 硬约束）：自带一个
   覆盖标题/加粗/斜体/行内代码/代码块/有序无序列表/引用/分隔线/链接的小子集解析器；先转义 HTML 再套标记，
   杜绝注入。仅用于「展示主席结论」这一处可信内容。
   ============================================================ */

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 行内标记：代码 / 链接 / 加粗 / 斜体。先按反引号切出代码段保护，其余转义后套标记。 */
function inline(raw: string): string {
  const parts = raw.split(/(`[^`]+`)/g);
  return parts
    .map((p) => {
      if (/^`[^`]+`$/.test(p)) return '<code>' + escapeHtml(p.slice(1, -1)) + '</code>';
      let t = escapeHtml(p);
      t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, a, b) => `<a href="${b}" target="_blank" rel="noopener noreferrer">${a}</a>`);
      t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
      t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>').replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');
      return t;
    })
    .join('');
}

/** 是否列表项（有序或无序）。 */
function isListItem(line: string): boolean {
  return /^(\s*)([-*+]|\d+\.)\s+/.test(line);
}

type LItem = { indent: number; ordered: boolean; text: string };

/** 把采集到的扁平列表项按缩进还原成嵌套 ul/ol。同级编号归入同一个 <ol>，浏览器自动连续计数。 */
function buildList(items: LItem[]): string {
  let idx = 0;
  const build = (): string => {
    const base = items[idx]!.indent;
    const tag = items[idx]!.ordered ? 'ol' : 'ul';
    let html = '<' + tag + '>';
    while (idx < items.length && items[idx]!.indent >= base) {
      if (items[idx]!.indent > base) {
        // 防御：理论上子项已在下方处理，这里兜底直接嵌套
        html += build();
        continue;
      }
      let li = '<li>' + inline(items[idx]!.text);
      idx++;
      if (idx < items.length && items[idx]!.indent > base) li += build();
      li += '</li>';
      html += li;
    }
    return html + '</' + tag + '>';
  };
  return build();
}

/** 把 Markdown 文本渲染为 HTML 字符串。 */
export function renderMarkdown(md: string): string {
  const lines = (md || '').replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;

  const closeOpen = () => {};
  void closeOpen;

  while (i < lines.length) {
    const line = lines[i]!;

    // 代码块 ``` ```
    const fence = line.match(/^\s*```(.*)$/);
    if (fence) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i]!)) {
        buf.push(lines[i]!);
        i++;
      }
      i++; // 跳过结尾 ```
      out.push('<pre><code>' + escapeHtml(buf.join('\n')) + '</code></pre>');
      continue;
    }

    // 空行
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    // 分隔线
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push('<hr />');
      i++;
      continue;
    }

    // 标题
    const h = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1]!.length;
      out.push(`<h${level}>${inline(h[2]!.trim())}</h${level}>`);
      i++;
      continue;
    }

    // 引用块
    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i]!)) {
        buf.push(lines[i]!.replace(/^\s*>\s?/, ''));
        i++;
      }
      out.push('<blockquote>' + inline(buf.join(' ')) + '</blockquote>');
      continue;
    }

    // 列表（有序/无序，支持按缩进嵌套、跨空行延续）
    if (isListItem(line)) {
      const items: LItem[] = [];
      while (i < lines.length) {
        if (isListItem(lines[i]!)) {
          const m = lines[i]!.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/)!;
          items.push({ indent: m[1]!.length, ordered: /\d/.test(m[2]!), text: m[3]! });
          i++;
        } else if (/^\s*$/.test(lines[i]!) && i + 1 < lines.length && isListItem(lines[i + 1]!)) {
          i++; // 跳过列表项之间的空行，保持同一列表连续
        } else {
          break;
        }
      }
      out.push(buildList(items));
      continue;
    }

    // 段落：连续非空、非块级行合并，组内换行用 <br>
    const buf: string[] = [];
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]!) &&
      !/^\s*(#{1,6})\s+/.test(lines[i]!) &&
      !/^\s*[-*+]\s+/.test(lines[i]!) &&
      !/^\s*\d+\.\s+/.test(lines[i]!) &&
      !/^\s*>\s?/.test(lines[i]!) &&
      !/^\s*```/.test(lines[i]!) &&
      !/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i]!)
    ) {
      buf.push(inline(lines[i]!.trim()));
      i++;
    }
    out.push('<p>' + buf.join('<br />') + '</p>');
  }

  return out.join('\n');
}

/** Markdown 富文本展示组件（套 .dx-md 类，样式在 index.html）。 */
export function Markdown({ text, style }: { text: string; style?: React.CSSProperties }) {
  return <div className="dx-md" style={style} dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />;
}
