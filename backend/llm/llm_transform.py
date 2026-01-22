"""LLM transformation functions for converting TOC tree to mindmap format."""

import json
import os
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from llama_index.llms.openai import OpenAI
from llama_index.core.llms import ChatMessage, MessageRole
from pydantic import BaseModel, Field

from . import prompts
from .fallback_llm import count_tokens_in_json, transform_large_tree_chunked, TOKEN_LIMIT

# Load environment variables
load_dotenv()

# Configuration from environment
LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4.1")
MAX_SECTION_TEXT_LENGTH = int(os.getenv("MAX_SECTION_TEXT_LENGTH", "3000"))


# Pydantic schemas for the transformed format
# Using descriptive names: MindmapSection (parent that can have children) and MindmapDocument (root)

class MindmapSection(BaseModel):
    """Schema for a mindmap section representing a parent node that can contain child sections in the document hierarchy.
    
    This represents any level of the hierarchy (sections, subsections, etc.) that can have children.
    Each section is a parent that contains more specific child sections.
    """
    title: str = Field(
        description="The title/heading of this section (format: icon + space + 1-3 words MAXIMUM). The icon must be included as part of the title string on the left side, followed by a space, then the title text. Example: '🏥 Medical Plans', '💰 HSA Plan', '✅ Eligibility'. Required for all sections. Must be short and concise."
    )
    question: Optional[str] = Field(
        default=None,
        description="A natural, conversational question that a user would ask to learn more about this specific topic. This should be specific and meaningful. CREATE A MEANINGFUL QUESTION FOR EVERY SECTION - even if section_text is empty, create a question based on the title. This field should be populated for all sections, not just the root. Example: 'What are the medical plan options available?' or 'How does the HSA plan work?' or 'What are the steps to complete enrollment?'"
    )
    description: Optional[str] = Field(
        default=None,
        description="A brief one-sentence description (max 200 chars) explaining what this topic covers. This provides context about the section's content. Required for root document, recommended for all sections."
    )
    keywords: Optional[List[str]] = Field(
        default=None,
        description="List of 3-7 relevant keywords or key phrases (1-3 words each) that relate to this topic. These help with search and categorization."
    )
    children: Optional[List['MindmapSection']] = Field(
        default=None,
        description="Child sections representing more specific subtopics that belong under this parent section. Each child section follows the same structure (title, question, description, keywords, and potentially more children). This creates the parent-child hierarchy. Omit this field if the section has no children."
    )

class MindmapDocument(BaseModel):
    """Schema for the root mindmap document representing the entire document structure.
    
    This is the top-level parent that contains all major sections of the document.
    It represents the whole document and contains child sections as its children.
    """
    title: str = Field(
        description="The main document title or topic (format: icon + space + 1-3 words MAXIMUM). The icon must be included as part of the title string on the left side, followed by a space, then the title text. Example: '📄 Benefits Guide', '📋 Enrollment Manual'. This should be the actual document subject, NOT generic names like 'My Document Mind Map'. Required. Must be short and concise."
    )
    question: Optional[str] = Field(
        default=None,
        description="A natural, meaningful question about the overall document. This should help users understand what the document is about. REQUIRED for root document. Even if section_text is empty, create a meaningful question based on the title. Example: 'What is this document about?' or 'What benefits does the company provide?'"
    )
    description: Optional[str] = Field(
        default=None,
        description="A concise 1-2 sentence summary (max 200 chars) describing the document's main purpose and scope. REQUIRED for root document."
    )
    keywords: Optional[List[str]] = Field(
        default=None,
        description="List of 3-7 main keywords or key phrases (1-3 words each) that represent the document's primary topics."
    )
    children: Optional[List[MindmapSection]] = Field(
        default=None,
        description="Top-level child sections (5-8 major themes) of the document. Each child section is a parent that can contain its own child sections, creating a parent-child hierarchy. Each section should have distinct topics. Omit if empty."
    )

# Allow forward references for recursive type
MindmapSection.model_rebuild()


def combine_section_texts(node: Dict[str, Any]) -> str:
    """Combine all section_text from a node's sections array into a single string.
    
    Sections can be either:
    - Array of strings: ["text1", "text2"]  (new format)
    - Array of objects: [{"section_text": "text1"}]  (old format)
    """
    sections = node.get("sections", [])
    if not sections:
        return ""
    
    # Handle both new format (array of strings) and old format (array of objects)
    texts = []
    for s in sections:
        if isinstance(s, str):
            # New format: sections is array of strings
            if s.strip():
                texts.append(s.strip())
        elif isinstance(s, dict):
            # Old format: sections is array of objects with section_text
            text = s.get("section_text", "").strip()
            if text:
                texts.append(text)
    
    return "\n\n".join(texts)


def clean_toc_tree(node: Dict[str, Any], max_section_text_length: int = MAX_SECTION_TEXT_LENGTH) -> Dict[str, Any]:
    """
    Recursively clean TOC tree by removing unnecessary fields:
    - Convert sections array from objects to simple string array
    - Remove empty/useless section_text (dots, short text < 10 chars)
    - Trim section_text to max_section_text_length characters (default: 3000)
    - Remove node_id, heading_level completely
    """
    # Create a copy to avoid modifying the original
    cleaned = node.copy()
    
    # Clean sections array - convert to simple array of text strings
    if "sections" in cleaned:
        cleaned_sections = []
        for section in cleaned["sections"]:
            if "section_text" in section:
                section_text = section["section_text"].strip()
                
                # Skip if empty or too short (< 10 chars)
                if len(section_text) < 10:
                    continue
                
                # Skip if mostly dots/periods (table of contents artifacts)
                dot_count = section_text.count('.') + section_text.count('…')
                if dot_count > len(section_text) * 0.5:  # More than 50% dots
                    continue
                
                # Trim to max length if it's longer
                if len(section_text) > max_section_text_length:
                    section_text = section_text[:max_section_text_length] + "..."
                
                # Just append the text string, not an object
                cleaned_sections.append(section_text)
        
        # Only keep sections array if it has meaningful content
        if cleaned_sections:
            cleaned["sections"] = cleaned_sections
        else:
            # Remove sections array entirely if empty
            cleaned.pop("sections", None)
    
    # Recursively clean children
    if "children" in cleaned and cleaned["children"]:
        cleaned["children"] = [clean_toc_tree(child, max_section_text_length) for child in cleaned["children"]]
    
    return cleaned


def transform_toc_tree_to_api_format(toc_tree_data: Dict[str, Any], output_file: str = "mindmap_transformed.json"):
    """
    Transforms the hierarchical TOC tree JSON to a simple tree structure using LLM.
    Each node has: title, question, description, keywords, children
    The input structure has: title, children, sections (with section_text)
    """
    if not os.getenv("OPENAI_API_KEY"):
        raise RuntimeError("Set OPENAI_API_KEY in your environment first.")
    
    # Clean TOC tree: remove node_id and heading_level, trim section_text to 3000 chars
    cleaned_toc_tree = clean_toc_tree(toc_tree_data, max_section_text_length=MAX_SECTION_TEXT_LENGTH)
    
    # Count tokens in the cleaned tree
    toc_tokens = count_tokens_in_json(cleaned_toc_tree)
    
    # Check if we need chunked processing
    if toc_tokens > TOKEN_LIMIT:
        print(f"Document size: {toc_tokens:,} tokens - using chunked processing")
        
        # Use chunked processing
        result = transform_large_tree_chunked(
            toc_tree_data=cleaned_toc_tree,
            pydantic_schema=MindmapDocument,
            output_file=output_file
        )
        return result
    
    # Initialize LLM directly here with 5 minute timeout
    llm = OpenAI(
        model=LLM_MODEL, 
        max_tokens=32000, 
        api_key=os.getenv("OPENAI_API_KEY"),
        timeout=300.0  # 5 minutes timeout
    )
    
    # Convert cleaned toc_tree_data to JSON string for LLM
    toc_json_str = json.dumps(cleaned_toc_tree, indent=2, ensure_ascii=False)
    
    try:
        # Use structured LLM output
        sllm = llm.as_structured_llm(MindmapDocument)
        
        # Build chat messages: system prompt first, then user message with tree data
        system_prompt = prompts.TRANSFORM_SYSTEM_PROMPT
        user_prompt = prompts.TRANSFORM_USER_PROMPT.format(toc_json=toc_json_str)
        
        # Create ChatMessage objects for llama_index
        messages = [
            ChatMessage(role=MessageRole.SYSTEM, content=system_prompt),
            ChatMessage(role=MessageRole.USER, content=user_prompt)
        ]
        
        resp = sllm.chat(messages)
        
    except Exception as token_error:
        # Check if it's a token limit error (context length or rate limit due to tokens)
        error_msg = str(token_error).lower()
        error_type = type(token_error).__name__
        
        # Check for token-related errors: context length, rate limits due to tokens, request too large
        is_token_error = (
            "token" in error_msg or 
            "context" in error_msg or 
            "length" in error_msg or 
            "maximum context" in error_msg or
            "request too large" in error_msg or
            "tokens per min" in error_msg or
            "tpm" in error_msg or
            ("ratelimiterror" in error_type.lower() and "token" in error_msg)
        )
        
        if is_token_error:
            print(f"Token limit exceeded, retrying with larger context model...")
            
            # Retry with GPT-4.1 which has larger context, with 5 minute timeout
            llm = OpenAI(
                model="gpt-4.1-nano", 
                max_tokens=32000, 
                api_key=os.getenv("OPENAI_API_KEY"),
                timeout=300.0  # 5 minutes timeout
            )
            sllm = llm.as_structured_llm(MindmapDocument)
            resp = sllm.chat(messages)
        else:
            # Re-raise if it's not a token error
            raise
    
    try:
        # Extract structured data
        transformed: MindmapDocument = resp.raw
        
        # Convert Pydantic model to dict
        result = transformed.model_dump(exclude_none=True)
        
        # Save to new file (LLM has handled all transformation, limits, and deduplication)
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
        
        print(f"✅ Mindmap saved: {output_file}")
        return result
        
    except Exception as e:
        print(f"\n⚠️  Transformation error: {type(e).__name__}")
        print(f"Falling back to chunked processing...\n")
        
        # Fallback: use chunked processing with LLM
        result = transform_large_tree_chunked(
            toc_tree_data=cleaned_toc_tree,
            pydantic_schema=MindmapDocument,
            output_file=output_file
        )
        return result


def transform_toc_tree_to_mindmap(toc_file: str, output_file: str = "mindmap_transformed.json"):
    """
    Transform the TOC tree JSON file to mindmap format.
    This function loads the TOC tree and transforms it using LLM.
    """
    # Load TOC tree
    print(f"📖 Loading TOC tree from {toc_file}...")
    with open(toc_file, "r", encoding="utf-8") as f:
        toc_tree_data = json.load(f)
    
    # Transform to mindmap format (LLM is initialized inside the function)
    print(f"🔄 Transforming TOC tree to mindmap format...")
    result = transform_toc_tree_to_api_format(toc_tree_data, output_file=output_file)
    
    return result
