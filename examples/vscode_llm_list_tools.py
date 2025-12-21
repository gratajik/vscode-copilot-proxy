"""
List available VS Code tools using the proxy.

This shows all tools registered in VS Code that can be used
with the tool calling feature. Tools come from:
- VS Code built-in tools
- Installed extensions
- Connected MCP servers

Requirements:
1. VS Code running with GitHub Copilot extension
2. The proxy server running at 127.0.0.1:8080

Usage:
    py examples/vscode_llm_list_tools.py
    py examples/vscode_llm_list_tools.py --tags vscode
    py examples/vscode_llm_list_tools.py --name "get_*"
"""

import asyncio
import aiohttp
import argparse
import json
import os


async def list_tools(
    tags: str = None,
    name: str = None
) -> list:
    """
    List available tools from VS Code.

    Args:
        tags: Comma-separated tags to filter by (e.g., "vscode,editor")
        name: Name pattern with wildcards (e.g., "get_*")

    Returns:
        List of tool information dictionaries
    """
    base_url = os.getenv('VSCODE_LLM_ENDPOINT', 'http://127.0.0.1:8080')
    # Extract base URL if full endpoint was provided
    if '/v1/chat' in base_url:
        base_url = base_url.rsplit('/v1/', 1)[0]

    endpoint = f"{base_url}/v1/tools"

    # Build query parameters
    params = {}
    if tags:
        params['tags'] = tags
    if name:
        params['name'] = name

    async with aiohttp.ClientSession() as session:
        async with session.get(
            endpoint,
            params=params,
            headers={"Accept": "application/json"}
        ) as response:
            if response.status != 200:
                error_text = await response.text()
                raise Exception(f"API error ({response.status}): {error_text}")

            data = await response.json()
            return data.get('data', [])


def print_tool(tool: dict, show_schema: bool = False):
    """Pretty print a tool."""
    name = tool.get('name', 'Unknown')
    description = tool.get('description', 'No description')
    tags = tool.get('tags', [])

    print(f"\n  {name}")
    print(f"    Description: {description[:80]}{'...' if len(description) > 80 else ''}")
    if tags:
        print(f"    Tags: {', '.join(tags)}")

    if show_schema and tool.get('inputSchema'):
        schema = tool['inputSchema']
        props = schema.get('properties', {})
        required = schema.get('required', [])
        if props:
            print("    Parameters:")
            for prop_name, prop_info in props.items():
                req = "*" if prop_name in required else ""
                prop_type = prop_info.get('type', 'any')
                prop_desc = prop_info.get('description', '')
                print(f"      - {prop_name}{req} ({prop_type}): {prop_desc[:50]}")


async def main():
    """List and explore available VS Code tools."""

    parser = argparse.ArgumentParser(
        description="List available VS Code tools"
    )
    parser.add_argument(
        '--tags', '-t',
        help='Filter by tags (comma-separated, e.g., "vscode,editor")'
    )
    parser.add_argument(
        '--name', '-n',
        help='Filter by name pattern (e.g., "get_*")'
    )
    parser.add_argument(
        '--schema', '-s',
        action='store_true',
        help='Show parameter schemas for each tool'
    )
    parser.add_argument(
        '--json', '-j',
        action='store_true',
        help='Output raw JSON'
    )

    args = parser.parse_args()

    print("\n" + "=" * 60)
    print("VS CODE AVAILABLE TOOLS")
    print("=" * 60)

    try:
        tools = await list_tools(tags=args.tags, name=args.name)

        if args.json:
            print(json.dumps(tools, indent=2))
            return

        if not tools:
            print("\nNo tools found.")
            if args.tags or args.name:
                print(f"  Filters: tags={args.tags}, name={args.name}")
            print("\nThis could mean:")
            print("  - No VS Code extensions have registered tools")
            print("  - No MCP servers are connected")
            print("  - Your filters are too restrictive")
            return

        print(f"\nFound {len(tools)} tool(s):")

        if args.tags:
            print(f"  (filtered by tags: {args.tags})")
        if args.name:
            print(f"  (filtered by name: {args.name})")

        for tool in tools:
            print_tool(tool, show_schema=args.schema)

        print("\n" + "-" * 60)
        print("USAGE TIPS")
        print("-" * 60)
        print("""
To use these tools in your requests:

1. Pass-through mode (you handle tool calls):
   {
     "messages": [...],
     "tools": [<tool definitions>]
   }

2. Auto-execute mode (proxy handles tools):
   {
     "messages": [...],
     "use_vscode_tools": true,
     "tool_execution": "auto"
   }

See vscode_llm_tools_simple.py and vscode_llm_tools_auto.py for examples.
""")

    except Exception as e:
        print(f"\nError: {e}")
        print("\nMake sure:")
        print("  1. VS Code is running with GitHub Copilot")
        print("  2. The LLM proxy server is running at 127.0.0.1:8080")


if __name__ == "__main__":
    asyncio.run(main())
