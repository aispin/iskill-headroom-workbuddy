/**
 * 复制文本到剪贴板。
 *
 * 为什么要三级降级：`navigator.clipboard` 只在**安全上下文**且**拥有 clipboard-write
 * 权限**时才可用。控制台经常被嵌在预览面板的 iframe 里——此时 Permissions Policy
 * 默认只给同源框 `clipboard-write`，`writeText()` 会直接 reject。旧版
 * `document.execCommand("copy")` 不受这条策略管辖（只要求用户手势），所以兜住它。
 *
 * @param text   要复制的文本
 * @param anchor 全部失败时用于**选中文本**的节点，让用户还能手动 ⌘C / Ctrl+C
 * @returns true = 已写入剪贴板；false = 只做到了选中，需用户手动复制
 */
export async function copyText(text: string, anchor?: HTMLElement | null): Promise<boolean> {
  if (!text) return false;

  // ① 现代 Clipboard API
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 落到下一级 */
  }

  // ② execCommand 兜底
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    // 须留在视口内，否则 iOS 会拒绝建立选区；用 1px + 透明隐藏而不是 display:none
    ta.style.cssText =
      "position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;" +
      "outline:0;box-shadow:none;background:transparent;opacity:0;";
    document.body.appendChild(ta);

    const sel = document.getSelection();
    const prev = sel && sel.rangeCount ? sel.getRangeAt(0) : null;

    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");

    ta.remove();
    if (sel && prev) {
      sel.removeAllRanges();
      sel.addRange(prev);
    }
    if (ok) return true;
  } catch {
    /* 落到下一级 */
  }

  // ③ 选中原文，至少让用户能手动复制
  if (anchor) selectText(anchor);
  return false;
}

/** 选中某个节点的全部文本。 */
export function selectText(el: HTMLElement): void {
  try {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = document.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
  } catch {
    /* 忽略 */
  }
}
