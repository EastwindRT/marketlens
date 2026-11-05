// Minimal MCP (Model Context Protocol) server over Streamable HTTP, tools only.
// Stateless: every POST /mcp carries one JSON-RPC message (or a batch) and is
// answered with application/json. No SDK dependency; tool implementations live
// in server.cjs and are passed in as `tools`.

const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function toolCatalog(tools) {
  return tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

async function handleMessage(msg, config) {
  const { serverInfo, instructions, tools } = config;
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return rpcError(msg?.id, -32600, 'Invalid request');
  }
  const isNotification = msg.id === undefined || msg.id === null;

  switch (msg.method) {
    case 'initialize': {
      const requested = msg.params?.protocolVersion;
      const protocolVersion = SUPPORTED_PROTOCOLS.includes(requested) ? requested : SUPPORTED_PROTOCOLS[0];
      return rpcResult(msg.id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo,
        instructions,
      });
    }
    case 'ping':
      return isNotification ? null : rpcResult(msg.id, {});
    case 'tools/list':
      return rpcResult(msg.id, { tools: toolCatalog(tools) });
    case 'tools/call': {
      const tool = tools.find((t) => t.name === msg.params?.name);
      if (!tool) return rpcError(msg.id, -32602, `Unknown tool: ${msg.params?.name}`);
      try {
        const data = await tool.handler(msg.params?.arguments || {}, config.context);
        return rpcResult(msg.id, {
          content: [{ type: 'text', text: JSON.stringify(data) }],
          isError: false,
        });
      } catch (err) {
        // Tool failures are reported in-band so the model can read and react to them.
        return rpcResult(msg.id, {
          content: [{ type: 'text', text: `Error: ${err.message}` }],
          isError: true,
        });
      }
    }
    default:
      // Notifications (e.g. notifications/initialized) need no reply.
      if (isNotification) return null;
      return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

// Returns { status, body } where body is undefined for notification-only POSTs.
async function handleMcpRequest(body, config) {
  if (Array.isArray(body)) {
    if (body.length === 0) return { status: 400, body: rpcError(null, -32600, 'Empty batch') };
    const replies = (await Promise.all(body.map((m) => handleMessage(m, config)))).filter(Boolean);
    return replies.length ? { status: 200, body: replies } : { status: 202 };
  }
  if (!body || typeof body !== 'object') return { status: 400, body: rpcError(null, -32700, 'Parse error') };
  const reply = await handleMessage(body, config);
  return reply ? { status: 200, body: reply } : { status: 202 };
}

module.exports = { handleMcpRequest, SUPPORTED_PROTOCOLS };
