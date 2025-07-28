/**
 * OpenRouter Cost Optimization Examples
 *
 * This file demonstrates how to use the new cost optimization features
 * to reduce API costs by 20-50% while maintaining quality.
 */

import { OpenRouterHandler } from "../src/api/providers/openrouter"
import { getCostOptimizationConfig, estimateCostSavings } from "../src/utils/cost-optimization"

// Example 1: Basic cost optimization with automatic fallbacks
const basicOptimizedHandler = new OpenRouterHandler({
	openRouterApiKey: "your-api-key",
	openRouterModelId: "openai/gpt-4o",
	// These will be automatically generated if not provided:
	// fallbackModels: ['anthropic/claude-3.5-sonnet', 'openai/gpt-4o-mini', 'google/gemini-flash-1.5'],
	// useAutoRouter: false (for complex tasks),
	// openRouterProviderSorting: 'price'
})

// Example 2: Explicit cost optimization configuration
const explicitOptimizedHandler = new OpenRouterHandler({
	openRouterApiKey: "your-api-key",
	openRouterModelId: "anthropic/claude-3.5-sonnet",
	// Explicit fallback models for cost optimization
	fallbackModels: [
		"anthropic/claude-3.5-haiku", // Cheaper alternative
		"openai/gpt-4o-mini", // Even cheaper
		"google/gemini-flash-1.5", // Budget option
	],
	// Use auto router for simple tasks
	useAutoRouter: false, // Set to true for simple tasks
	// Prioritize cost-effective providers
	openRouterProviderSorting: "price",
})

// Example 3: Auto router for simple tasks (maximum cost savings)
const autoRouterHandler = new OpenRouterHandler({
	openRouterApiKey: "your-api-key",
	// When useAutoRouter is true, the model selection is automatic
	useAutoRouter: true,
	openRouterProviderSorting: "price",
})

// Example 4: Budget-conscious configuration
const budgetHandler = new OpenRouterHandler({
	openRouterApiKey: "your-api-key",
	openRouterModelId: "anthropic/claude-3.5-haiku", // Start with cheaper model
	fallbackModels: [
		"meta-llama/llama-3.1-8b-instruct:free",
		"mistralai/mistral-7b-instruct:free",
		"huggingfaceh4/zephyr-7b-beta:free",
	],
	openRouterProviderSorting: "price",
})

// Example usage with cost estimation
async function demonstrateCostOptimization() {
	const systemPrompt = "You are a helpful coding assistant."
	const messages = [{ role: "user" as const, content: "Explain how to optimize API costs" }]

	// Get automatic cost optimization configuration
	const optimizationConfig = getCostOptimizationConfig(
		"openai/gpt-4o",
		systemPrompt,
		messages.length,
		false, // no images
	)

	console.log("Cost Optimization Config:", optimizationConfig)
	// Output: {
	//   fallbackModels: ['anthropic/claude-3.5-sonnet', 'openai/gpt-4o-mini', ...],
	//   useAutoRouter: false,
	//   providerSorting: 'price',
	//   taskComplexity: 'high'
	// }

	// Estimate potential savings
	const primaryModelPrice = 15.0 // $15 per million tokens for GPT-4o
	const estimatedSavings = estimateCostSavings(primaryModelPrice, optimizationConfig)
	console.log(`Estimated cost savings: ${estimatedSavings}%`)

	// Use the optimized handler
	const optimizedHandler = new OpenRouterHandler({
		openRouterApiKey: "your-api-key",
		openRouterModelId: "openai/gpt-4o",
		fallbackModels: optimizationConfig.fallbackModels,
		useAutoRouter: optimizationConfig.useAutoRouter,
		openRouterProviderSorting: optimizationConfig.providerSorting,
	})

	// Make the API call with cost optimization
	for await (const chunk of optimizedHandler.createMessage(systemPrompt, messages)) {
		if (chunk.type === "text") {
			console.log(chunk.text)
		} else if (chunk.type === "usage") {
			console.log(`Total cost: $${chunk.totalCost}`)
		}
	}
}

// Example API request body that would be sent to OpenRouter
const exampleRequestBody = {
	// Multiple models for automatic fallback
	models: ["openai/gpt-4o", "anthropic/claude-3.5-sonnet", "google/gemini-pro"],
	messages: [{ role: "user", content: "What is the meaning of life?" }],
	// Provider configuration for cost optimization
	provider: {
		sort: "price", // Prioritize cheapest providers
		allow_fallbacks: true, // Enable automatic fallbacks
	},
}

// Alternative: Using Auto Router for maximum cost savings on simple tasks
const autoRouterRequestBody = {
	model: "openrouter/auto", // Let OpenRouter choose the best model
	messages: [{ role: "user", content: "Summarize this text..." }],
	provider: {
		sort: "price",
	},
}

export { basicOptimizedHandler, explicitOptimizedHandler, autoRouterHandler, budgetHandler, demonstrateCostOptimization }
