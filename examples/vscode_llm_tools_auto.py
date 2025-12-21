"""
Auto-execute tool calling example using VS Code LLM proxy.

This demonstrates the auto-execute mode where the proxy handles
tool execution internally using VS Code's registered tools.
You just send a request and get the final answer.

Requirements:
1. VS Code running with GitHub Copilot extension
2. The proxy server running at 127.0.0.1:8080
3. VS Code tools available (check with vscode_llm_list_tools.py)

Usage:
    py examples/vscode_llm_tools_auto.py
"""

import asyncio
import aiohttp
import os


async def chat_with_auto_tools(
    prompt: str,
    use_vscode_tools: bool = True,
    tool_execution: str = "auto",
    max_tool_rounds: int = 5,
    model: str = "claude-3.5-sonnet"
) -> str:
    """
    Send a chat request with auto-execute tool mode.

    The proxy will:
    1. Include all VS Code registered tools
    2. Automatically execute any tool calls
    3. Loop until the model produces a final answer
    4. Return the final response

    Args:
        prompt: The user's question
        use_vscode_tools: Include VS Code's registered tools
        tool_execution: 'auto' for server-side execution, 'none' for pass-through
        max_tool_rounds: Maximum tool execution iterations
        model: Model to use

    Returns:
        The final response content
    """
    endpoint = os.getenv('VSCODE_LLM_ENDPOINT', 'http://127.0.0.1:8080/v1/chat/completions')

    payload = {
        "model": model,
        "messages": [
            {"role": "user", "content": prompt}
        ],
        "use_vscode_tools": use_vscode_tools,
        "tool_execution": tool_execution,
        "max_tool_rounds": max_tool_rounds
    }

    print(f"Sending request to {endpoint}")
    print(f"  use_vscode_tools: {use_vscode_tools}")
    print(f"  tool_execution: {tool_execution}")
    print(f"  max_tool_rounds: {max_tool_rounds}")
    print("-" * 40)

    async with aiohttp.ClientSession() as session:
        async with session.post(
            endpoint,
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=aiohttp.ClientTimeout(total=120)  # Allow time for tool execution
        ) as response:
            if response.status != 200:
                error_text = await response.text()
                raise Exception(f"API error ({response.status}): {error_text}")

            data = await response.json()

            if not data.get('choices'):
                raise Exception("No choices in response")

            choice = data['choices'][0]
            message = choice['message']

            # In auto mode, we should get a final response (no tool_calls)
            if message.get('tool_calls'):
                print("Warning: Response still contains tool_calls")
                print("This might mean max_tool_rounds was exceeded")

            return message.get('content', '')


async def main():
    """Demonstrate auto-execute tool calling mode."""

    print("\n" + "=" * 60)
    print("AUTO-EXECUTE TOOL CALLING EXAMPLE")
    print("=" * 60)
    print("\nThis mode lets the proxy handle tool execution automatically.")
    print("You just ask a question and get the final answer.\n")

    # Example 1: Simple question that might use tools
    print("=" * 60)
    print("EXAMPLE 1: Question that may trigger VS Code tools")
    print("=" * 60)

    try:
        response = await chat_with_auto_tools(
            prompt="List the files in the current workspace's src folder",
            max_tool_rounds=3
        )
        print(f"\nResponse:\n{response}")
    except Exception as e:
        print(f"\nError: {e}")
        print("\nThis is expected if no file-related tools are available.")
        print("The available tools depend on your VS Code extensions.")

    # Example 2: With custom tools (hybrid mode)
    print("\n" + "=" * 60)
    print("EXAMPLE 2: Agentic workflow")
    print("=" * 60)

    try:
        response = await chat_with_auto_tools(
            prompt="What extensions are currently installed in VS Code?",
            max_tool_rounds=5
        )
        print(f"\nResponse:\n{response}")
    except Exception as e:
        print(f"\nError: {e}")

    # Example 3: Show what happens when no tools are needed
    print("\n" + "=" * 60)
    print("EXAMPLE 3: Question that doesn't need tools")
    print("=" * 60)

    try:
        response = await chat_with_auto_tools(
            prompt="What is 2 + 2?",
            use_vscode_tools=True,
            max_tool_rounds=1
        )
        print(f"\nResponse:\n{response}")
    except Exception as e:
        print(f"\nError: {e}")

    print("\n" + "=" * 60)
    print("NOTES")
    print("=" * 60)
    print("""
- Available tools depend on your VS Code extensions
- Use vscode_llm_list_tools.py to see what tools are available
- tool_execution: 'auto' = proxy executes tools
- tool_execution: 'none' = you handle tool calls (see vscode_llm_tools_simple.py)
- max_tool_rounds limits how many times the model can call tools
""")


if __name__ == "__main__":
    asyncio.run(main())
