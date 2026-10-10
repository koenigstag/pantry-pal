import Anthropic, {
  APIConnectionError,
  APIError,
  InternalServerError,
  RateLimitError,
} from '@anthropic-ai/sdk';
import {
  BadGatewayException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { OUTPUT_SCHEMA } from './output-schema';

/** What one request to the model carries: two cacheable system blocks, then the user turn. */
export interface ModelRequest {
  instructions: string;
  reference: string;
  user: string;
}

/** The model's answer: the parsed JSON, or `refused` when its safeguards declined the request. */
export type ModelAnswer = { kind: 'answer'; json: unknown } | { kind: 'refused' };

/**
 * Models that take the server-side refusal fallback: a declined request is
 * re-run on a model chosen for the refusal's category, inside the same call.
 */
const FALLBACK_MODELS = new Set([
  'claude-sonnet-5-5',
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-fable-5-1',
]);

/** Room for the answer and the model's thinking; a full answer is a few thousand tokens. */
const MAX_TOKENS = 16_000;

/** The person waits on this, so a slow answer fails rather than hanging the sheet. */
const TIMEOUT_MS = 60_000;

/**
 * The Claude model behind the text assistant, configured by `ANTHROPIC_API_KEY`
 * and `ASSISTANT_MODEL`. Without a key the assistant is off, and every call
 * answers 404, as the admin API does without its key.
 */
@Injectable()
export class AssistantModel {
  private readonly logger = new Logger(AssistantModel.name);
  private readonly client: Anthropic | undefined;
  private readonly model: string;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('assistant.apiKey');
    this.model = config.getOrThrow<string>('assistant.model');
    this.client =
      apiKey === undefined
        ? undefined
        : new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 2 });
  }

  get enabled(): boolean {
    return this.client !== undefined;
  }

  /** 404 while the assistant is off. */
  assertEnabled(): void {
    if (!this.enabled)
      throw new NotFoundException('The text assistant is not enabled on this server');
  }

  /**
   * Asks the model for the actions a text describes, held to `OUTPUT_SCHEMA`.
   * The instructions and the reference data come first, cached together; the
   * household and the text follow in the user turn.
   */
  async propose(request: ModelRequest): Promise<ModelAnswer> {
    const client = this.client;
    if (client === undefined) {
      throw new NotFoundException('The text assistant is not enabled on this server');
    }

    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await client.beta.messages.create({
        model: this.model,
        max_tokens: MAX_TOKENS,
        // Matching names and resolving dates needs some thought, not a long one.
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
        ...(FALLBACK_MODELS.has(this.model) && {
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default' as const,
        }),
        system: [
          { type: 'text', text: request.instructions },
          { type: 'text', text: request.reference, cache_control: { type: 'ephemeral' } },
        ],
        messages: [{ role: 'user', content: request.user }],
      });
    } catch (error) {
      throw this.translate(error);
    }

    this.logger.debug(
      `${response.model}: ${response.usage.input_tokens} in ` +
        `(${response.usage.cache_read_input_tokens ?? 0} cached), ${response.usage.output_tokens} out`,
    );

    if (response.stop_reason === 'refusal') return { kind: 'refused' };
    if (response.stop_reason === 'max_tokens') {
      throw new BadGatewayException('The assistant ran out of room for its answer');
    }

    const text = response.content.find((block) => block.type === 'text');
    if (text === undefined) throw new BadGatewayException('The assistant gave no answer');
    try {
      return { kind: 'answer', json: JSON.parse(text.text) as unknown };
    } catch {
      throw new BadGatewayException('The assistant gave an answer that is not JSON');
    }
  }

  /** Busy or unreachable is worth trying again later (503); anything else is a 502. */
  private translate(error: unknown): Error {
    if (
      error instanceof RateLimitError ||
      error instanceof InternalServerError ||
      error instanceof APIConnectionError
    ) {
      this.logger.warn(`The assistant's model is unavailable: ${String(error)}`);
      return new ServiceUnavailableException('The assistant is busy. Try again in a moment.');
    }
    if (error instanceof APIError) {
      this.logger.error(`The assistant's request failed: ${error.status ?? '?'} ${error.message}`);
      return new BadGatewayException('The assistant could not read this text');
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}
