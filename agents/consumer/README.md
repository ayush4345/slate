# avtar.ai consumer agent

Demo **consumer agent**. Given a natural-language goal it picks which
provider tools to buy (weather, crypto price, translation), meters each
call, and settles the session once.

- `StubAgentBrain` — keyword router, no API key.
- `OpenAiAgentBrain` — real function-calling when `OPENAI_API_KEY` is set.

```
goal → pick tools → pay+serve per call → close → one ZK proof → settle once
```

## In-process demo

Runs the provider toolbox in-process (real APIs, mock chain unless
`EVM_PRIVATE_KEY` is set):

```bash
pnpm --filter @slate-base/agent-consumer demo
pnpm --filter @slate-base/agent-consumer demo "Weather in Tokyo and the price of ETH"
```

## Chat server (for the website)

```bash
# terminal 1
pnpm --filter @slate-base/agent-provider serve     # :4021

# terminal 2
pnpm --filter @slate-base/agent-consumer serve     # :4022
```

| Method | Path | What |
| --- | --- | --- |
| `GET` | `/health` | session + advertised provider terms |
| `POST` | `/chat` | `{ "message": "…" }` → answer + metered steps |
| `POST` | `/settle` | close channel, prove, settle |
| `POST` | `/session/new` | open a fresh channel |
