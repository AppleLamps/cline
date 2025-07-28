import { ModelInfo } from "@shared/api"
import { Anthropic } from "@anthropic-ai/sdk"

/**
 * Enhanced prompt caching utilities for cost optimization
 * Builds upon existing caching implementations to provide more intelligent caching strategies
 */

export interface CacheOptimizationConfig {
	/** Minimum token count to enable caching */
	minTokensForCaching: number
	/** Whether to use aggressive caching for repetitive content */
	aggressiveCaching: boolean
	/** Cache TTL in seconds for different content types */
	cacheTtl: {
		systemPrompt: number
		userMessages: number
		longContent: number
	}
}

const DEFAULT_CACHE_CONFIG: CacheOptimizationConfig = {
	minTokensForCaching: 1024, // Anthropic's minimum for caching
	aggressiveCaching: false,
	cacheTtl: {
		systemPrompt: 3600, // 1 hour
		userMessages: 1800, // 30 minutes
		longContent: 900, // 15 minutes
	},
}

/**
 * Determines if a model supports prompt caching
 */
export function supportsPromptCaching(modelId: string): boolean {
	// Anthropic models that support caching
	const anthropicCachingModels = [
		"claude-sonnet-4",
		"claude-opus-4",
		"claude-3.7-sonnet",
		"claude-3-7-sonnet",
		"claude-3.5-sonnet",
		"claude-3-5-sonnet",
		"claude-3-5-haiku",
		"claude-3-haiku",
		"claude-3-opus",
	]

	// Google Gemini models with implicit caching
	const geminiCachingModels = ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-1.5-pro", "gemini-1.5-flash"]

	return (
		anthropicCachingModels.some((model) => modelId.includes(model)) ||
		geminiCachingModels.some((model) => modelId.includes(model))
	)
}

/**
 * Estimates token count for text content (rough approximation)
 */
export function estimateTokenCount(text: string): number {
	// Rough estimation: ~4 characters per token for English text
	return Math.ceil(text.length / 4)
}

/**
 * Determines if content should be cached based on size and repetition patterns
 */
export function shouldCacheContent(content: string, config: CacheOptimizationConfig = DEFAULT_CACHE_CONFIG): boolean {
	const tokenCount = estimateTokenCount(content)
	return tokenCount >= config.minTokensForCaching
}

/**
 * Enhanced cache control for Anthropic messages
 * Builds upon existing implementation with more intelligent caching decisions
 */
export function enhanceAnthropicCaching(
	messages: Anthropic.Messages.MessageParam[],
	systemPrompt: string,
	config: CacheOptimizationConfig = DEFAULT_CACHE_CONFIG,
): {
	enhancedSystemPrompt: Anthropic.Messages.SystemMessageParam[]
	enhancedMessages: Anthropic.Messages.MessageParam[]
	cacheStats: {
		systemCached: boolean
		messagesCached: number
		estimatedSavings: number
	}
} {
	const cacheStats = {
		systemCached: false,
		messagesCached: 0,
		estimatedSavings: 0,
	}

	// Enhanced system prompt caching
	const enhancedSystemPrompt: Anthropic.Messages.SystemMessageParam[] = []
	if (shouldCacheContent(systemPrompt, config)) {
		enhancedSystemPrompt.push({
			text: systemPrompt,
			type: "text",
			cache_control: { type: "ephemeral" },
		})
		cacheStats.systemCached = true
		cacheStats.estimatedSavings += estimateTokenCount(systemPrompt)
	} else {
		enhancedSystemPrompt.push({
			text: systemPrompt,
			type: "text",
		})
	}

	// Enhanced message caching with intelligent selection
	const userMsgIndices = messages.reduce((acc, msg, index) => (msg.role === "user" ? [...acc, index] : acc), [] as number[])

	const enhancedMessages = messages.map((message, index) => {
		const isLastUserMsg = index === userMsgIndices[userMsgIndices.length - 1]
		const isSecondLastUserMsg = index === userMsgIndices[userMsgIndices.length - 2]
		const shouldCache = (isLastUserMsg || isSecondLastUserMsg) && message.role === "user"

		if (shouldCache && typeof message.content === "string" && shouldCacheContent(message.content, config)) {
			cacheStats.messagesCached++
			cacheStats.estimatedSavings += estimateTokenCount(message.content)
			return {
				...message,
				content: [
					{
						type: "text" as const,
						text: message.content,
						cache_control: { type: "ephemeral" },
					},
				],
			}
		} else if (shouldCache && Array.isArray(message.content)) {
			const lastTextPart = message.content.filter((part) => part.type === "text").pop()
			if (lastTextPart && shouldCacheContent(lastTextPart.text, config)) {
				cacheStats.messagesCached++
				cacheStats.estimatedSavings += estimateTokenCount(lastTextPart.text)
				return {
					...message,
					content: message.content.map((content, contentIndex) =>
						contentIndex === message.content.length - 1
							? {
									...content,
									cache_control: { type: "ephemeral" },
								}
							: content,
					),
				}
			}
		}

		return message
	})

	return {
		enhancedSystemPrompt,
		enhancedMessages,
		cacheStats,
	}
}

/**
 * Calculates potential cost savings from prompt caching
 */
export function calculateCachingSavings(
	cachedTokens: number,
	inputPricePerToken: number,
	cacheReadPricePerToken?: number,
): {
	savingsPerRequest: number
	savingsPercentage: number
	breakEvenRequests: number
} {
	// Anthropic caching: 25% of input price for cache reads
	const effectiveCacheReadPrice = cacheReadPricePerToken || inputPricePerToken * 0.25
	const savingsPerRequest = cachedTokens * (inputPricePerToken - effectiveCacheReadPrice)
	const savingsPercentage = ((inputPricePerToken - effectiveCacheReadPrice) / inputPricePerToken) * 100

	// Break-even point: when cache creation cost is recovered
	// Assuming cache creation costs the same as regular input tokens
	const breakEvenRequests = Math.ceil(inputPricePerToken / (inputPricePerToken - effectiveCacheReadPrice))

	return {
		savingsPerRequest,
		savingsPercentage,
		breakEvenRequests,
	}
}

/**
 * Analyzes conversation for optimal caching strategy
 */
export function analyzeCachingOpportunities(
	systemPrompt: string,
	messages: Anthropic.Messages.MessageParam[],
	modelInfo: ModelInfo,
): {
	recommendations: string[]
	potentialSavings: number
	optimalStrategy: "aggressive" | "conservative" | "none"
} {
	const recommendations: string[] = []
	let potentialSavings = 0
	let optimalStrategy: "aggressive" | "conservative" | "none" = "none"

	const systemTokens = estimateTokenCount(systemPrompt)
	const totalUserTokens = messages
		.filter((msg) => msg.role === "user")
		.reduce((total, msg) => {
			const content =
				typeof msg.content === "string"
					? msg.content
					: msg.content.map((part) => (part.type === "text" ? part.text : "")).join("")
			return total + estimateTokenCount(content)
		}, 0)

	// System prompt analysis
	if (systemTokens >= 1024) {
		recommendations.push(`System prompt (${systemTokens} tokens) is suitable for caching`)
		potentialSavings += systemTokens * 0.75 // 75% savings on subsequent requests
		optimalStrategy = "conservative"
	}

	// Message analysis
	if (totalUserTokens >= 2048) {
		recommendations.push(`User messages (${totalUserTokens} tokens) could benefit from caching`)
		potentialSavings += totalUserTokens * 0.5 // Partial savings
		optimalStrategy = "aggressive"
	}

	// Model-specific recommendations
	if (modelInfo.supportsPromptCache) {
		recommendations.push("Model supports prompt caching - enable for cost optimization")
	} else {
		recommendations.push("Model does not support prompt caching - consider switching to a caching-enabled model")
		optimalStrategy = "none"
	}

	return {
		recommendations,
		potentialSavings,
		optimalStrategy,
	}
}

/**
 * Configuration for different caching strategies
 */
export const CACHING_STRATEGIES = {
	conservative: {
		minTokensForCaching: 2048,
		aggressiveCaching: false,
		cacheTtl: {
			systemPrompt: 1800,
			userMessages: 900,
			longContent: 600,
		},
	},
	aggressive: {
		minTokensForCaching: 1024,
		aggressiveCaching: true,
		cacheTtl: {
			systemPrompt: 3600,
			userMessages: 1800,
			longContent: 900,
		},
	},
	maximum: {
		minTokensForCaching: 512,
		aggressiveCaching: true,
		cacheTtl: {
			systemPrompt: 7200,
			userMessages: 3600,
			longContent: 1800,
		},
	},
} as const
