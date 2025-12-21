"""
Tool calling example using VS Code LLM proxy (pass-through mode).

This demonstrates how to use tool/function calling with the proxy.
The proxy returns tool calls to you, and you execute them locally.

Requirements:
1. VS Code running with GitHub Copilot extension
2. The proxy server running at 127.0.0.1:8080
3. Set VSCODE_LLM_ENDPOINT if using a different port

Usage:
    py examples/vscode_llm_tools_simple.py
"""

import asyncio
import aiohttp
import json
import os


# Define a simple tool
WEATHER_TOOL = {
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get the current weather for a location",
        "parameters": {
            "type": "object",
            "properties": {
                "location": {
                    "type": "string",
                    "description": "City name, e.g., 'London' or 'New York'"
                },
                "unit": {
                    "type": "string",
                    "enum": ["celsius", "fahrenheit"],
                    "description": "Temperature unit"
                }
            },
            "required": ["location"]
        }
    }
}


def execute_tool(name: str, arguments: dict) -> str:
    """
    Execute a tool locally and return the result.
    In a real application, this would call actual APIs.
    """
    if name == "get_weather":
        location = arguments.get("location", "Unknown")
        unit = arguments.get("unit", "celsius")
        # Simulated weather data
        temp = 22 if unit == "celsius" else 72
        return json.dumps({
            "location": location,
            "temperature": temp,
            "unit": unit,
            "condition": "Partly cloudy",
            "humidity": 65
        })
    return json.dumps({"error": f"Unknown tool: {name}"})


async def chat_with_tools(
    messages: list,
    tools: list,
    model: str = "claude-3.5-sonnet"
) -> dict:
    """
    Send a chat request with tools and return the response.
    """
    endpoint = os.getenv('VSCODE_LLM_ENDPOINT', 'http://127.0.0.1:8080/v1/chat/completions')

    payload = {
        "model": model,
        "messages": messages,
        "tools": tools
    }

    async with aiohttp.ClientSession() as session:
        async with session.post(
            endpoint,
            json=payload,
            headers={"Content-Type": "application/json"}
        ) as response:
            if response.status != 200:
                error_text = await response.text()
                raise Exception(f"API error ({response.status}): {error_text}")
            return await response.json()


async def main():
    """Demonstrate tool calling with the proxy."""

    print("\n" + "=" * 60)
    print("TOOL CALLING EXAMPLE (Pass-through Mode)")
    print("=" * 60)

    # Initial conversation
    messages = [
        {"role": "user", "content": "What's the weather like in London?"}
    ]
    tools = [WEATHER_TOOL]

    print(f"\nUser: {messages[0]['content']}")
    print("-" * 40)

    try:
        # Step 1: Send initial request with tools
        print("\nStep 1: Sending request with tools...")
        response = await chat_with_tools(messages, tools)

        choice = response['choices'][0]
        finish_reason = choice.get('finish_reason')
        message = choice['message']

        print(f"Finish reason: {finish_reason}")

        # Step 2: Check if model wants to call tools
        if finish_reason == 'tool_calls' and message.get('tool_calls'):
            tool_calls = message['tool_calls']
            print(f"\nStep 2: Model requested {len(tool_calls)} tool call(s)")

            # Add assistant message with tool calls to conversation
            messages.append(message)

            # Step 3: Execute each tool and add results
            for tool_call in tool_calls:
                tool_name = tool_call['function']['name']
                tool_args = json.loads(tool_call['function']['arguments'])
                tool_id = tool_call['id']

                print(f"\n  Executing: {tool_name}({tool_args})")
                result = execute_tool(tool_name, tool_args)
                print(f"  Result: {result}")

                # Add tool result to conversation
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_id,
                    "content": result
                })

            # Step 4: Send follow-up request with tool results
            print("\nStep 3: Sending tool results back to model...")
            final_response = await chat_with_tools(messages, tools)

            final_content = final_response['choices'][0]['message']['content']
            print(f"\nAssistant: {final_content}")

        else:
            # No tool calls, just print the response
            print(f"\nAssistant: {message.get('content', '(no content)')}")

    except Exception as e:
        print(f"\nError: {e}")
        print("\nMake sure:")
        print("  1. VS Code is running with GitHub Copilot")
        print("  2. The LLM proxy server is running at 127.0.0.1:8080")
        print("  3. Tool calling is supported by the model")


if __name__ == "__main__":
    asyncio.run(main())
