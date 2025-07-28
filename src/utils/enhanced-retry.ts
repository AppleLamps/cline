import { ModelInfo } from "@shared/api"

/**
 * Enhanced retry utilities for cost optimization and better error handling
 * Builds upon the existing retry mechanism in src/api/retry.ts
 */

export interface EnhancedRetryOptions {
	/** Maximum number of retry attempts */
	maxRetries?: number
	/** Base delay in milliseconds */
	baseDelay?: number
	/** Maximum delay in milliseconds */
	maxDelay?: number
	/** Whether to retry all errors or just rate limits */
	retryAllErrors?: boolean
	/** Cost-aware retry strategy */
	costAwareRetry?: boolean
	/** Model information for cost calculations */
	modelInfo?: ModelInfo
	/** Maximum cost threshold for retries */
	maxCostThreshold?: number
	/** Custom retry conditions */
	customRetryCondition?: (error: any, attempt: number) => boolean
	/** Jitter factor for randomizing delays */
	jitterFactor?: number
}

const DEFAULT_ENHANCED_OPTIONS: Required<Omit<EnhancedRetryOptions, "modelInfo" | "customRetryCondition">> = {
	maxRetries: 5,
	baseDelay: 1000,
	maxDelay: 30000,
	retryAllErrors: false,
	costAwareRetry: true,
	maxCostThreshold: 1.0, // $1.00 maximum cost for retries
	jitterFactor: 0.1,
}

/**
 * Error classification for better retry decisions
 */
export enum ErrorType {
	RATE_LIMIT = "rate_limit",
	SERVER_ERROR = "server_error",
	NETWORK_ERROR = "network_error",
	AUTH_ERROR = "auth_error",
	CONTEXT_LENGTH_ERROR = "context_length_error",
	UNKNOWN_ERROR = "unknown_error",
}

/**
 * Classifies errors for appropriate retry strategies
 */
export function classifyError(error: any): ErrorType {
	const status = error?.status || error?.response?.status
	const message = error?.message?.toLowerCase() || ""

	// Rate limiting errors
	if (status === 429 || message.includes("rate limit") || message.includes("too many requests")) {
		return ErrorType.RATE_LIMIT
	}

	// Server errors (5xx)
	if (status >= 500 && status < 600) {
		return ErrorType.SERVER_ERROR
	}

	// Authentication errors (401, 403)
	if (status === 401 || status === 403) {
		return ErrorType.AUTH_ERROR
	}

	// Context length errors
	if (
		message.includes("context length") ||
		message.includes("token limit") ||
		message.includes("maximum context") ||
		status === 413
	) {
		return ErrorType.CONTEXT_LENGTH_ERROR
	}

	// Network errors
	if (
		message.includes("network") ||
		message.includes("timeout") ||
		message.includes("connection") ||
		error.code === "ECONNRESET" ||
		error.code === "ETIMEDOUT"
	) {
		return ErrorType.NETWORK_ERROR
	}

	return ErrorType.UNKNOWN_ERROR
}

/**
 * Determines if an error should be retried based on type and context
 */
export function shouldRetryError(
	errorType: ErrorType,
	attempt: number,
	maxRetries: number,
	options: EnhancedRetryOptions = {},
): boolean {
	if (attempt >= maxRetries) {
		return false
	}

	// Never retry auth errors or context length errors
	if (errorType === ErrorType.AUTH_ERROR || errorType === ErrorType.CONTEXT_LENGTH_ERROR) {
		return false
	}

	// Always retry rate limits and server errors
	if (errorType === ErrorType.RATE_LIMIT || errorType === ErrorType.SERVER_ERROR) {
		return true
	}

	// Retry network errors with reduced attempts
	if (errorType === ErrorType.NETWORK_ERROR) {
		return attempt < Math.min(maxRetries, 3)
	}

	// For unknown errors, respect the retryAllErrors flag
	return options.retryAllErrors || false
}

/**
 * Calculates retry delay with exponential backoff and jitter
 */
export function calculateRetryDelay(
	attempt: number,
	baseDelay: number,
	maxDelay: number,
	errorType: ErrorType,
	retryAfterHeader?: string,
	jitterFactor: number = 0.1,
): number {
	let delay: number

	// Use retry-after header if available
	if (retryAfterHeader) {
		const retryValue = parseInt(retryAfterHeader, 10)
		if (retryValue > Date.now() / 1000) {
			// Unix timestamp
			delay = retryValue * 1000 - Date.now()
		} else {
			// Delta seconds
			delay = retryValue * 1000
		}
	} else {
		// Exponential backoff with error-type specific multipliers
		let multiplier = 1
		switch (errorType) {
			case ErrorType.RATE_LIMIT:
				multiplier = 2 // Longer delays for rate limits
				break
			case ErrorType.SERVER_ERROR:
				multiplier = 1.5 // Moderate delays for server errors
				break
			case ErrorType.NETWORK_ERROR:
				multiplier = 1.2 // Shorter delays for network issues
				break
			default:
				multiplier = 1
		}

		delay = Math.min(maxDelay, baseDelay * Math.pow(2, attempt) * multiplier)
	}

	// Add jitter to prevent thundering herd
	const jitter = delay * jitterFactor * (Math.random() * 2 - 1)
	return Math.max(0, delay + jitter)
}

/**
 * Estimates the cost of a retry attempt
 */
export function estimateRetryCost(modelInfo: ModelInfo, estimatedInputTokens: number, estimatedOutputTokens: number = 0): number {
	const inputCost = (estimatedInputTokens / 1_000_000) * (modelInfo.inputPrice || 0)
	const outputCost = (estimatedOutputTokens / 1_000_000) * (modelInfo.outputPrice || 0)
	return inputCost + outputCost
}

/**
 * Enhanced retry strategy that considers cost and error types
 */
export class EnhancedRetryStrategy {
	private options: Required<Omit<EnhancedRetryOptions, "modelInfo" | "customRetryCondition">> &
		Pick<EnhancedRetryOptions, "modelInfo" | "customRetryCondition">
	private totalRetryCost: number = 0

	constructor(options: EnhancedRetryOptions = {}) {
		this.options = { ...DEFAULT_ENHANCED_OPTIONS, ...options }
	}

	/**
	 * Determines if a retry should be attempted
	 */
	shouldRetry(
		error: any,
		attempt: number,
		estimatedTokens?: number,
	): {
		shouldRetry: boolean
		delay: number
		reason?: string
	} {
		const errorType = classifyError(error)

		// Check custom retry condition first
		if (this.options.customRetryCondition) {
			const customResult = this.options.customRetryCondition(error, attempt)
			if (!customResult) {
				return {
					shouldRetry: false,
					delay: 0,
					reason: "Custom retry condition failed",
				}
			}
		}

		// Check basic retry conditions
		if (!shouldRetryError(errorType, attempt, this.options.maxRetries, this.options)) {
			return {
				shouldRetry: false,
				delay: 0,
				reason: `Error type ${errorType} not retryable or max attempts reached`,
			}
		}

		// Cost-aware retry check
		if (this.options.costAwareRetry && this.options.modelInfo && estimatedTokens) {
			const retryCost = estimateRetryCost(this.options.modelInfo, estimatedTokens)
			if (this.totalRetryCost + retryCost > this.options.maxCostThreshold) {
				return {
					shouldRetry: false,
					delay: 0,
					reason: `Retry cost threshold exceeded ($${this.options.maxCostThreshold})`,
				}
			}
			this.totalRetryCost += retryCost
		}

		// Calculate delay
		const retryAfter =
			error?.headers?.["retry-after"] || error?.headers?.["x-ratelimit-reset"] || error?.headers?.["ratelimit-reset"]

		const delay = calculateRetryDelay(
			attempt,
			this.options.baseDelay,
			this.options.maxDelay,
			errorType,
			retryAfter,
			this.options.jitterFactor,
		)

		return {
			shouldRetry: true,
			delay,
			reason: `Retrying ${errorType} error with ${delay}ms delay`,
		}
	}

	/**
	 * Resets the retry cost counter
	 */
	resetCost(): void {
		this.totalRetryCost = 0
	}

	/**
	 * Gets the current total retry cost
	 */
	getTotalRetryCost(): number {
		return this.totalRetryCost
	}
}

/**
 * Provider-specific retry configurations
 */
export const PROVIDER_RETRY_CONFIGS = {
	anthropicDirect: {
		maxRetries: 4,
		baseDelay: 1000,
		maxDelay: 16000,
		retryAllErrors: false,
		costAwareRetry: true,
		jitterFactor: 0.1,
	},
	openrouter: {
		maxRetries: 5,
		baseDelay: 500,
		maxDelay: 10000,
		retryAllErrors: true, // OpenRouter has fallback providers
		costAwareRetry: true,
		jitterFactor: 0.15,
	},
	gemini: {
		maxRetries: 4,
		baseDelay: 2000,
		maxDelay: 15000,
		retryAllErrors: false,
		costAwareRetry: true,
		jitterFactor: 0.1,
	},
	vertex: {
		maxRetries: 3,
		baseDelay: 1500,
		maxDelay: 12000,
		retryAllErrors: false,
		costAwareRetry: true,
		jitterFactor: 0.1,
	},
	openai: {
		maxRetries: 4,
		baseDelay: 1000,
		maxDelay: 20000,
		retryAllErrors: false,
		costAwareRetry: true,
		jitterFactor: 0.1,
	},
} as const

/**
 * Circuit breaker pattern for preventing cascading failures
 */
export class CircuitBreaker {
	private failures: number = 0
	private lastFailureTime: number = 0
	private state: "closed" | "open" | "half-open" = "closed"

	constructor(
		private failureThreshold: number = 5,
		private recoveryTimeout: number = 60000, // 1 minute
	) {}

	/**
	 * Checks if the circuit breaker allows the operation
	 */
	allowRequest(): boolean {
		const now = Date.now()

		switch (this.state) {
			case "closed":
				return true
			case "open":
				if (now - this.lastFailureTime >= this.recoveryTimeout) {
					this.state = "half-open"
					return true
				}
				return false
			case "half-open":
				return true
			default:
				return false
		}
	}

	/**
	 * Records a successful operation
	 */
	recordSuccess(): void {
		this.failures = 0
		this.state = "closed"
	}

	/**
	 * Records a failed operation
	 */
	recordFailure(): void {
		this.failures++
		this.lastFailureTime = Date.now()

		if (this.failures >= this.failureThreshold) {
			this.state = "open"
		}
	}

	/**
	 * Gets the current state of the circuit breaker
	 */
	getState(): "closed" | "open" | "half-open" {
		return this.state
	}
}
