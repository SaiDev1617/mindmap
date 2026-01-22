"""Fallback LLM transformation for large documents that exceed token limits."""

import json
import os
from typing import Any, Dict, List

import tiktoken
from dotenv import load_dotenv
from llama_index.llms.openai import OpenAI
from llama_index.core.llms import ChatMessage, MessageRole
from pydantic import BaseModel

from . import prompts

load_dotenv()

# Token limit from environment (default 175k)
TOKEN_LIMIT = int(os.getenv("TOKEN_LIMIT", "175000"))
CHUNK_SIZE = 100000  # 100k tokens per chunk


def count_tokens_in_json(data: Dict[str, Any], model: str = "gpt-4.1") -> int:
    """Count tokens in a JSON object using tiktoken."""
    try:
        encoding = tiktoken.encoding_for_model(model)
    except KeyError:
        # Fallback to cl100k_base encoding (used by gpt-4 and gpt-3.5-turbo)
        encoding = tiktoken.get_encoding("cl100k_base")
    
    json_str = json.dumps(data, ensure_ascii=False)
    return len(encoding.encode(json_str))


def split_tree_into_chunks(tree: Dict[str, Any], chunk_size: int = CHUNK_SIZE) -> List[Dict[str, Any]]:
    """
    Split TOC tree into chunks of approximately chunk_size tokens.
    Each chunk contains a subset of the children from the root.
    """
    chunks = []
    current_chunk = {
        "title": tree.get("title", ""),
        "children": []
    }
    
    # Add other root-level fields if present
    for key in ["page", "sections"]:
        if key in tree:
            current_chunk[key] = tree[key]
    
    current_tokens = count_tokens_in_json({k: v for k, v in current_chunk.items() if k != "children"})
    
    for child in tree.get("children", []):
        child_tokens = count_tokens_in_json(child)
        
        # If adding this child exceeds chunk size and we have some children already, start new chunk
        if current_tokens + child_tokens > chunk_size and current_chunk["children"]:
            chunks.append(current_chunk)
            current_chunk = {
                "title": tree.get("title", ""),
                "children": []
            }
            for key in ["page", "sections"]:
                if key in tree:
                    current_chunk[key] = tree[key]
            current_tokens = count_tokens_in_json({k: v for k, v in current_chunk.items() if k != "children"})
        
        current_chunk["children"].append(child)
        current_tokens += child_tokens
    
    # Add the last chunk if it has children
    if current_chunk["children"]:
        chunks.append(current_chunk)
    
    return chunks


def transform_large_tree_chunked(
    toc_tree_data: Dict[str, Any],
    pydantic_schema: type[BaseModel],
    output_file: str = "mindmap_transformed.json"
) -> Dict[str, Any]:
    """
    Transform a large TOC tree that exceeds token limits by processing in chunks.
    Alternates between gpt-4.1 and gpt-5.1 models for each chunk.
    """
    if not os.getenv("OPENAI_API_KEY"):
        raise RuntimeError("Set OPENAI_API_KEY in your environment first.")
    
    print("\n" + "="*80)
    print("⚠️  CHUNKED PROCESSING MODE (Token limit exceeded)")
    print("="*80)
    
    # Split into chunks
    print(f"\n📦 Splitting TOC tree into chunks of {CHUNK_SIZE:,} tokens each...")
    chunks = split_tree_into_chunks(toc_tree_data, CHUNK_SIZE)
    print(f"   Created {len(chunks)} chunks")
    
    for i, chunk in enumerate(chunks):
        chunk_tokens = count_tokens_in_json(chunk)
        num_children = len(chunk.get("children", []))
        print(f"   Chunk {i+1}: ~{chunk_tokens:,} tokens, {num_children} top-level sections")
    
    # System prompt (same for all iterations)
    system_prompt = prompts.TRANSFORM_SYSTEM_PROMPT
    
    # Process chunks iteratively
    previous_response = None
    
    for i, chunk in enumerate(chunks):
        chunk_num = i + 1
        total_chunks = len(chunks)
        
        # Alternate between gpt-4.1 (odd iterations) and gpt-5.1 (even iterations)
        model = "gpt-4.1" if chunk_num % 2 == 1 else "gpt-5.1"
        
        print(f"\n🤖 Processing Chunk {chunk_num}/{total_chunks} with {model}...")
        
        # Convert chunk to JSON string
        chunk_json_str = json.dumps(chunk, indent=2, ensure_ascii=False)
        
        # Build user message based on iteration
        if chunk_num == 1:
            # First chunk
            user_message = f"""**IMPORTANT: PARTIAL DATA NOTICE**

Due to character/token limits, I'm sending you the document tree in multiple parts.

This is **CHUNK {chunk_num} of {total_chunks}** (approximately {CHUNK_SIZE:,} tokens).

Here is the first chunk of the document tree:

{chunk_json_str}

Please transform this first chunk according to the schema. More chunks will follow in subsequent messages.
"""
        else:
            # Subsequent chunks - include previous response
            previous_response_str = json.dumps(previous_response, indent=2, ensure_ascii=False)
            user_message = f"""**CONTINUATION: CHUNK {chunk_num} of {total_chunks}**

Due to token limits, we're processing this large document in chunks.

**Previous Response (from chunks 1-{chunk_num-1}):**
{previous_response_str}

**New Chunk {chunk_num} Data:**
{chunk_json_str}

Please **MERGE** this new chunk with the previous response to create an **UPDATED and COMPLETE** mindmap schema.
Ensure all important topics from both the previous result and this new chunk are included.
Maintain consistency in structure, naming, and relationships.
"""
        
        # Build messages using ChatMessage objects
        messages = [
            ChatMessage(role=MessageRole.SYSTEM, content=system_prompt),
            ChatMessage(role=MessageRole.USER, content=user_message)
        ]
        
        # Initialize LLM for this iteration
        llm = OpenAI(model=model, max_tokens=32000, api_key=os.getenv("OPENAI_API_KEY"))
        sllm = llm.as_structured_llm(pydantic_schema)
        
        # Call LLM
        print(f"   📤 Sending to {model} (system: {len(system_prompt):,} chars, user: {len(user_message):,} chars)...")
        resp = sllm.chat(messages)
        
        # Extract result
        print(f"   📥 Received response from {model}")
        transformed = resp.raw
        previous_response = transformed.model_dump(exclude_none=True)
        
        # Save intermediate result
        intermediate_file = output_file.replace(".json", f"_chunk_{chunk_num}.json")
        with open(intermediate_file, "w", encoding="utf-8") as f:
            json.dump(previous_response, f, indent=2, ensure_ascii=False)
        print(f"   ✅ Chunk {chunk_num} complete (saved to {intermediate_file})")
    
    # Save final result
    final_result = previous_response
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(final_result, f, indent=2, ensure_ascii=False)
    
    print("\n" + "="*80)
    print("✅ CHUNKED PROCESSING COMPLETE!")
    print("="*80)
    print(f"   Final schema saved to: {output_file}")
    print(f"   Root title: {final_result.get('title', 'N/A')}")
    print(f"   Total top-level children: {len(final_result.get('children', []))}")
    
    return final_result
