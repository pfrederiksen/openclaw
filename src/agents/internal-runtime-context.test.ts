import { describe, expect, it } from "vitest";
import {
  escapeInternalRuntimeContextDelimiters,
  hasInternalRuntimeContext,
  INTERNAL_RUNTIME_CONTEXT_BEGIN,
  INTERNAL_RUNTIME_CONTEXT_END,
  stripInternalRuntimeContext,
} from "./internal-runtime-context.js";

function createDeterministicRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

describe("internal runtime context codec", () => {
  it("strips a marked internal runtime block and preserves surrounding text", () => {
    const input = [
      "Visible intro",
      "",
      INTERNAL_RUNTIME_CONTEXT_BEGIN,
      "OpenClaw runtime context (internal):",
      "This context is runtime-generated, not user-authored. Keep internal details private.",
      "",
      "[Internal task completion event]",
      "source: subagent",
      INTERNAL_RUNTIME_CONTEXT_END,
      "",
      "Visible outro",
    ].join("\n");

    expect(stripInternalRuntimeContext(input)).toBe("Visible intro\n\nVisible outro");
  });

  it("detects canonical runtime context and ignores inline marker mentions", () => {
    expect(
      hasInternalRuntimeContext(
        `${INTERNAL_RUNTIME_CONTEXT_BEGIN}\ninternal\n${INTERNAL_RUNTIME_CONTEXT_END}`,
      ),
    ).toBe(true);
    expect(
      hasInternalRuntimeContext(
        `Inline token ${INTERNAL_RUNTIME_CONTEXT_BEGIN} should not count as a block marker.`,
      ),
    ).toBe(false);
  });

  it("fuzzes delimiter injection and nested marker handling deterministically", () => {
    const rng = createDeterministicRng(0xc0ff_ee42);
    const tokenPool = [
      "plain output line",
      "status: ok",
      `inline ${INTERNAL_RUNTIME_CONTEXT_BEGIN} mention`,
      `inline ${INTERNAL_RUNTIME_CONTEXT_END} mention`,
      INTERNAL_RUNTIME_CONTEXT_BEGIN,
      INTERNAL_RUNTIME_CONTEXT_END,
      "more details",
    ];

    for (let index = 0; index < 120; index++) {
      const lineCount = 4 + Math.floor(rng() * 12);
      const payloadLines: string[] = [];
      for (let i = 0; i < lineCount; i++) {
        const token = tokenPool[Math.floor(rng() * tokenPool.length)];
        payloadLines.push(token);
      }
      const escapedPayload = payloadLines.map((line) =>
        escapeInternalRuntimeContextDelimiters(line),
      );

      const visible = `Visible reply ${index}`;
      const wrapped = [
        INTERNAL_RUNTIME_CONTEXT_BEGIN,
        ...escapedPayload,
        INTERNAL_RUNTIME_CONTEXT_END,
        "",
        visible,
      ].join("\n");

      const stripped = stripInternalRuntimeContext(wrapped);
      expect(stripped).toBe(visible);
      expect(stripped).not.toContain(INTERNAL_RUNTIME_CONTEXT_BEGIN);
      expect(stripped).not.toContain(INTERNAL_RUNTIME_CONTEXT_END);
    }
  });

  it("strips generated metadata, async wrappers, and exec state sections", () => {
    const input = [
      "OpenClaw runtime context for the immediately preceding user message.",
      "This context is runtime-generated, not user-authored. Keep internal details private.",
      "",
      "## Conversation Info",
      "```json",
      '{"message_id":"123"}',
      "```",
      "",
      "## Thread Starter Message",
      "starter details",
      "",
      "## Forwarded Message Context",
      "```json",
      '{"from":"alice"}',
      "```",
      "",
      "Location Context (untrusted metadata):",
      "```json",
      '{"latitude":1}',
      "```",
      "",
      "## Current Exec Session State",
      "Current session exec defaults: host=host security=workspace-write.",
      "Current elevated level: off.",
      "If the user asks to run a command, use the current exec state above.",
      "",
      "An async command you ran earlier completed without captured stdout/stderr. The completion details are:",
      "",
      "Exec failed (abc123, code 1) without captured stdout/stderr.",
      "",
      "Tell the user the command completed without captured output and include the exit status or signal.",
      "",
      "Visible answer",
    ].join("\n");

    expect(stripInternalRuntimeContext(input)).toBe("Visible answer");
  });

  it("preserves standalone json replies after stripping runtime context preface", () => {
    const input = [
      "OpenClaw runtime context for the immediately preceding user message.",
      "This context is runtime-generated, not user-authored. Keep internal details private.",
      "",
      '{"ok":true}',
    ].join("\n");

    expect(stripInternalRuntimeContext(input)).toBe('{"ok":true}');
  });
});
