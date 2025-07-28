/**
 * Enhanced Cost Optimization Example
 *
 * This example demonstrates how to use the enhanced prompt caching and retry mechanisms
 * for optimal cost efficiency across different LLM providers.
 */

import { ModelInfo } from "@shared/api"
import {
	shouldCacheContent,
	enhanceAnthropicCaching,
	calculateCachingSavings,
	CACHING_STRATEGIES,
} from "../src/utils/prompt-cache-optimizer"
import {
	EnhancedRetryStrategy,
	PROVIDER_RETRY_CONFIGS,
	CircuitBreaker,
	classifyError,
	estimateRetryCost,
} from "../src/utils/enhanced-retry"

// Example: Large system prompt that should be cached
const LARGE_SYSTEM_PROMPT = `
You are an expert software engineer with deep knowledge of TypeScript, React, and modern web development.
You have extensive experience with:
- Frontend frameworks (React, Vue, Angular)
- Backend technologies (Node.js, Express, FastAPI)
- Database systems (PostgreSQL, MongoDB, Redis)
- Cloud platforms (AWS, GCP, Azure)
- DevOps tools (Docker, Kubernetes, CI/CD)
- Testing frameworks (Jest, Cypress, Playwright)
- Code quality tools (ESLint, Prettier, TypeScript)

When helping users, you should:
1. Provide clear, well-documented code examples
2. Follow best practices and modern conventions
3. Consider performance, security, and maintainability
4. Explain your reasoning and trade-offs
5. Suggest improvements and optimizations
6. Use appropriate design patterns
7. Consider accessibility and user experience
8. Provide testing strategies
9. Consider error handling and edge cases
10. Stay up-to-date with latest technologies

Always structure your responses with:
- Clear problem analysis
- Step-by-step solution
- Code examples with comments
- Explanation of key concepts
- Best practices and recommendations
- Potential improvements or alternatives
`

// Example model configurations
const ANTHROPIC_MODEL: ModelInfo = {
	id: "anthropic/claude-3.5-sonnet",
	name: "Claude 3.5 Sonnet",
	provider: "anthropic",
	inputPrice: 3.0, // $3.00 per million tokens
	outputPrice: 15.0, // $15.00 per million tokens
	maxTokens: 200000,
	supportsPromptCache: true,
	contextWindow: 200000,
}

const GEMINI_MODEL: ModelInfo = {
	id: "google/gemini-2.5-pro",
	name: "Gemini 2.5 Pro",
	provider: "google",
	inputPrice: 1.25, // $1.25 per million tokens
	outputPrice: 5.0, // $5.00 per million tokens
	maxTokens: 8192,
	supportsPromptCache: true,
	contextWindow: 2000000,
}

const OPENAI_MODEL: ModelInfo = {
	id: "openai/gpt-4o",
	name: "GPT-4o",
	provider: "openai",
	inputPrice: 2.5, // $2.50 per million tokens
	outputPrice: 10.0, // $10.00 per million tokens
	maxTokens: 16384,
	supportsPromptCache: true, // Automatic caching
	contextWindow: 128000,
}

/**
 * Example 1: Basic Prompt Caching
 */
export function demonstratePromptCaching() {
	console.log("=== Prompt Caching Demonstration ===")

	// Check if system prompt should be cached
	const shouldCache = shouldCacheContent(LARGE_SYSTEM_PROMPT, ANTHROPIC_MODEL)
	console.log(`Should cache system prompt: ${shouldCache}`)

	// Example messages
	const messages = [
		{ role: "system", content: LARGE_SYSTEM_PROMPT },
		{ role: "user", content: "Help me build a React component for user authentication" },
		{ role: "assistant", content: "I'll help you create a comprehensive authentication component..." },
		{ role: "user", content: "Now add form validation and error handling" },
	]

	// Enhance messages with caching for Anthropic
	const enhancedMessages = enhanceAnthropicCaching(messages, ANTHROPIC_MODEL)
	console.log("Enhanced messages with caching:", JSON.stringify(enhancedMessages, null, 2))

	// Calculate potential savings
	const savings = calculateCachingSavings(messages, ANTHROPIC_MODEL)
	console.log(`Potential savings: $${savings.potentialSavings.toFixed(4)}`)
	console.log(`Cacheable tokens: ${savings.cacheableTokens}`)
	console.log(`Cache efficiency: ${(savings.cacheEfficiency * 100).toFixed(1)}%`)
}

/**
 * Example 2: Enhanced Retry Strategy
 */
export async function demonstrateEnhancedRetry() {
	console.log("\n=== Enhanced Retry Demonstration ===")

	// Create retry strategy for Anthropic
	const retryStrategy = new EnhancedRetryStrategy({
		...PROVIDER_RETRY_CONFIGS.anthropicDirect,
		modelInfo: ANTHROPIC_MODEL,
		maxCostThreshold: 0.5, // $0.50 maximum for retries
		customRetryCondition: (error, attempt) => {
			// Custom logic: don't retry on weekends (example)
			const isWeekend = [0, 6].includes(new Date().getDay())
			if (isWeekend && attempt > 2) {
				console.log("Limiting retries on weekend")
				return false
			}
			return true
		},
	})

	// Simulate different types of errors
	const errors = [
		{ status: 429, message: "Rate limit exceeded" },
		{ status: 500, message: "Internal server error" },
		{ status: 401, message: "Unauthorized" },
		{ code: "ECONNRESET", message: "Connection reset" },
	]

	for (const error of errors) {
		const errorType = classifyError(error)
		const result = retryStrategy.shouldRetry(error, 1, 1000) // 1000 estimated tokens

		console.log(`\nError: ${error.message}`)
		console.log(`Type: ${errorType}`)
		console.log(`Should retry: ${result.shouldRetry}`)
		console.log(`Delay: ${result.delay}ms`)
		console.log(`Reason: ${result.reason}`)
	}

	console.log(`\nTotal retry cost: $${retryStrategy.getTotalRetryCost().toFixed(4)}`)
}

/**
 * Example 3: Circuit Breaker Pattern
 */
export function demonstrateCircuitBreaker() {
	console.log("\n=== Circuit Breaker Demonstration ===")

	const circuitBreaker = new CircuitBreaker(
		3, // failure threshold
		5000, // recovery timeout (5 seconds)
	)

	// Simulate a series of failures
	console.log("Simulating failures...")
	for (let i = 0; i < 5; i++) {
		const allowed = circuitBreaker.allowRequest()
		console.log(`Request ${i + 1}: ${allowed ? "ALLOWED" : "BLOCKED"} (State: ${circuitBreaker.getState()})`)

		if (allowed) {
			// Simulate failure
			circuitBreaker.recordFailure()
		}
	}

	// Simulate recovery after timeout
	console.log("\nWaiting for recovery...")
	setTimeout(() => {
		const allowed = circuitBreaker.allowRequest()
		console.log(`After timeout: ${allowed ? "ALLOWED" : "BLOCKED"} (State: ${circuitBreaker.getState()})`)

		if (allowed) {
			// Simulate success
			circuitBreaker.recordSuccess()
			console.log(`After success: State is ${circuitBreaker.getState()}`)
		}
	}, 6000)
}

/**
 * Example 4: Provider-Specific Optimizations
 */
export function demonstrateProviderOptimizations() {
	console.log("\n=== Provider-Specific Optimizations ===")

	const providers = [
		{ name: "Anthropic", model: ANTHROPIC_MODEL, config: PROVIDER_RETRY_CONFIGS.anthropicDirect },
		{ name: "Gemini", model: GEMINI_MODEL, config: PROVIDER_RETRY_CONFIGS.gemini },
		{ name: "OpenAI", model: OPENAI_MODEL, config: PROVIDER_RETRY_CONFIGS.openai },
	]

	providers.forEach(({ name, model, config }) => {
		console.log(`\n${name} Configuration:`)
		console.log(`- Max retries: ${config.maxRetries}`)
		console.log(`- Base delay: ${config.baseDelay}ms`)
		console.log(`- Max delay: ${config.maxDelay}ms`)
		console.log(`- Retry all errors: ${config.retryAllErrors}`)
		console.log(`- Cost aware: ${config.costAwareRetry}`)
		console.log(`- Supports caching: ${model.supportsPromptCache}`)

		// Calculate cost for 1000 input tokens
		const inputCost = (1000 / 1_000_000) * model.inputPrice
		console.log(`- Cost per 1K input tokens: $${inputCost.toFixed(4)}`)

		// Estimate retry cost
		const retryCost = estimateRetryCost(model, 1000, 500)
		console.log(`- Estimated retry cost (1K input + 500 output): $${retryCost.toFixed(4)}`)
	})
}

/**
 * Example 5: Cost-Aware Request Planning
 */
export function demonstrateCostAwarePlanning() {
	console.log("\n=== Cost-Aware Request Planning ===")

	const requestSizes = [500, 1000, 2000, 5000, 10000] // token counts
	const models = [ANTHROPIC_MODEL, GEMINI_MODEL, OPENAI_MODEL]

	console.log("Cost comparison for different request sizes:\n")
	console.log("Tokens\t\tAnthropic\tGemini\t\tOpenAI")
	console.log("------\t\t---------\t------\t\t------")

	requestSizes.forEach((tokens) => {
		const costs = models.map((model) => {
			const inputCost = (tokens / 1_000_000) * model.inputPrice
			const outputCost = ((tokens * 0.3) / 1_000_000) * model.outputPrice // Assume 30% output ratio
			return inputCost + outputCost
		})

		console.log(`${tokens}\t\t$${costs[0].toFixed(4)}\t\t$${costs[1].toFixed(4)}\t\t$${costs[2].toFixed(4)}`)
	})

	// Caching savings analysis
	console.log("\nCaching savings (90% cache hit rate):")
	console.log("Tokens\t\tAnthropic\tGemini\t\tOpenAI")
	console.log("------\t\t---------\t------\t\t------")

	requestSizes.forEach((tokens) => {
		const savings = models.map((model) => {
			const baseCost = (tokens / 1_000_000) * model.inputPrice
			const cachedCost = baseCost * 0.1 // 90% cache hit = 10% full cost
			return baseCost - cachedCost
		})

		console.log(`${tokens}\t\t$${savings[0].toFixed(4)}\t\t$${savings[1].toFixed(4)}\t\t$${savings[2].toFixed(4)}`)
	})
}

/**
 * Example 6: Real-World Usage Pattern
 */
export async function demonstrateRealWorldUsage() {
	console.log("\n=== Real-World Usage Pattern ===")

	// Simulate a coding assistant session
	const session = {
		systemPrompt: LARGE_SYSTEM_PROMPT,
		conversation: [
			"Help me create a React component",
			"Add TypeScript types",
			"Include error handling",
			"Add unit tests",
			"Optimize for performance",
		],
		model: ANTHROPIC_MODEL,
	}

	let totalCost = 0
	let totalSavings = 0
	const messages = [{ role: "system", content: session.systemPrompt }]

	console.log("Simulating conversation with caching...")

	for (let i = 0; i < session.conversation.length; i++) {
		const userMessage = session.conversation[i]
		messages.push({ role: "user", content: userMessage })

		// Simulate assistant response
		const assistantResponse = `Here's a detailed response to: "${userMessage}". This would be a comprehensive answer with code examples, explanations, and best practices.`
		messages.push({ role: "assistant", content: assistantResponse })

		// Calculate costs with and without caching
		const withoutCaching = calculateCostWithoutCaching(messages, session.model)
		const savings = calculateCachingSavings(messages, session.model)
		const withCaching = withoutCaching - savings.potentialSavings

		totalCost += withCaching
		totalSavings += savings.potentialSavings

		console.log(`\nTurn ${i + 1}:`)
		console.log(`- User: ${userMessage}`)
		console.log(`- Cost without caching: $${withoutCaching.toFixed(4)}`)
		console.log(`- Cost with caching: $${withCaching.toFixed(4)}`)
		console.log(`- Savings this turn: $${savings.potentialSavings.toFixed(4)}`)
	}

	console.log(`\nSession Summary:`)
	console.log(`- Total cost with caching: $${totalCost.toFixed(4)}`)
	console.log(`- Total savings from caching: $${totalSavings.toFixed(4)}`)
	console.log(`- Savings percentage: ${((totalSavings / (totalCost + totalSavings)) * 100).toFixed(1)}%`)
}

// Helper function to calculate cost without caching
function calculateCostWithoutCaching(messages: any[], model: ModelInfo): number {
	const totalTokens = messages.reduce((sum, msg) => {
		return sum + estimateTokenCount(msg.content)
	}, 0)

	return (totalTokens / 1_000_000) * model.inputPrice
}

// Helper function to estimate token count (simplified)
function estimateTokenCount(text: string): number {
	return Math.ceil(text.length / 4) // Rough approximation: 4 chars per token
}

/**
 * Run all demonstrations
 */
export function runAllDemonstrations() {
	console.log("Enhanced Cost Optimization Examples\n")
	console.log("====================================\n")

	demonstratePromptCaching()
	demonstrateCostAwarePlanning()

	// Async demonstrations
	setTimeout(async () => {
		await demonstrateEnhancedRetry()
		demonstrateProviderOptimizations()
		await demonstrateRealWorldUsage()
	}, 100)

	// Circuit breaker demo (has its own timeout)
	demonstrateCircuitBreaker()
}

// Export for use in other files
export { LARGE_SYSTEM_PROMPT, ANTHROPIC_MODEL, GEMINI_MODEL, OPENAI_MODEL }
