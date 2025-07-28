/**
 * Enhanced Cost Optimization Tests
 *
 * Tests for prompt caching and enhanced retry mechanisms
 */

import { describe, it, expect, beforeEach, jest } from "@jest/globals"
import { ModelInfo } from "@shared/api"
import {
	shouldCacheContent,
	enhanceAnthropicCaching,
	calculateCachingSavings,
	estimateTokenCount,
	CACHING_STRATEGIES,
} from "../utils/prompt-cache-optimizer"
import {
	EnhancedRetryStrategy,
	classifyError,
	ErrorType,
	shouldRetryError,
	calculateRetryDelay,
	estimateRetryCost,
	CircuitBreaker,
	PROVIDER_RETRY_CONFIGS,
} from "../utils/enhanced-retry"

// Mock model configurations for testing
const MOCK_ANTHROPIC_MODEL: ModelInfo = {
	id: "anthropic/claude-3.5-sonnet",
	name: "Claude 3.5 Sonnet",
	provider: "anthropic",
	inputPrice: 3.0,
	outputPrice: 15.0,
	maxTokens: 200000,
	supportsPromptCache: true,
	contextWindow: 200000,
}

const MOCK_GEMINI_MODEL: ModelInfo = {
	id: "google/gemini-2.5-pro",
	name: "Gemini 2.5 Pro",
	provider: "google",
	inputPrice: 1.25,
	outputPrice: 5.0,
	maxTokens: 8192,
	supportsPromptCache: true,
	contextWindow: 2000000,
}

const MOCK_OPENAI_MODEL: ModelInfo = {
	id: "openai/gpt-4o",
	name: "GPT-4o",
	provider: "openai",
	inputPrice: 2.5,
	outputPrice: 10.0,
	maxTokens: 16384,
	supportsPromptCache: false, // OpenAI has automatic caching
	contextWindow: 128000,
}

describe("Prompt Cache Optimizer", () => {
	describe("shouldCacheContent", () => {
		it("should cache large content", () => {
			const largeContent = "x".repeat(5000) // Large content
			const result = shouldCacheContent(largeContent, MOCK_ANTHROPIC_MODEL)
			expect(result).toBe(true)
		})

		it("should not cache small content", () => {
			const smallContent = "Hello world"
			const result = shouldCacheContent(smallContent, MOCK_ANTHROPIC_MODEL)
			expect(result).toBe(false)
		})

		it("should not cache for models without cache support", () => {
			const largeContent = "x".repeat(5000)
			const result = shouldCacheContent(largeContent, MOCK_OPENAI_MODEL)
			expect(result).toBe(false)
		})

		it("should respect different caching strategies", () => {
			const mediumContent = "x".repeat(1500)

			// Conservative strategy should not cache medium content
			const conservativeResult = shouldCacheContent(mediumContent, MOCK_ANTHROPIC_MODEL, CACHING_STRATEGIES.CONSERVATIVE)
			expect(conservativeResult).toBe(false)

			// Aggressive strategy should cache medium content
			const aggressiveResult = shouldCacheContent(mediumContent, MOCK_ANTHROPIC_MODEL, CACHING_STRATEGIES.AGGRESSIVE)
			expect(aggressiveResult).toBe(true)
		})
	})

	describe("estimateTokenCount", () => {
		it("should estimate token count correctly", () => {
			const text = "Hello world, this is a test message"
			const tokens = estimateTokenCount(text)
			expect(tokens).toBeGreaterThan(0)
			expect(tokens).toBeLessThan(text.length) // Should be less than character count
		})

		it("should handle empty strings", () => {
			const tokens = estimateTokenCount("")
			expect(tokens).toBe(0)
		})
	})

	describe("enhanceAnthropicCaching", () => {
		it("should add cache_control to appropriate messages", () => {
			const messages = [
				{ role: "system", content: "x".repeat(2000) },
				{ role: "user", content: "Hello" },
				{ role: "assistant", content: "Hi there" },
				{ role: "user", content: "x".repeat(1500) },
			]

			const enhanced = enhanceAnthropicCaching(messages, MOCK_ANTHROPIC_MODEL)

			// System message should have cache_control
			const systemMessage = enhanced.find((msg) => msg.role === "system")
			expect(systemMessage?.content).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						cache_control: { type: "ephemeral" },
					}),
				]),
			)
		})

		it("should not modify messages for non-caching models", () => {
			const messages = [
				{ role: "system", content: "x".repeat(2000) },
				{ role: "user", content: "Hello" },
			]

			const enhanced = enhanceAnthropicCaching(messages, MOCK_OPENAI_MODEL)
			expect(enhanced).toEqual(messages)
		})
	})

	describe("calculateCachingSavings", () => {
		it("should calculate savings correctly", () => {
			const messages = [
				{ role: "system", content: "x".repeat(2000) },
				{ role: "user", content: "Hello" },
			]

			const savings = calculateCachingSavings(messages, MOCK_ANTHROPIC_MODEL)

			expect(savings.potentialSavings).toBeGreaterThan(0)
			expect(savings.cacheableTokens).toBeGreaterThan(0)
			expect(savings.cacheEfficiency).toBeGreaterThan(0)
			expect(savings.cacheEfficiency).toBeLessThanOrEqual(1)
		})

		it("should return zero savings for non-cacheable content", () => {
			const messages = [
				{ role: "user", content: "Hello" },
				{ role: "assistant", content: "Hi" },
			]

			const savings = calculateCachingSavings(messages, MOCK_ANTHROPIC_MODEL)
			expect(savings.potentialSavings).toBe(0)
			expect(savings.cacheableTokens).toBe(0)
		})
	})
})

describe("Enhanced Retry Strategy", () => {
	describe("classifyError", () => {
		it("should classify rate limit errors", () => {
			const error = { status: 429, message: "Rate limit exceeded" }
			const type = classifyError(error)
			expect(type).toBe(ErrorType.RATE_LIMIT)
		})

		it("should classify server errors", () => {
			const error = { status: 500, message: "Internal server error" }
			const type = classifyError(error)
			expect(type).toBe(ErrorType.SERVER_ERROR)
		})

		it("should classify auth errors", () => {
			const error = { status: 401, message: "Unauthorized" }
			const type = classifyError(error)
			expect(type).toBe(ErrorType.AUTH_ERROR)
		})

		it("should classify context length errors", () => {
			const error = { status: 413, message: "Context length exceeded" }
			const type = classifyError(error)
			expect(type).toBe(ErrorType.CONTEXT_LENGTH_ERROR)
		})

		it("should classify network errors", () => {
			const error = { code: "ECONNRESET", message: "Connection reset" }
			const type = classifyError(error)
			expect(type).toBe(ErrorType.NETWORK_ERROR)
		})

		it("should classify unknown errors", () => {
			const error = { message: "Something went wrong" }
			const type = classifyError(error)
			expect(type).toBe(ErrorType.UNKNOWN_ERROR)
		})
	})

	describe("shouldRetryError", () => {
		it("should retry rate limit errors", () => {
			const shouldRetry = shouldRetryError(ErrorType.RATE_LIMIT, 1, 5)
			expect(shouldRetry).toBe(true)
		})

		it("should retry server errors", () => {
			const shouldRetry = shouldRetryError(ErrorType.SERVER_ERROR, 1, 5)
			expect(shouldRetry).toBe(true)
		})

		it("should not retry auth errors", () => {
			const shouldRetry = shouldRetryError(ErrorType.AUTH_ERROR, 1, 5)
			expect(shouldRetry).toBe(false)
		})

		it("should not retry context length errors", () => {
			const shouldRetry = shouldRetryError(ErrorType.CONTEXT_LENGTH_ERROR, 1, 5)
			expect(shouldRetry).toBe(false)
		})

		it("should not retry when max attempts reached", () => {
			const shouldRetry = shouldRetryError(ErrorType.RATE_LIMIT, 5, 5)
			expect(shouldRetry).toBe(false)
		})
	})

	describe("calculateRetryDelay", () => {
		it("should calculate exponential backoff delay", () => {
			const delay1 = calculateRetryDelay(0, 1000, 30000, ErrorType.RATE_LIMIT)
			const delay2 = calculateRetryDelay(1, 1000, 30000, ErrorType.RATE_LIMIT)
			const delay3 = calculateRetryDelay(2, 1000, 30000, ErrorType.RATE_LIMIT)

			expect(delay2).toBeGreaterThan(delay1)
			expect(delay3).toBeGreaterThan(delay2)
		})

		it("should respect max delay", () => {
			const delay = calculateRetryDelay(10, 1000, 5000, ErrorType.RATE_LIMIT)
			expect(delay).toBeLessThanOrEqual(5000 * 1.1) // Account for jitter
		})

		it("should use retry-after header when available", () => {
			const delay = calculateRetryDelay(1, 1000, 30000, ErrorType.RATE_LIMIT, "5")
			expect(delay).toBeCloseTo(5000, -2) // 5 seconds ± jitter
		})
	})

	describe("estimateRetryCost", () => {
		it("should calculate retry cost correctly", () => {
			const cost = estimateRetryCost(MOCK_ANTHROPIC_MODEL, 1000, 500)

			const expectedInputCost = (1000 / 1_000_000) * 3.0
			const expectedOutputCost = (500 / 1_000_000) * 15.0
			const expectedTotal = expectedInputCost + expectedOutputCost

			expect(cost).toBeCloseTo(expectedTotal, 6)
		})

		it("should handle zero output tokens", () => {
			const cost = estimateRetryCost(MOCK_ANTHROPIC_MODEL, 1000)
			const expectedCost = (1000 / 1_000_000) * 3.0
			expect(cost).toBeCloseTo(expectedCost, 6)
		})
	})

	describe("EnhancedRetryStrategy", () => {
		let retryStrategy: EnhancedRetryStrategy

		beforeEach(() => {
			retryStrategy = new EnhancedRetryStrategy({
				maxRetries: 3,
				baseDelay: 1000,
				maxDelay: 10000,
				maxCostThreshold: 0.1,
				modelInfo: MOCK_ANTHROPIC_MODEL,
				costAwareRetry: true,
			})
		})

		it("should allow retries for retryable errors", () => {
			const error = { status: 429, message: "Rate limit exceeded" }
			const result = retryStrategy.shouldRetry(error, 1, 100)

			expect(result.shouldRetry).toBe(true)
			expect(result.delay).toBeGreaterThan(0)
		})

		it("should not allow retries for non-retryable errors", () => {
			const error = { status: 401, message: "Unauthorized" }
			const result = retryStrategy.shouldRetry(error, 1, 100)

			expect(result.shouldRetry).toBe(false)
			expect(result.reason).toContain("not retryable")
		})

		it("should respect cost threshold", () => {
			const error = { status: 429, message: "Rate limit exceeded" }

			// First retry should work
			const result1 = retryStrategy.shouldRetry(error, 1, 10000) // Large token count
			expect(result1.shouldRetry).toBe(true)

			// Second retry should exceed cost threshold
			const result2 = retryStrategy.shouldRetry(error, 2, 10000)
			expect(result2.shouldRetry).toBe(false)
			expect(result2.reason).toContain("cost threshold")
		})

		it("should use custom retry condition", () => {
			const customStrategy = new EnhancedRetryStrategy({
				maxRetries: 3,
				customRetryCondition: () => false, // Never retry
			})

			const error = { status: 429, message: "Rate limit exceeded" }
			const result = customStrategy.shouldRetry(error, 1, 100)

			expect(result.shouldRetry).toBe(false)
			expect(result.reason).toContain("Custom retry condition")
		})

		it("should track total retry cost", () => {
			const error = { status: 429, message: "Rate limit exceeded" }

			retryStrategy.shouldRetry(error, 1, 1000)
			const cost = retryStrategy.getTotalRetryCost()

			expect(cost).toBeGreaterThan(0)
		})

		it("should reset cost counter", () => {
			const error = { status: 429, message: "Rate limit exceeded" }

			retryStrategy.shouldRetry(error, 1, 1000)
			expect(retryStrategy.getTotalRetryCost()).toBeGreaterThan(0)

			retryStrategy.resetCost()
			expect(retryStrategy.getTotalRetryCost()).toBe(0)
		})
	})
})

describe("CircuitBreaker", () => {
	let circuitBreaker: CircuitBreaker

	beforeEach(() => {
		circuitBreaker = new CircuitBreaker(3, 1000) // 3 failures, 1 second recovery
	})

	it("should start in closed state", () => {
		expect(circuitBreaker.getState()).toBe("closed")
		expect(circuitBreaker.allowRequest()).toBe(true)
	})

	it("should open after failure threshold", () => {
		// Record failures
		for (let i = 0; i < 3; i++) {
			circuitBreaker.recordFailure()
		}

		expect(circuitBreaker.getState()).toBe("open")
		expect(circuitBreaker.allowRequest()).toBe(false)
	})

	it("should transition to half-open after recovery timeout", (done) => {
		// Open the circuit
		for (let i = 0; i < 3; i++) {
			circuitBreaker.recordFailure()
		}
		expect(circuitBreaker.getState()).toBe("open")

		// Wait for recovery
		setTimeout(() => {
			expect(circuitBreaker.allowRequest()).toBe(true)
			expect(circuitBreaker.getState()).toBe("half-open")
			done()
		}, 1100) // Slightly more than recovery timeout
	})

	it("should close after successful request in half-open state", (done) => {
		// Open the circuit
		for (let i = 0; i < 3; i++) {
			circuitBreaker.recordFailure()
		}

		// Wait for recovery and record success
		setTimeout(() => {
			circuitBreaker.allowRequest() // Transition to half-open
			circuitBreaker.recordSuccess()

			expect(circuitBreaker.getState()).toBe("closed")
			done()
		}, 1100)
	})

	it("should reset failure count on success", () => {
		// Record some failures
		circuitBreaker.recordFailure()
		circuitBreaker.recordFailure()
		expect(circuitBreaker.getState()).toBe("closed") // Still closed

		// Record success
		circuitBreaker.recordSuccess()

		// Should still be closed even after more failures
		circuitBreaker.recordFailure()
		circuitBreaker.recordFailure()
		expect(circuitBreaker.getState()).toBe("closed")
	})
})

describe("Provider Retry Configurations", () => {
	it("should have valid configurations for all providers", () => {
		const providers = Object.keys(PROVIDER_RETRY_CONFIGS)
		expect(providers.length).toBeGreaterThan(0)

		providers.forEach((provider) => {
			const config = PROVIDER_RETRY_CONFIGS[provider as keyof typeof PROVIDER_RETRY_CONFIGS]

			expect(config.maxRetries).toBeGreaterThan(0)
			expect(config.baseDelay).toBeGreaterThan(0)
			expect(config.maxDelay).toBeGreaterThan(config.baseDelay)
			expect(typeof config.retryAllErrors).toBe("boolean")
			expect(typeof config.costAwareRetry).toBe("boolean")
			expect(config.jitterFactor).toBeGreaterThanOrEqual(0)
			expect(config.jitterFactor).toBeLessThanOrEqual(1)
		})
	})

	it("should have appropriate configurations for different providers", () => {
		// OpenRouter should allow retrying all errors (has fallbacks)
		expect(PROVIDER_RETRY_CONFIGS.openrouter.retryAllErrors).toBe(true)

		// Direct providers should be more conservative
		expect(PROVIDER_RETRY_CONFIGS.anthropicDirect.retryAllErrors).toBe(false)
		expect(PROVIDER_RETRY_CONFIGS.gemini.retryAllErrors).toBe(false)

		// All should have cost-aware retry enabled
		Object.values(PROVIDER_RETRY_CONFIGS).forEach((config) => {
			expect(config.costAwareRetry).toBe(true)
		})
	})
})

describe("Integration Tests", () => {
	it("should work together for a complete optimization flow", () => {
		const messages = [
			{ role: "system", content: "x".repeat(3000) }, // Large system prompt
			{ role: "user", content: "Hello" },
			{ role: "assistant", content: "Hi there!" },
			{ role: "user", content: "x".repeat(2000) }, // Large user message
		]

		// Test caching
		const enhanced = enhanceAnthropicCaching(messages, MOCK_ANTHROPIC_MODEL)
		const savings = calculateCachingSavings(enhanced, MOCK_ANTHROPIC_MODEL)

		expect(savings.potentialSavings).toBeGreaterThan(0)

		// Test retry strategy
		const retryStrategy = new EnhancedRetryStrategy({
			...PROVIDER_RETRY_CONFIGS.anthropicDirect,
			modelInfo: MOCK_ANTHROPIC_MODEL,
		})

		const error = { status: 429, message: "Rate limit exceeded" }
		const retryResult = retryStrategy.shouldRetry(error, 1, 1000)

		expect(retryResult.shouldRetry).toBe(true)
		expect(retryResult.delay).toBeGreaterThan(0)
	})

	it("should handle edge cases gracefully", () => {
		// Empty messages
		const emptySavings = calculateCachingSavings([], MOCK_ANTHROPIC_MODEL)
		expect(emptySavings.potentialSavings).toBe(0)

		// Null/undefined content
		expect(() => shouldCacheContent(null as any, MOCK_ANTHROPIC_MODEL)).not.toThrow()
		expect(() => shouldCacheContent(undefined as any, MOCK_ANTHROPIC_MODEL)).not.toThrow()

		// Invalid error objects
		const invalidError = {}
		const errorType = classifyError(invalidError)
		expect(errorType).toBe(ErrorType.UNKNOWN_ERROR)
	})
})
