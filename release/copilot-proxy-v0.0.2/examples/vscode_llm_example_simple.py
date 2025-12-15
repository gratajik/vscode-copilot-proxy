"""
Simple example of using VS Code LLM proxy.

This demonstrates how to call Claude through VS Code's Language Model API
(GitHub Copilot) instead of the direct Anthropic API.

Requirements:
1. VS Code running with GitHub Copilot extension
2. A proxy server running at 127.0.0.1:8080 that bridges to VS Code's LLM API
3. Set VSCODE_LLM_ENDPOINT if using a different port

Usage:
    py examples/vscode_llm_example.py
"""

import asyncio
import aiohttp
import os


async def call_vscode_llm(
    prompt: str,
    system_prompt: str = "You are a helpful assistant.",
    model: str = "claude-3-5-sonnet",
    temperature: float = 0.7,
    max_tokens: int = 1000
) -> str:
    """
    Make a simple call to VS Code's LLM API.

    Args:
        prompt: The user's message
        system_prompt: System instructions for the model
        model: Model to use (default: claude-3-5-sonnet)
        temperature: Sampling temperature (0-1)
        max_tokens: Maximum tokens to generate

    Returns:
        The model's response text
    """
    # Get endpoint from environment or use default
    endpoint = os.getenv('VSCODE_LLM_ENDPOINT', 'http://127.0.0.1:8080/v1/chat/completions')

    # Build the request payload (OpenAI-compatible format)
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt}
        ],
        "temperature": temperature,
        "max_tokens": max_tokens
    }

    print(f"Calling VS Code LLM at {endpoint}...")
    print(f"Model: {model}")
    print(f"Prompt: {prompt[:100]}{'...' if len(prompt) > 100 else ''}")
    print("-" * 50)

    async with aiohttp.ClientSession() as session:
        async with session.post(
            endpoint,
            json=payload,
            headers={"Content-Type": "application/json"}
        ) as response:
            if response.status != 200:
                error_text = await response.text()
                raise Exception(f"API error ({response.status}): {error_text}")

            data = await response.json()

            # Extract response content
            if not data.get('choices'):
                raise Exception("No choices in response")

            content = data['choices'][0]['message']['content']

            # Print usage info if available
            usage = data.get('usage', {})
            if usage:
                print(f"Tokens - Input: {usage.get('prompt_tokens', '?')}, "
                      f"Output: {usage.get('completion_tokens', '?')}")

            return content


async def main():
    """Run example prompts through VS Code LLM."""

    # Example 1: Simple question
    print("\n" + "=" * 60)
    print("EXAMPLE 1: Simple Question")
    print("=" * 60)

    try:
        response = await call_vscode_llm(
            prompt="What are the three primary colors?",
            system_prompt="You are a helpful assistant. Give concise answers."
        )
        print(f"\nResponse:\n{response}")
    except Exception as e:
        print(f"\nError: {e}")
        print("\nMake sure:")
        print("  1. VS Code is running with GitHub Copilot")
        print("  2. The LLM proxy server is running at 127.0.0.1:8080")
        print("  3. Or set VSCODE_LLM_ENDPOINT to your proxy URL")
        return

    # Example 2: Code generation
    print("\n" + "=" * 60)
    print("EXAMPLE 2: Code Generation")
    print("=" * 60)

    try:
        response = await call_vscode_llm(
            prompt="Write a Python function that checks if a number is prime. Just the function, no explanation.",
            system_prompt="You are a Python expert. Write clean, efficient code.",
            max_tokens=500
        )
        print(f"\nResponse:\n{response}")
    except Exception as e:
        print(f"\nError: {e}")

    # Example 3: Creative writing
    print("\n" + "=" * 60)
    print("EXAMPLE 3: Creative Writing")
    print("=" * 60)

    try:
        response = await call_vscode_llm(
            prompt="Write a haiku about programming.",
            system_prompt="You are a creative writer.",
            temperature=0.9,
            max_tokens=100
        )
        print(f"\nResponse:\n{response}")
    except Exception as e:
        print(f"\nError: {e}")


if __name__ == "__main__":
    asyncio.run(main())
