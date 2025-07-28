# OpenRouter Cost Optimization

This document explains the cost optimization features implemented to address inefficient model and provider selection, potentially reducing API costs by 20-50%.

## Overview

The cost optimization system implements three key strategies:

1. **Model Fallbacks** - Automatic fallback to cheaper models when the primary model fails
2. **Auto Router** - Let OpenRouter automatically select the most cost-effective model
3. **Provider Sorting** - Prioritize the cheapest providers for any given model

## Features Implemented

### 1. Model Fallbacks

Instead of using a single expensive model, the system can automatically fall back to cheaper alternatives:

```typescript
// Before: Single expensive model
const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  body: JSON.stringify({
    model: "openai/gpt-4o", // $15/million tokens
    messages: [...]
  })
})

// After: Multiple models with automatic fallback
const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  body: JSON.stringify({
    models: [
      "openai/gpt-4o",              // Primary: $15/million tokens
      "anthropic/claude-3.5-sonnet", // Fallback: $3/million tokens
      "google/gemini-pro"            // Budget: $0.5/million tokens
    ],
    messages: [...],
    provider: {
      sort: "price",
      allow_fallbacks: true
    }
  })
})
```

### 2. Auto Router

For non-critical tasks, the system can use OpenRouter's Auto Router to automatically select the best model:

```typescript
// Auto Router automatically selects optimal model for the task
const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  body: JSON.stringify({
    model: "openrouter/auto", // Automatic model selection
    messages: [...],
    provider: {
      sort: "price"
    }
  })
})
```

### 3. Provider Sorting

Prioritize cost-effective providers using the `:floor` suffix or `sort: 'price'`:

```typescript
// Provider sorting for cost optimization
const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  body: JSON.stringify({
    model: "anthropic/claude-3.5-sonnet",
    messages: [...],
    provider: {
      sort: "price",           // Prioritize cheapest providers
      allow_fallbacks: true    // Enable fallbacks if primary fails
    }
  })
})
```

## Implementation Details

### Automatic Cost Optimization

The system automatically applies cost optimization based on task characteristics:

```typescript
// In OpenRouterHandler.createMessage()
if (!fallbackModels && useAutoRouter === undefined) {
  const optimizationConfig = getCostOptimizationConfig(
    primaryModel,
    systemPrompt,
    messages.length,
    hasImages
  )
  
  fallbackModels = optimizationConfig.fallbackModels
  useAutoRouter = optimizationConfig.useAutoRouter
  providerSorting = optimizationConfig.providerSorting
}
```

### Task Complexity Detection

The system analyzes prompts to determine appropriate optimization strategies:

- **High Complexity**: Code, debugging, detailed analysis → Conservative fallbacks
- **Medium Complexity**: General tasks → Balanced approach
- **Low Complexity**: Summarization, translation → Aggressive cost optimization

### Intelligent Model Selection

```typescript
export const COST_EFFECTIVE_FALLBACKS = {
  high: [
    "anthropic/claude-3.5-sonnet",  // $3/million tokens
    "openai/gpt-4o",               // $15/million tokens
    "google/gemini-pro-1.5",       // $7/million tokens
  ],
  medium: [
    "anthropic/claude-3.5-haiku",   // $1/million tokens
    "openai/gpt-4o-mini",          // $0.6/million tokens
    "google/gemini-flash-1.5",     // $0.075/million tokens
  ],
  budget: [
    "meta-llama/llama-3.1-8b-instruct:free", // Free
    "mistralai/mistral-7b-instruct:free",    // Free
  ]
}
```

## Usage Examples

### Basic Usage (Automatic Optimization)

```typescript
const handler = new OpenRouterHandler({
  openRouterApiKey: 'your-key',
  openRouterModelId: 'openai/gpt-4o'
  // Cost optimization applied automatically
})
```

### Explicit Configuration

```typescript
const handler = new OpenRouterHandler({
  openRouterApiKey: 'your-key',
  openRouterModelId: 'anthropic/claude-3.5-sonnet',
  fallbackModels: [
    'anthropic/claude-3.5-haiku',
    'openai/gpt-4o-mini'
  ],
  useAutoRouter: false,
  openRouterProviderSorting: 'price'
})
```

### Maximum Cost Savings

```typescript
const handler = new OpenRouterHandler({
  openRouterApiKey: 'your-key',
  useAutoRouter: true,  // Let OpenRouter choose
  openRouterProviderSorting: 'price'
})
```

## Cost Savings Estimation

The system provides cost savings estimation:

```typescript
import { estimateCostSavings, getCostOptimizationConfig } from '@utils/cost-optimization'

const config = getCostOptimizationConfig('openai/gpt-4o', prompt, messageCount)
const savings = estimateCostSavings(15.0, config) // Returns percentage savings
console.log(`Estimated savings: ${savings}%`) // e.g., "Estimated savings: 35%"
```

## Potential Savings

| Strategy | Typical Savings | Use Case |
|----------|----------------|----------|
| Provider Sorting | 10-20% | All requests |
| Model Fallbacks | 15-40% | When primary model fails or is expensive |
| Auto Router | 20-50% | Simple, non-critical tasks |
| Combined | 20-70% | Optimal configuration |

## Configuration Options

### OpenRouterHandlerOptions

```typescript
interface OpenRouterHandlerOptions {
  openRouterApiKey?: string
  openRouterModelId?: string
  openRouterModelInfo?: ModelInfo
  openRouterProviderSorting?: string     // 'price', 'latency', 'throughput'
  fallbackModels?: string[]              // Array of fallback model IDs
  useAutoRouter?: boolean                // Use openrouter/auto model
  reasoningEffort?: string
  thinkingBudgetTokens?: number
}
```

### Cost Optimization Utility Functions

```typescript
// Generate intelligent fallbacks
const fallbacks = generateFallbackModels('openai/gpt-4o', 'medium')

// Determine if auto router should be used
const shouldUseAuto = shouldUseAutoRouter(prompt, messageCount, hasImages)

// Get complete optimization config
const config = getCostOptimizationConfig(model, prompt, messageCount, hasImages)

// Estimate potential savings
const savings = estimateCostSavings(modelPrice, config)
```

## Best Practices

1. **Start Conservative**: Begin with fallbacks to similar-tier models
2. **Test Thoroughly**: Validate that cheaper models meet quality requirements
3. **Monitor Costs**: Track actual savings and adjust configuration
4. **Task-Specific Optimization**: Use different strategies for different task types
5. **Gradual Implementation**: Roll out cost optimization incrementally

## Migration Guide

### From Single Model to Optimized

```typescript
// Before
const handler = new OpenRouterHandler({
  openRouterApiKey: 'key',
  openRouterModelId: 'openai/gpt-4o'
})

// After (automatic optimization)
const handler = new OpenRouterHandler({
  openRouterApiKey: 'key',
  openRouterModelId: 'openai/gpt-4o'
  // Optimization applied automatically
})

// After (explicit optimization)
const handler = new OpenRouterHandler({
  openRouterApiKey: 'key',
  openRouterModelId: 'openai/gpt-4o',
  fallbackModels: ['anthropic/claude-3.5-sonnet', 'openai/gpt-4o-mini'],
  openRouterProviderSorting: 'price'
})
```

## Monitoring and Analytics

The system provides cost tracking through usage chunks:

```typescript
for await (const chunk of handler.createMessage(prompt, messages)) {
  if (chunk.type === 'usage') {
    console.log(`Total cost: $${chunk.totalCost}`)
    console.log(`Input tokens: ${chunk.inputTokens}`)
    console.log(`Output tokens: ${chunk.outputTokens}`)
  }
}
```

## Troubleshooting

### Common Issues

1. **Quality Degradation**: If cheaper models produce lower quality, adjust fallback order
2. **Latency Increase**: Provider sorting by price may increase latency
3. **Model Compatibility**: Ensure fallback models support required features (images, tools)

### Debug Configuration

```typescript
// Enable detailed logging
const config = getCostOptimizationConfig(model, prompt, messageCount)
console.log('Optimization config:', config)

const savings = estimateCostSavings(modelPrice, config)
console.log('Estimated savings:', savings)
```

This implementation addresses the original issue by providing intelligent, automatic cost optimization while maintaining flexibility for explicit configuration when needed.