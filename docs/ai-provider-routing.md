# AI text provider routing

The API server routes text generation through `src/lib/ai-providers.ts`. It tries
enabled providers in this order:

1. Alibaba Qwen (`qwen3.8-max`), only when the account's **Free Quota Only**
   setting has been enabled and confirmed in this project's server environment.
2. Z.AI GLM (`glm-4.7-flash`), which is listed as free in Z.AI's current pricing.
3. Google Gemini (`gemini-3.8-flash`), only when the key is present and the
   account is confirmed to use the paid API tier.

An unavailable provider, HTTP error, empty response, or timeout moves the
request to the next enabled provider. The server logs provider name, failure
category, and HTTP status only. It does not log prompts, generated text, API
keys, raw provider errors, or response bodies.

## Server configuration

Add secret values through Replit Secrets, not source files or chat:

- `DASHSCOPE_API_KEY`
- `GLM_API_KEY`
- `GEMINI_API_KEY`

Qwen and Gemini have additional default-off safeguards:

- Set `DASHSCOPE_FREE_QUOTA_ONLY_CONFIRMED=true` only after enabling Alibaba
  Model Studio's **Free Quota Only** option in the Singapore region. Alibaba
  documents a 1-million-token free quota for eligible models, valid for 90 days;
  without the console option, requests may switch to pay-as-you-go billing after
  the quota is exhausted. Alibaba says prompts and responses are not used for
  training by default, but its standard retention policy keeps them for up to
  30 days unless a legal or security need requires longer retention.
- Set `GEMINI_API_PAID_TIER_CONFIRMED=true` only when the API project is on a
  paid tier. Gemini's free-tier prompts may be used to improve services and may
  be reviewed by humans. Paid-tier prompts are not used to improve Google's
  products, though limited abuse-monitoring retention can still apply.

Optional model overrides are `DASHSCOPE_MODEL`, `GLM_MODEL`, and `GEMINI_MODEL`.
Qwen's optional compatible-mode base URL is `DASHSCOPE_BASE_URL`; the GLM and
Gemini base URLs can be changed with `GLM_API_BASE_URL` and
`GEMINI_API_BASE_URL`. Model and endpoint overrides can change pricing,
availability, or data-handling terms.

## Scope and data handling

All text-generation calls in the API server use this router; there is no
OpenAI text-generation fallback. Speech recognition and audio generation still
use the existing OpenAI-specific audio integration because those APIs are not
interchangeable with the text-compatible endpoints. Voice messages therefore
still send audio to that service for transcription, and generated speech remains
on the existing audio path.

The router prevents application logs from capturing message contents, but
enabled providers still receive prompts and any included conversation or
memory context. Review each provider's current privacy terms and your end-user
notice before enabling a provider.
