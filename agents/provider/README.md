# avtar.ai provider agent

Demo **provider agent**. Sells three keyless services per call through a
metered avtar.ai channel:

| Service | API | Request → result |
| --- | --- | --- |
| `WeatherService` | [Open-Meteo](https://open-meteo.com) | `{ location }` → temp, wind, conditions |
| `CryptoPriceService` | [CoinGecko](https://www.coingecko.com) | `{ coin, vs? }` → price, 24h change |
| `TranslationService` | [MyMemory](https://mymemory.translated.net) | `{ text, from?, to }` → translated text |

All three sit behind one `ToolboxService`, so a consumer can mix tools and
still settle with a **single** ZK proof.

```
POST /agent/open            → 402 Payment Required { accepts: [rate, payTo, asset] }
POST /agent/open  + X-PAYMENT   → open metered channel
POST /channels/:id/call     → price → serve → advance meter
POST /channels/:id/finalize → release the in-memory meter
GET  /.well-known/agent-card.json
```

```bash
pnpm --filter @slate-base/agent-provider serve   # :4021
```
