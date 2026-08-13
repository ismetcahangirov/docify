#!/usr/bin/env node
/**
 * PostToolUse hook — records a compact observation for every meaningful tool call.
 *
 * Stores metadata only (which file, which command), never file contents.
 * Exits 0 unconditionally: a memory failure must never block the session.
 */

import { readStdin, recordObservation, shouldRecord, describeToolCall } from './lib/store.mjs'

try {
  const input = await readStdin()
  const toolName = input.tool_name

  if (shouldRecord(toolName)) {
    const { kind, target, summary } = describeToolCall(toolName, input.tool_input || {})
    const response = input.tool_response ?? {}
    const failed = response.success === false || Boolean(response.error)

    recordObservation(input.session_id, { tool: toolName, kind, target, summary, failed })
  }
} catch {
  // Memory is best-effort. Never surface an error to the session.
}

process.exit(0)
