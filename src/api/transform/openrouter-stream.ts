import { ModelInfo } from "@shared/api"
import { convertToOpenAiMessages } from "@api/transform/openai-format"
import { convertToR1Format } from "@api/transform/r1-format"
import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { shouldCacheContent, enhanceAnthropicCaching, calculateCachingSavings } from "../../utils/prompt-cache-optimizer"
import { EnhancedRetryStrategy, PROVIDER_RETRY_CONFIGS } from "../../utils/enhanced-retry"

export async function createOpenRouterStream(
	client: OpenAI,
	systemPrompt: string,
	messages: Anthropic.Messages.MessageParam[],
	model: { id: string; info: ModelInfo },
	reasoningEffort?: string,
	thinkingBudgetTokens?: number,
	openRouterProviderSorting?: string,
	fallbackModels?: string[],
	useAutoRouter?: boolean,
) {
	// Initialize enhanced retry strategy for OpenRouter
	const retryStrategy = new EnhancedRetryStrategy({
		...PROVIDER_RETRY_CONFIGS.openrouter,
		modelInfo: model.info,
		customRetryCondition: (error, attempt) => {
			// OpenRouter-specific retry logic
			// Don't retry if we have Zero Completion Insurance coverage
			if (error?.response?.headers?.["x-openrouter-zero-completion"]) {
				return false
			}
			return true
		},
	})
	// Convert Anthropic messages to OpenAI format
	let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
		{ role: "system", content: systemPrompt },
		...convertToOpenAiMessages(messages),
	]

	// Enhanced prompt caching for multiple providers
	if (model.info.supportsPromptCache) {
		if (model.id.includes("claude")) {
			// Enhanced Anthropic caching with intelligent selection
			openAiMessages = enhanceAnthropicCaching(openAiMessages, model.info)
		} else if (model.id.includes("gemini") || model.id.includes("google")) {
			// Google Gemini prompt caching via OpenRouter
			// Note: Requires manual activation in OpenRouter dashboard
			if (openAiMessages[0]?.role === "system") {
				const systemMessage = openAiMessages[0]
				if (shouldCacheContent(systemMessage.content, model.info)) {
					// For Gemini, we use the cache_control parameter
					if (typeof systemMessage.content === "string") {
						systemMessage.content = [
							{
								type: "text",
								text: systemMessage.content,
								cache_control: { type: "ephemeral" },
							},
						]
					} else if (Array.isArray(systemMessage.content)) {
						// Add cache_control to large text blocks
						systemMessage.content.forEach((block: any) => {
							if (block.type === "text" && shouldCacheContent(block.text, model.info)) {
								block.cache_control = { type: "ephemeral" }
							}
						})
					}
				}
			}

			// Cache large user messages for Gemini
			const userMessages = openAiMessages.filter((msg) => msg.role === "user")
			userMessages.forEach((message) => {
				if (shouldCacheContent(message.content, model.info)) {
					if (typeof message.content === "string") {
						message.content = [
							{
								type: "text",
								text: message.content,
								cache_control: { type: "ephemeral" },
							},
						]
					} else if (Array.isArray(message.content)) {
						message.content.forEach((block: any) => {
							if (block.type === "text" && shouldCacheContent(block.text, model.info)) {
								block.cache_control = { type: "ephemeral" }
							}
						})
					}
				}
			})
		} else {
			// Legacy prompt caching for Claude models
			switch (model.id) {
				case "anthropic/claude-sonnet-4":
				case "anthropic/claude-opus-4":
				case "anthropic/claude-3.7-sonnet":
				case "anthropic/claude-3.7-sonnet:beta":
				case "anthropic/claude-3.7-sonnet:thinking":
				case "anthropic/claude-3-7-sonnet":
				case "anthropic/claude-3-7-sonnet:beta":
				case "anthropic/claude-3.5-sonnet":
				case "anthropic/claude-3.5-sonnet:beta":
				case "anthropic/claude-3.5-sonnet-20240620":
				case "anthropic/claude-3.5-sonnet-20240620:beta":
				case "anthropic/claude-3-5-haiku":
				case "anthropic/claude-3-5-haiku:beta":
				case "anthropic/claude-3-5-haiku-20241022":
				case "anthropic/claude-3-5-haiku-20241022:beta":
				case "anthropic/claude-3-haiku":
				case "anthropic/claude-3-haiku:beta":
				case "anthropic/claude-3-opus":
				case "anthropic/claude-3-opus:beta":
					openAiMessages[0] = {
						role: "system",
						content: [
							{
								type: "text",
								text: systemPrompt,
								// @ts-ignore-next-line
								cache_control: { type: "ephemeral" },
							},
						],
					}
					// Add cache_control to the last two user messages
					// (note: this works because we only ever add one user message at a time, but if we added multiple we'd need to mark the user message before the last assistant message)
					const lastTwoUserMessages = openAiMessages.filter((msg) => msg.role === "user").slice(-2)
					lastTwoUserMessages.forEach((msg) => {
						if (typeof msg.content === "string") {
							msg.content = [{ type: "text", text: msg.content }]
						}
						if (Array.isArray(msg.content)) {
							// NOTE: this is fine since env details will always be added at the end. but if it weren't there, and the user added a image_url type message, it would pop a text part before it and then move it after to the end.
							let lastTextPart = msg.content.filter((part) => part.type === "text").pop()

							if (!lastTextPart) {
								lastTextPart = { type: "text", text: "..." }
								msg.content.push(lastTextPart)
							}
							// @ts-ignore-next-line
							lastTextPart["cache_control"] = { type: "ephemeral" }
						}
					})
					break
				default:
					break
			}
		}
	}

	// Log potential caching savings
	if (model.info.supportsPromptCache) {
		const savings = calculateCachingSavings(openAiMessages, model.info)
		if (savings.potentialSavings > 0) {
			console.log(
				`[OpenRouter] Potential caching savings: $${savings.potentialSavings.toFixed(4)} (${savings.cacheableTokens} tokens)`,
			)
		}
	}

	// Not sure how openrouter defaults max tokens when no value is provided, but the anthropic api requires this value and since they offer both 4096 and 8192 variants, we should ensure 8192.
	// (models usually default to max tokens allowed)
	let maxTokens: number | undefined
	switch (model.id) {
		case "anthropic/claude-sonnet-4":
		case "anthropic/claude-opus-4":
		case "anthropic/claude-3.7-sonnet":
		case "anthropic/claude-3.7-sonnet:beta":
		case "anthropic/claude-3.7-sonnet:thinking":
		case "anthropic/claude-3-7-sonnet":
		case "anthropic/claude-3-7-sonnet:beta":
		case "anthropic/claude-3.5-sonnet":
		case "anthropic/claude-3.5-sonnet:beta":
		case "anthropic/claude-3.5-sonnet-20240620":
		case "anthropic/claude-3.5-sonnet-20240620:beta":
		case "anthropic/claude-3-5-haiku":
		case "anthropic/claude-3-5-haiku:beta":
		case "anthropic/claude-3-5-haiku-20241022":
		case "anthropic/claude-3-5-haiku-20241022:beta":
			maxTokens = 8_192
			break
	}

	let temperature: number | undefined = 0
	let topP: number | undefined = undefined
	if (
		model.id.startsWith("deepseek/deepseek-r1") ||
		model.id === "perplexity/sonar-reasoning" ||
		model.id === "qwen/qwq-32b:free" ||
		model.id === "qwen/qwq-32b"
	) {
		// Recommended values from DeepSeek
		temperature = 0.7
		topP = 0.95
		openAiMessages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
	}

	let reasoning: { max_tokens: number } | undefined = undefined
	switch (model.id) {
		case "anthropic/claude-sonnet-4":
		case "anthropic/claude-opus-4":
		case "anthropic/claude-3.7-sonnet":
		case "anthropic/claude-3.7-sonnet:beta":
		case "anthropic/claude-3.7-sonnet:thinking":
		case "anthropic/claude-3-7-sonnet":
		case "anthropic/claude-3-7-sonnet:beta":
			let budget_tokens = thinkingBudgetTokens || 0
			const reasoningOn = budget_tokens !== 0 ? true : false
			if (reasoningOn) {
				temperature = undefined // extended thinking does not support non-1 temperature
				reasoning = { max_tokens: budget_tokens }
			}
			break
	}

	// Removes messages in the middle when close to context window limit. Should not be applied to models that support prompt caching since it would continuously break the cache.
	let shouldApplyMiddleOutTransform = !model.info.supportsPromptCache
	// except for deepseek (which we set supportsPromptCache to true for), where because the context window is so small our truncation algo might miss and we should use openrouter's middle-out transform as a fallback to ensure we don't exceed the context window (FIXME: once we have a more robust token estimator we should not rely on this)
	if (model.id === "deepseek/deepseek-chat") {
		shouldApplyMiddleOutTransform = true
	}

	// hardcoded provider sorting for kimi-k2
	const isKimiK2 = model.id === "moonshotai/kimi-k2"
	openRouterProviderSorting = isKimiK2 ? undefined : openRouterProviderSorting

	// Prepare the request body with cost optimization features
	const requestBody: any = {
		// Use auto router for automatic cost-effective model selection if enabled
		model: useAutoRouter ? "openrouter/auto" : model.id,
		max_tokens: maxTokens,
		temperature: temperature,
		top_p: topP,
		messages: openAiMessages,
		stream: true,
		stream_options: { include_usage: true },
		transforms: shouldApplyMiddleOutTransform ? ["middle-out"] : undefined,
		include_reasoning: true,
		...(model.id.startsWith("openai/o") ? { reasoning_effort: reasoningEffort || "medium" } : {}),
		...(reasoning ? { reasoning } : {}),
	}

	// Add model fallbacks for cost optimization
	if (!useAutoRouter && fallbackModels && fallbackModels.length > 0) {
		requestBody.models = [model.id, ...fallbackModels]
	}

	// Configure provider settings for cost optimization
	if (isKimiK2) {
		// Special handling for Kimi K2 with specific providers
		requestBody.provider = {
			order: ["groq", "together", "baseten", "parasail", "novita", "deepinfra"],
			allow_fallbacks: false,
		}
	} else {
		// Default provider configuration with cost optimization
		const providerConfig: any = {}

		// Prioritize cost-effective providers when no specific sorting is provided
		if (openRouterProviderSorting) {
			providerConfig.sort = openRouterProviderSorting
		} else {
			// Default to price sorting for cost optimization
			providerConfig.sort = "price"
		}

		// Enable fallbacks for better reliability and cost optimization
		providerConfig.allow_fallbacks = true

		if (Object.keys(providerConfig).length > 0) {
			requestBody.provider = providerConfig
		}
	}

	// @ts-ignore-next-line
	const stream = await client.chat.completions.create(requestBody)

	return stream
}
