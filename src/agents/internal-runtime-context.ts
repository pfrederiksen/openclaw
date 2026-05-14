export const INTERNAL_RUNTIME_CONTEXT_BEGIN = "<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>";
export const INTERNAL_RUNTIME_CONTEXT_END = "<<<END_OPENCLAW_INTERNAL_CONTEXT>>>";

const ESCAPED_INTERNAL_RUNTIME_CONTEXT_BEGIN = "[[OPENCLAW_INTERNAL_CONTEXT_BEGIN]]";
const ESCAPED_INTERNAL_RUNTIME_CONTEXT_END = "[[OPENCLAW_INTERNAL_CONTEXT_END]]";

export const OPENCLAW_RUNTIME_CONTEXT_NOTICE =
  "This context is runtime-generated, not user-authored. Keep internal details private.";
export const OPENCLAW_NEXT_TURN_RUNTIME_CONTEXT_HEADER =
  "OpenClaw runtime context for the immediately preceding user message.";
export const OPENCLAW_RUNTIME_EVENT_HEADER = "OpenClaw runtime event.";
export const OPENCLAW_RUNTIME_CONTEXT_CUSTOM_TYPE = "openclaw.runtime-context";

const LEGACY_INTERNAL_CONTEXT_HEADER =
  ["OpenClaw runtime context (internal):", OPENCLAW_RUNTIME_CONTEXT_NOTICE, ""].join("\n") + "\n";

const LEGACY_INTERNAL_EVENT_MARKER = "[Internal task completion event]";
const LEGACY_INTERNAL_EVENT_SEPARATOR = "\n\n---\n\n";
const LEGACY_UNTRUSTED_RESULT_BEGIN = "<<<BEGIN_UNTRUSTED_CHILD_RESULT>>>";
const LEGACY_UNTRUSTED_RESULT_END = "<<<END_UNTRUSTED_CHILD_RESULT>>>";

export function escapeInternalRuntimeContextDelimiters(value: string): string {
  return value
    .replaceAll(INTERNAL_RUNTIME_CONTEXT_BEGIN, ESCAPED_INTERNAL_RUNTIME_CONTEXT_BEGIN)
    .replaceAll(INTERNAL_RUNTIME_CONTEXT_END, ESCAPED_INTERNAL_RUNTIME_CONTEXT_END);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findDelimitedTokenIndex(text: string, token: string, from: number): number {
  const tokenRe = new RegExp(`(?:^|\\r?\\n)${escapeRegExp(token)}(?=\\r?\\n|$)`, "g");
  tokenRe.lastIndex = Math.max(0, from);
  const match = tokenRe.exec(text);
  if (!match) {
    return -1;
  }
  const prefixLength = match[0].length - token.length;
  return match.index + prefixLength;
}

function stripDelimitedBlock(text: string, begin: string, end: string): string {
  let next = text;
  for (;;) {
    const start = findDelimitedTokenIndex(next, begin, 0);
    if (start === -1) {
      return next;
    }

    let cursor = start + begin.length;
    let depth = 1;
    let finish = -1;
    while (depth > 0) {
      const nextBegin = findDelimitedTokenIndex(next, begin, cursor);
      const nextEnd = findDelimitedTokenIndex(next, end, cursor);
      if (nextEnd === -1) {
        break;
      }
      if (nextBegin !== -1 && nextBegin < nextEnd) {
        depth += 1;
        cursor = nextBegin + begin.length;
        continue;
      }
      depth -= 1;
      finish = nextEnd;
      cursor = nextEnd + end.length;
    }

    const before = next.slice(0, start).trimEnd();
    if (finish === -1 || depth !== 0) {
      return before;
    }
    const after = next.slice(finish + end.length).trimStart();
    next = before && after ? `${before}\n\n${after}` : `${before}${after}`;
  }
}

function findLegacyInternalEventEnd(text: string, start: number): number | null {
  if (!text.startsWith(LEGACY_INTERNAL_EVENT_MARKER, start)) {
    return null;
  }

  const resultBegin = text.indexOf(
    LEGACY_UNTRUSTED_RESULT_BEGIN,
    start + LEGACY_INTERNAL_EVENT_MARKER.length,
  );
  if (resultBegin === -1) {
    return null;
  }

  const resultEnd = text.indexOf(
    LEGACY_UNTRUSTED_RESULT_END,
    resultBegin + LEGACY_UNTRUSTED_RESULT_BEGIN.length,
  );
  if (resultEnd === -1) {
    return null;
  }

  const actionIndex = text.indexOf("\n\nAction:\n", resultEnd + LEGACY_UNTRUSTED_RESULT_END.length);
  if (actionIndex === -1) {
    return null;
  }

  const afterAction = actionIndex + "\n\nAction:\n".length;
  const nextEvent = text.indexOf(
    `${LEGACY_INTERNAL_EVENT_SEPARATOR}${LEGACY_INTERNAL_EVENT_MARKER}`,
    afterAction,
  );
  if (nextEvent !== -1) {
    return nextEvent;
  }

  const nextParagraph = text.indexOf("\n\n", afterAction);
  return nextParagraph === -1 ? text.length : nextParagraph;
}

function stripLegacyInternalRuntimeContext(text: string): string {
  let next = text;
  let searchFrom = 0;
  for (;;) {
    const headerStart = next.indexOf(LEGACY_INTERNAL_CONTEXT_HEADER, searchFrom);
    if (headerStart === -1) {
      return next;
    }

    const eventStart = headerStart + LEGACY_INTERNAL_CONTEXT_HEADER.length;
    if (!next.startsWith(LEGACY_INTERNAL_EVENT_MARKER, eventStart)) {
      searchFrom = eventStart;
      continue;
    }

    let blockEnd = findLegacyInternalEventEnd(next, eventStart);
    if (blockEnd == null) {
      const nextParagraph = next.indexOf("\n\n", eventStart + LEGACY_INTERNAL_EVENT_MARKER.length);
      blockEnd = nextParagraph === -1 ? next.length : nextParagraph;
    } else {
      while (
        next.startsWith(
          `${LEGACY_INTERNAL_EVENT_SEPARATOR}${LEGACY_INTERNAL_EVENT_MARKER}`,
          blockEnd,
        )
      ) {
        const nextEventStart = blockEnd + LEGACY_INTERNAL_EVENT_SEPARATOR.length;
        const nextEventEnd = findLegacyInternalEventEnd(next, nextEventStart);
        if (nextEventEnd == null) {
          break;
        }
        blockEnd = nextEventEnd;
      }
    }

    const before = next.slice(0, headerStart).trimEnd();
    const after = next.slice(blockEnd).trimStart();
    next = before && after ? `${before}\n\n${after}` : `${before}${after}`;
    searchFrom = Math.max(0, before.length - 1);
  }
}

function isRuntimeContextPromptHeader(line: string): boolean {
  return (
    line === OPENCLAW_NEXT_TURN_RUNTIME_CONTEXT_HEADER || line === OPENCLAW_RUNTIME_EVENT_HEADER
  );
}

const RUNTIME_METADATA_SECTION_LABELS = new Set([
  "Conversation Info",
  "Sender Metadata",
  "Replied-to Message",
  "Inbound Context",
  "Thread Starter Message",
  "Forwarded Message Context",
  "Location Context",
  "Current message",
]);

function readParagraph(text: string, start: number): { text: string; end: number } {
  const normalizedStart = Math.max(0, start);
  let cursor = normalizedStart;
  while (cursor < text.length && /[\t ]/.test(text[cursor] ?? "")) {
    cursor += 1;
  }
  const separatorMatch = /\r?\n\r?\n/g;
  separatorMatch.lastIndex = cursor;
  const match = separatorMatch.exec(text);
  const end = match ? match.index : text.length;
  return { text: text.slice(cursor, end).trim(), end };
}

function isStructuredPayloadParagraph(paragraph: string): boolean {
  const trimmed = paragraph.trim();
  return /^```(?:json|text)?\s*[\s\S]*```$/i.test(trimmed) || /^[\[{][\s\S]*[\]}]$/.test(trimmed);
}

function consumeBlankLines(text: string, start: number): number {
  const match = /^(?:[\t ]*\r?\n)+/.exec(text.slice(start));
  return match ? start + match[0].length : start;
}

function consumeMetadataSection(text: string, start: number): number | null {
  const paragraph = readParagraph(text, start);
  const lines = paragraph.text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return null;
  }
  const heading = lines[0]?.replace(/^##\s*/, "") ?? "";
  if (!RUNTIME_METADATA_SECTION_LABELS.has(heading) && !heading.endsWith("(untrusted metadata):")) {
    return null;
  }
  let cursor = paragraph.end;
  const nextParagraphStart = consumeBlankLines(text, cursor);
  if (nextParagraphStart > cursor) {
    const nextParagraph = readParagraph(text, nextParagraphStart);
    if (isStructuredPayloadParagraph(nextParagraph.text)) {
      cursor = nextParagraph.end;
    }
  }
  return cursor;
}

function consumeAsyncEventSection(text: string, start: number): number | null {
  const paragraph = readParagraph(text, start);
  const normalized = paragraph.text;
  if (!normalized) {
    return null;
  }
  const isHeading =
    normalized.startsWith(
      "An async command completion event was triggered, but no command output was found.",
    ) ||
    normalized.startsWith(
      "An async command completion event was triggered, but user delivery is disabled for this run.",
    ) ||
    normalized.startsWith(
      "An async command you ran earlier completed without captured stdout/stderr. The completion details are:",
    ) ||
    normalized.startsWith(
      "An async command you ran earlier has completed. The command completion details are:",
    );
  if (!isHeading) {
    return null;
  }

  let cursor = paragraph.end;
  for (;;) {
    const nextStart = consumeBlankLines(text, cursor);
    if (nextStart === cursor) {
      return cursor;
    }
    const nextParagraph = readParagraph(text, nextStart);
    const nextText = nextParagraph.text;
    if (
      nextText.startsWith("Exec completed (") ||
      nextText.startsWith("Exec failed (") ||
      nextText.startsWith("Please relay the command output to the user in a helpful way.") ||
      nextText.startsWith("If the command succeeded, share the relevant output.") ||
      nextText.startsWith("Tell the user the command completed without captured output") ||
      nextText.startsWith("Do not ask the user to provide missing logs")
    ) {
      cursor = nextParagraph.end;
      continue;
    }
    return cursor;
  }
}

function consumeExecStateSection(text: string, start: number): number | null {
  const paragraph = readParagraph(text, start);
  const lines = paragraph.text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return null;
  }
  const heading = lines[0]?.replace(/^##\s*/, "") ?? "";
  if (heading !== "Current Exec Session State") {
    return null;
  }
  return paragraph.end;
}

function stripRuntimeContextPromptPreface(text: string): string {
  const lines = text.split(/\r?\n/);
  let changed = false;
  const output: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const nextLine = lines[index + 1] ?? "";
    if (
      isRuntimeContextPromptHeader(line.trim()) &&
      nextLine.trim() === OPENCLAW_RUNTIME_CONTEXT_NOTICE
    ) {
      changed = true;
      index += 1;
      while (index + 1 < lines.length && (lines[index + 1] ?? "").trim() === "") {
        index += 1;
      }
      continue;
    }
    output.push(line);
  }

  let stripped = changed
    ? output
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    : text;

  let cursor = 0;
  let rebuilt = "";
  let sectionChanged = false;
  while (cursor < stripped.length) {
    const metadataEnd = consumeMetadataSection(stripped, cursor);
    const asyncEnd = metadataEnd == null ? consumeAsyncEventSection(stripped, cursor) : null;
    const execStateEnd =
      metadataEnd == null && asyncEnd == null ? consumeExecStateSection(stripped, cursor) : null;
    const sectionEnd = metadataEnd ?? asyncEnd ?? execStateEnd;
    if (sectionEnd != null) {
      sectionChanged = true;
      cursor = consumeBlankLines(stripped, sectionEnd);
      continue;
    }
    rebuilt += stripped[cursor] ?? "";
    cursor += 1;
  }

  return sectionChanged ? rebuilt.replace(/\n{3,}/g, "\n\n").trim() : stripped;
}

export function stripInternalRuntimeContext(text: string): string {
  if (!text) {
    return text;
  }
  const withoutDelimitedBlocks = stripDelimitedBlock(
    text,
    INTERNAL_RUNTIME_CONTEXT_BEGIN,
    INTERNAL_RUNTIME_CONTEXT_END,
  );
  return stripRuntimeContextPromptPreface(
    stripLegacyInternalRuntimeContext(withoutDelimitedBlocks),
  );
}

export function hasInternalRuntimeContext(text: string): boolean {
  if (!text) {
    return false;
  }
  return (
    findDelimitedTokenIndex(text, INTERNAL_RUNTIME_CONTEXT_BEGIN, 0) !== -1 ||
    text.includes(LEGACY_INTERNAL_CONTEXT_HEADER) ||
    text.includes(
      `${OPENCLAW_NEXT_TURN_RUNTIME_CONTEXT_HEADER}\n${OPENCLAW_RUNTIME_CONTEXT_NOTICE}`,
    ) ||
    text.includes(`${OPENCLAW_RUNTIME_EVENT_HEADER}\n${OPENCLAW_RUNTIME_CONTEXT_NOTICE}`)
  );
}

function isOpenClawRuntimeContextCustomMessage(message: unknown): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }
  const candidate = message as { role?: unknown; customType?: unknown };
  return (
    candidate.role === "custom" && candidate.customType === OPENCLAW_RUNTIME_CONTEXT_CUSTOM_TYPE
  );
}

export function stripRuntimeContextCustomMessages<T>(messages: T[]): T[] {
  if (!messages.some(isOpenClawRuntimeContextCustomMessage)) {
    return messages;
  }
  return messages.filter((message) => !isOpenClawRuntimeContextCustomMessage(message));
}

function isUserMessage(message: unknown): boolean {
  return Boolean(
    message && typeof message === "object" && (message as { role?: unknown }).role === "user",
  );
}

/** Removes stale runtime-context custom messages while preserving current-turn context. */
export function stripHistoricalRuntimeContextCustomMessages<T>(messages: T[]): T[] {
  if (!messages.some(isOpenClawRuntimeContextCustomMessage)) {
    return messages;
  }
  const lastUserIndex = messages.findLastIndex(isUserMessage);
  if (lastUserIndex === -1) {
    return messages.filter((message) => !isOpenClawRuntimeContextCustomMessage(message));
  }
  return messages.filter(
    (message, index) => !isOpenClawRuntimeContextCustomMessage(message) || index > lastUserIndex,
  );
}
