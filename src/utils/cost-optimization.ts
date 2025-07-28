import { ModelInfo } from "@shared/api"

/**
 * Cost optimization utility for OpenRouter API calls
 * Provides intelligent model fallbacks and cost-effective configurations
 */

/**
 * Default fallback models organized by capability tier and cost
 * These are ordered from most cost-effective to highest capability
 */
export const COST_EFFECTIVE_FALLBACKS = {
	// High-capability models (for complex tasks)
	high: ["anthropic/claude-3.5-sonnet", "openai/gpt-4o", "google/gemini-pro-1.5", "anthropic/claude-3-opus"],
	// Medium-capability models (for general tasks)
	medium: ["anthropic/claude-3.5-haiku", "openai/gpt-4o-mini", "google/gemini-flash-1.5", "anthropic/claude-3-haiku"],
	// Budget models (for simple tasks)
	budget: ["meta-llama/llama-3.1-8b-instruct:free", "mistralai/mistral-7b-instruct:free", "huggingfaceh4/zephyr-7b-beta:free"],
}

/**
 * Generate intelligent fallback models based on the primary model
 * @param primaryModel - The primary model ID
 * @param taskComplexity - The complexity level of the task ('high' | 'medium' | 'budget')
 * @returns Array of fallback model IDs ordered by cost-effectiveness
 */
export function generateFallbackModels(primaryModel: string, taskComplexity: "high" | "medium" | "budget" = "medium"): string[] {
	const fallbacks = COST_EFFECTIVE_FALLBACKS[taskComplexity]

	// Remove the primary model from fallbacks to avoid duplication
	const filteredFallbacks = fallbacks.filter((model) => model !== primaryModel)

	// For high-complexity tasks, also include medium-tier models as additional fallbacks
	if (taskComplexity === "high") {
		return [...filteredFallbacks, ...COST_EFFECTIVE_FALLBACKS.medium.filter((model) => model !== primaryModel)]
	}

	// For medium-complexity tasks, include some budget options
	if (taskComplexity === "medium") {
		return [...filteredFallbacks, ...COST_EFFECTIVE_FALLBACKS.budget.slice(0, 2)]
	}

	return filteredFallbacks
}

/**
 * Determine if a task should use the auto router based on the request characteristics
 * @param systemPrompt - The system prompt
 * @param messageCount - Number of messages in the conversation
 * @param hasImages - Whether the request contains images
 * @returns Whether to use auto router for cost optimization
 */
export function shouldUseAutoRouter(systemPrompt: string, messageCount: number, hasImages: boolean = false): boolean {
	// Don't use auto router for image-heavy tasks as it might select incompatible models
	if (hasImages) {
		return false
	}

	// Use auto router for simple, short conversations
	if (messageCount <= 3 && systemPrompt.length < 1000) {
		return true
	}

	// Use auto router for non-critical tasks (detected by keywords)
	const simpleTasks = ["summarize", "explain", "translate", "format", "convert"]
	const isSimpleTask = simpleTasks.some((task) => systemPrompt.toLowerCase().includes(task))

	return isSimpleTask
}

/**
 * Get cost optimization configuration based on task characteristics
 * @param primaryModel - The primary model ID
 * @param systemPrompt - The system prompt
 * @param messageCount - Number of messages
 * @param hasImages - Whether request has images
 * @returns Cost optimization configuration
 */
export function getCostOptimizationConfig(
	primaryModel: string,
	systemPrompt: string,
	messageCount: number,
	hasImages: boolean = false,
) {
	// Determine task complexity based on prompt characteristics
	let taskComplexity: "high" | "medium" | "budget" = "medium"

	const complexKeywords = ["code", "programming", "debug", "analyze", "complex", "detailed"]
	const simpleKeywords = ["summarize", "translate", "format", "simple", "quick"]

	if (complexKeywords.some((keyword) => systemPrompt.toLowerCase().includes(keyword))) {
		taskComplexity = "high"
	} else if (simpleKeywords.some((keyword) => systemPrompt.toLowerCase().includes(keyword))) {
		taskComplexity = "budget"
	}

	// Long conversations are typically more complex
	if (messageCount > 10) {
		taskComplexity = "high"
	}

	return {
		fallbackModels: generateFallbackModels(primaryModel, taskComplexity),
		useAutoRouter: shouldUseAutoRouter(systemPrompt, messageCount, hasImages),
		providerSorting: "price", // Always prioritize cost-effective providers
		taskComplexity,
	}
}

/**
 * Estimate potential cost savings from using optimization features
 * @param primaryModelPrice - Input price per token for primary model
 * @param optimizationConfig - The optimization configuration
 * @returns Estimated cost savings percentage
 */
export function estimateCostSavings(
	primaryModelPrice: number,
	optimizationConfig: ReturnType<typeof getCostOptimizationConfig>,
): number {
	// Base savings from provider sorting (typically 10-20%)
	let savings = 15

	// Additional savings from auto router (20-40% for simple tasks)
	if (optimizationConfig.useAutoRouter) {
		savings += 30
	}

	// Additional savings from fallback models (10-30% depending on complexity)
	if (optimizationConfig.fallbackModels.length > 0) {
		if (optimizationConfig.taskComplexity === "budget") {
			savings += 25
		} else if (optimizationConfig.taskComplexity === "medium") {
			savings += 15
		} else {
			savings += 10
		}
	}

	// Cap maximum savings at 70%
	return Math.min(savings, 70)
}
