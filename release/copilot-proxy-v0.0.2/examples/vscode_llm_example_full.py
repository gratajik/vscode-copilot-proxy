"""
Simple example of using VS Code LLM proxy with retry and Anthropic fallback.

This demonstrates how to call Claude through VS Code's Language Model API
(GitHub Copilot) with automatic retry on failures and fallback to direct
Anthropic API when VS Code LLM is unavailable.

Requirements:
1. VS Code running with GitHub Copilot extension
2. A proxy server running at 127.0.0.1:8080 that bridges to VS Code's LLM API
3. Set VSCODE_LLM_ENDPOINT if using a different port
4. Set ANTHROPIC_API_KEY for fallback support

Usage:
    py examples/vscode_llm_example.py
"""

import asyncio
import aiohttp
import os
from anthropic import AsyncAnthropic


# Configuration
VSCODE_MAX_RETRIES = 3
VSCODE_LLM_FALLBACK_ENABLED = os.getenv('VSCODE_LLM_FALLBACK', 'true').lower() == 'true'


class VSCodeLLMError(Exception):
    """Base exception for VS Code LLM errors."""
    pass


class ContentFilteredError(VSCodeLLMError):
    """Response was filtered by content policy."""
    pass


class EmptyResponseError(VSCodeLLMError):
    """Response contained no content."""
    pass


class VSCodeLLMConnectionError(VSCodeLLMError):
    """Failed to connect to VS Code LLM server."""
    pass


async def call_vscode_llm(
    prompt: str,
    system_prompt: str = "You are a helpful assistant.",
    model: str = "claude-3-5-sonnet",
    temperature: float = 0.7,
    max_tokens: int = 1000
) -> str:
    """
    Make a call to VS Code's LLM API with retry logic.

    Args:
        prompt: The user's message
        system_prompt: System instructions for the model
        model: Model to use (default: claude-3-5-sonnet)
        temperature: Sampling temperature (0-1)
        max_tokens: Maximum tokens to generate

    Returns:
        The model's response text

    Raises:
        VSCodeLLMError: If all retries fail
    """
    endpoint = os.getenv('VSCODE_LLM_ENDPOINT', 'http://127.0.0.1:8080/v1/chat/completions')

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
    print(f"Prompt: {prompt[:80]}{'...' if len(prompt) > 80 else ''}")

    last_error = None

    for attempt in range(VSCODE_MAX_RETRIES):
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    endpoint,
                    json=payload,
                    headers={"Content-Type": "application/json"},
                    timeout=aiohttp.ClientTimeout(total=120)
                ) as response:
                    if response.status != 200:
                        error_text = await response.text()
                        if 'filtered' in error_text.lower():
                            raise ContentFilteredError(f"Content filtered: {error_text}")
                        raise VSCodeLLMError(f"API error ({response.status}): {error_text}")

                    data = await response.json()

                    if not data.get('choices'):
                        raise EmptyResponseError("No choices in response")

                    content = data['choices'][0]['message']['content']
                    if not content:
                        raise EmptyResponseError("Empty content in response")

                    # Success!
                    usage = data.get('usage', {})
                    print(f"  [OK] VS Code LLM success (attempt {attempt + 1})")
                    if usage:
                        print(f"    Tokens - Input: {usage.get('prompt_tokens', '?')}, "
                              f"Output: {usage.get('completion_tokens', '?')}")

                    return content

        except aiohttp.ClientError as e:
            last_error = VSCodeLLMConnectionError(f"Connection error: {e}")
            print(f"  [FAIL] Connection error (attempt {attempt + 1}): {e}")

        except (ContentFilteredError, EmptyResponseError) as e:
            last_error = e
            print(f"  [FAIL] {type(e).__name__} (attempt {attempt + 1}): {e}")

        except VSCodeLLMError as e:
            last_error = e
            print(f"  [FAIL] VS Code LLM error (attempt {attempt + 1}): {e}")

        # Exponential backoff before retry
        if attempt < VSCODE_MAX_RETRIES - 1:
            wait_time = 2 ** (attempt + 1)  # 2, 4, 8 seconds
            print(f"    Retrying in {wait_time}s...")
            await asyncio.sleep(wait_time)

    # All retries exhausted
    raise last_error or VSCodeLLMError("All retries failed")


async def call_anthropic_fallback(
    prompt: str,
    system_prompt: str = "You are a helpful assistant.",
    model: str = "claude-sonnet-4-20250514",
    temperature: float = 0.7,
    max_tokens: int = 1000
) -> str:
    """
    Make a direct call to Anthropic API (fallback).

    Args:
        prompt: The user's message
        system_prompt: System instructions
        model: Model to use
        temperature: Sampling temperature
        max_tokens: Maximum tokens

    Returns:
        The model's response text
    """
    api_key = os.getenv('ANTHROPIC_API_KEY')
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY not set - cannot use fallback")

    print(f"  --> Falling back to Anthropic API...")
    print(f"    Model: {model}")

    client = AsyncAnthropic(api_key=api_key)

    response = await client.messages.create(
        model=model,
        max_tokens=max_tokens,
        temperature=temperature,
        system=system_prompt,
        messages=[{"role": "user", "content": prompt}]
    )

    # Extract text from response
    content = ""
    for block in response.content:
        if hasattr(block, 'text'):
            content += block.text

    print(f"  [OK] Anthropic API success")
    print(f"    Tokens - Input: {response.usage.input_tokens}, "
          f"Output: {response.usage.output_tokens}")

    return content


async def call_llm_with_fallback(
    prompt: str,
    system_prompt: str = "You are a helpful assistant.",
    temperature: float = 0.7,
    max_tokens: int = 1000
) -> str:
    """
    Call LLM with VS Code first, then fallback to Anthropic if needed.

    This is the main entry point that handles the full retry + fallback flow.

    Args:
        prompt: The user's message
        system_prompt: System instructions
        temperature: Sampling temperature
        max_tokens: Maximum tokens

    Returns:
        The model's response text
    """
    try:
        # Try VS Code LLM first (with retries)
        return await call_vscode_llm(
            prompt=prompt,
            system_prompt=system_prompt,
            temperature=temperature,
            max_tokens=max_tokens
        )

    except VSCodeLLMError as e:
        print(f"\n  VS Code LLM failed after {VSCODE_MAX_RETRIES} retries: {e}")

        # Check if fallback is enabled and available
        if not VSCODE_LLM_FALLBACK_ENABLED:
            print("  Fallback disabled (set VSCODE_LLM_FALLBACK=true to enable)")
            raise

        if not os.getenv('ANTHROPIC_API_KEY'):
            print("  No ANTHROPIC_API_KEY set - cannot fallback")
            raise

        # Fallback to Anthropic
        return await call_anthropic_fallback(
            prompt=prompt,
            system_prompt=system_prompt,
            temperature=temperature,
            max_tokens=max_tokens
        )


async def main():
    """Run example prompts demonstrating retry and fallback."""

    print("\n" + "=" * 70)
    print("VS CODE LLM EXAMPLE WITH RETRY AND ANTHROPIC FALLBACK")
    print("=" * 70)

    # Show configuration
    print(f"\nConfiguration:")
    print(f"  VS Code Endpoint: {os.getenv('VSCODE_LLM_ENDPOINT', 'http://127.0.0.1:8080/v1/chat/completions')}")
    print(f"  Max Retries: {VSCODE_MAX_RETRIES}")
    print(f"  Fallback Enabled: {VSCODE_LLM_FALLBACK_ENABLED}")
    print(f"  Anthropic API Key: {'Set' if os.getenv('ANTHROPIC_API_KEY') else 'Not set'}")

    # Example 1: Normal call (should succeed on VS Code LLM)
    print("\n" + "-" * 70)
    print("EXAMPLE 1: Simple Question")
    print("-" * 70)

    try:
        response = await call_llm_with_fallback(
            prompt="What is 2 + 2? Answer in one word.",
            system_prompt="You are a helpful assistant. Be concise."
        )
        print(f"\nResponse: {response}")
    except Exception as e:
        print(f"\nFailed: {e}")
        print("\nMake sure:")
        print("  1. VS Code is running with GitHub Copilot")
        print("  2. The LLM proxy server is running at 127.0.0.1:8080")
        print("  3. Set ANTHROPIC_API_KEY for fallback support")
        return

    # Example 2: Code generation
    print("\n" + "-" * 70)
    print("EXAMPLE 2: Code Generation")
    print("-" * 70)

    try:
        response = await call_llm_with_fallback(
            prompt="Write a one-line Python lambda that squares a number.",
            system_prompt="You are a Python expert. Give only the code, no explanation.",
            max_tokens=100
        )
        print(f"\nResponse: {response}")
    except Exception as e:
        print(f"\nFailed: {e}")

    # Example 3: Test fallback (optional - uncomment to force fallback)
    # print("\n" + "-" * 70)
    # print("EXAMPLE 3: Force Fallback Test")
    # print("-" * 70)
    #
    # # Temporarily set bad endpoint to force fallback
    # original_endpoint = os.getenv('VSCODE_LLM_ENDPOINT', '')
    # os.environ['VSCODE_LLM_ENDPOINT'] = 'http://127.0.0.1:9999/bad'
    #
    # try:
    #     response = await call_llm_with_fallback(
    #         prompt="Say 'Fallback worked!'",
    #         system_prompt="You are helpful."
    #     )
    #     print(f"\nResponse: {response}")
    # except Exception as e:
    #     print(f"\nFailed: {e}")
    # finally:
    #     if original_endpoint:
    #         os.environ['VSCODE_LLM_ENDPOINT'] = original_endpoint
    #     else:
    #         os.environ.pop('VSCODE_LLM_ENDPOINT', None)

    print("\n" + "=" * 70)
    print("DONE")
    print("=" * 70)


if __name__ == "__main__":
    asyncio.run(main())
