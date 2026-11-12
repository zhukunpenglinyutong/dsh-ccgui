#!/usr/bin/env node
// A scripted ACP agent speaking JSON-RPC over stdio, written from the public ACP
// spec. The prompt text selects a scenario:
//   WRITE <file>   ask permission, then create the file
//   AUTO <file>    create the file without asking
//   READ           run a read tool that reports no permission request
//   HANG           run until session/cancel
//   CRASH          exit with code 3
//   WHICH MODEL    report the selected model
//   anything else  echo the prompt
// Every turn reports the same token usage, as real CLIs do; the plugin does not forward it.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const capabilities = {
  loadSession: true,
  sessionCapabilities: { resume: {}, delete: {}, close: {} },
}
const sessions = new Map()
let currentModel = 'fake-small'
let currentMode = 'default'
const TURN_USAGE = { totalTokens: 1200, inputTokens: 150, outputTokens: 50, cachedReadTokens: 1000 }
const configOptions = () => [
  {
    id: 'model',
    name: 'Model',
    category: 'model',
    type: 'select',
    currentValue: currentModel,
    options: [
      { value: 'fake-small', name: 'Fake Small' },
      { value: 'fake-large', name: 'Fake Large' },
    ],
  },
  {
    id: 'mode',
    name: 'Mode',
    category: 'mode',
    type: 'select',
    currentValue: currentMode,
    options: [
      { value: 'default', name: 'Default' },
      { value: 'plan', name: 'Plan' },
    ],
  },
]
const waiting = new Map()
let nextRequestId = 1000
let nextToolId = 1
let cancelTurn

const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
const respond = (id, result) => send({ id, result })
const update = (sessionId, body) => send({ method: 'session/update', params: { sessionId, update: body } })
const say = (sessionId, text) =>
  update(sessionId, {
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text },
  })

function request(method, params) {
  const id = nextRequestId++
  send({ id, method, params })
  return new Promise((resolve) => waiting.set(id, resolve))
}

async function writeWithPermission(sessionId, file) {
  const toolCallId = `tool-${nextToolId++}`
  const path = join(sessions.get(sessionId).cwd, file)
  update(sessionId, {
    sessionUpdate: 'tool_call',
    toolCallId,
    title: 'write',
    kind: 'edit',
    status: 'pending',
    rawInput: {},
  })
  update(sessionId, {
    sessionUpdate: 'tool_call_update',
    toolCallId,
    status: 'in_progress',
    rawInput: { path, content: 'hi\n' },
    locations: [{ path }],
  })
  const { outcome } = await request('session/request_permission', {
    sessionId,
    toolCall: {
      toolCallId,
      title: path,
      kind: 'edit',
      status: 'pending',
      content: [{ type: 'diff', path, oldText: null, newText: 'hi\n' }],
    },
    options: [
      { optionId: 'once', name: 'Allow once', kind: 'allow_once' },
      { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
    ],
  })
  if (outcome.outcome === 'cancelled') return 'cancelled'
  if (outcome.optionId !== 'once') {
    update(sessionId, {
      sessionUpdate: 'tool_call_update',
      toolCallId,
      status: 'failed',
      rawOutput: 'rejected by user',
    })
    say(sessionId, 'The write was rejected.')
    return 'end_turn'
  }
  writeFileSync(path, 'hi\n')
  update(sessionId, {
    sessionUpdate: 'tool_call_update',
    toolCallId,
    status: 'completed',
    content: [{ type: 'content', content: { type: 'text', text: `Created ${file}` } }],
  })
  say(sessionId, 'done')
  return 'end_turn'
}

function writeWithoutAsking(sessionId, file) {
  const toolCallId = `tool-${nextToolId++}`
  const path = join(sessions.get(sessionId).cwd, file)
  update(sessionId, {
    sessionUpdate: 'tool_call',
    toolCallId,
    title: 'write',
    kind: 'edit',
    status: 'in_progress',
    rawInput: { path },
  })
  writeFileSync(path, 'hi\n')
  update(sessionId, {
    sessionUpdate: 'tool_call_update',
    toolCallId,
    status: 'completed',
    rawOutput: { output: `Created ${file}` },
  })
  say(sessionId, 'done')
  return 'end_turn'
}

function readTool(sessionId) {
  const toolCallId = `tool-${nextToolId++}`
  update(sessionId, {
    sessionUpdate: 'tool_call',
    toolCallId,
    title: 'cat a.txt',
    kind: 'execute',
    status: 'in_progress',
    rawInput: { command: 'cat a.txt' },
  })
  update(sessionId, {
    sessionUpdate: 'tool_call_update',
    toolCallId,
    status: 'completed',
    content: [{ type: 'content', content: { type: 'text', text: 'contents' } }],
  })
  // Deliberately no text afterwards: the final harness step then has no blocks.
  return 'end_turn'
}

function hang(sessionId) {
  say(sessionId, 'working')
  return new Promise((resolve) => {
    cancelTurn = () => resolve('cancelled')
  })
}

// What CodeBuddy actually returns for an exhausted free-model quota: a stringified
// JSON-RPC error on `codebuddy.ai/errorMessage`, plus ids that are not a reason.
const QUOTA_MESSAGE =
  '当前您在Hy4模型的免费使用量已超出频率限制，可在2026-11-12 12:21:09重置后使用。您可消耗积分继续使用该模型或切换至其他模型。'

function runPrompt(sessionId, text) {
  if (text.trim() === 'WHICH MODEL') {
    say(sessionId, `model=${currentModel}`)
    return 'end_turn'
  }
  if (text.trim().startsWith('REFUSE')) {
    // Real CLIs refuse without streaming a word. Three shapes: the reason on stderr,
    // the reason attached as a stringified request error, and a telemetry dump with
    // no reason at all (which must fall back to the plain failure, not to the dump).
    if (text.includes('NOISE')) {
      process.stderr.write(
        `${JSON.stringify({ traceparent: '00-78d02baf', 'codebuddy.ai/outcome': 'FAILED_MODEL_REQUEST' })}\n`,
      )
    } else if (!text.includes('META')) {
      process.stderr.write('codebuddy: quota exceeded for hy4-free\n')
    }
    return 'refusal'
  }
  if (text.trim() === 'WHICH MODE') {
    say(sessionId, `mode=${currentMode}`)
    return 'end_turn'
  }
  const [command, argument] = text.trim().split(/\s+/)
  switch (command) {
    case 'WRITE':
      return writeWithPermission(sessionId, argument)
    case 'AUTO':
      return writeWithoutAsking(sessionId, argument)
    case 'READ':
      return readTool(sessionId)
    case 'HANG':
      return hang(sessionId)
    case 'CRASH':
      return process.exit(3)
    default:
      update(sessionId, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thinking' } })
      say(sessionId, `echo: ${text}`)
      return 'end_turn'
  }
}

async function handleRequest({ id, method, params }) {
  switch (method) {
    case 'initialize':
      return respond(id, { protocolVersion: 1, agentCapabilities: capabilities, authMethods: [] })
    case 'session/new': {
      const sessionId = `fake-${sessions.size + 1}`
      sessions.set(sessionId, { cwd: params.cwd })
      return respond(id, { sessionId, configOptions: configOptions() })
    }
    case 'session/resume':
    case 'session/load':
      sessions.set(params.sessionId, { cwd: params.cwd })
      return respond(id, { configOptions: configOptions() })
    case 'session/set_config_option':
      if (params.configId === 'model') currentModel = params.value
      if (params.configId === 'mode') currentMode = params.value
      return respond(id, { configOptions: configOptions() })
    case 'session/delete':
    case 'session/close':
      sessions.delete(params.sessionId)
      return respond(id, {})
    case 'session/prompt': {
      const text = params.prompt.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join(' ')
      const stopReason = await runPrompt(params.sessionId, text)
      const meta = text.includes('NOISE')
        ? {
            _meta: {
              traceparent: '00-78d02baf9da0044cd66da266d8900326-6c51ee98c30947fc-01',
              baggage: 'codebuddy.session_id=01a1ca7f-8949-71d1-ba52-df0cdb8298f3',
              'codebuddy.ai/traceparent': '00-78d02baf9da0044cd66da266d8900326',
              'codebuddy.ai/outcome': 'FAILED_MODEL_REQUEST',
            },
          }
        : text.includes('META')
          ? {
              _meta: {
                'codebuddy.ai/requestId': '01a1ca7f8cf27b6281cea546289f2394',
                'codebuddy.ai/traceId': '1d22272f7805058ce6335d06cdd862a7',
                'codebuddy.ai/finishReason': 'error',
                'codebuddy.ai/errorMessage': JSON.stringify({
                  code: -32003,
                  message: 'Quota exceeded: Request failed with status code 429',
                  data: { statusCode: 429, code: 6004, category: 'quota', details: QUOTA_MESSAGE },
                }),
              },
            }
          : {}
      return respond(id, { stopReason, usage: TURN_USAGE, ...meta })
    }
    default:
      return send({ id, error: { code: -32601, message: `unknown method ${method}` } })
  }
}

createInterface({ input: process.stdin })
  .on('line', (line) => {
    const message = JSON.parse(line)
    if (message.method === 'session/cancel') {
      cancelTurn?.()
      return
    }
    if (message.method === undefined) {
      waiting.get(message.id)?.(message.result)
      waiting.delete(message.id)
      return
    }
    void handleRequest(message)
  })
  .on('close', () => process.exit(0))
