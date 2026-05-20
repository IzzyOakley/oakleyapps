import json
import os
from pathlib import Path

import anthropic
from json_repair import repair_json

_client = None


def get_client():
    global _client
    if _client is None:
        _client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    return _client


def _load_system_prompt() -> str:
    return (Path(__file__).parent / "prompts" / "bid_v1.md").read_text()


async def generate_bid(
    takeoff_items, vendor_profile, cost_code, cost_code_name, vendor_id,
    notes_context: dict | None = None,
) -> dict:
    import asyncio

    system_prompt = _load_system_prompt()
    categories = vendor_profile.get("pricing_profile", {}).get("categories", {})
    vendor_history = categories.get(cost_code, {})

    vendor_lines = []
    for line_name, line_data in vendor_history.items():
        ext = line_data.get("extension", {})
        vendor_lines.append(
            {
                "name": line_name,
                "unit": line_data.get("unit", ""),
                "description": line_data.get("description", ""),
                "avg": ext.get("avg"),
                "min": ext.get("min"),
                "max": ext.get("max"),
                "sample_count": ext.get("sample_count", 0),
            }
        )

    notes_block = ""
    if notes_context:
        notes_block = (
            f"PROJECT NOTES CONTEXT:\n{json.dumps(notes_context, indent=2)}\n\n"
        )

    user_message = f"""Cost Code: {cost_code} — {cost_code_name}

{notes_block}TAKEOFF ITEMS:
{json.dumps(takeoff_items, indent=2)}

VENDOR HISTORICAL PRICING (for cost code {cost_code}):
{json.dumps(vendor_lines, indent=2)}

Generate the bid line items for this vendor."""

    def _call():
        client = get_client()
        model = os.environ.get("MODEL_VERSION", "claude-opus-4-6")
        msg = client.messages.create(
            model=model,
            max_tokens=4096,
            system=system_prompt,
            messages=[{"role": "user", "content": user_message}],
        )
        return msg.content[0].text

    raw = await asyncio.to_thread(_call)

    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        result = json.loads(repair_json(raw))

    return result
