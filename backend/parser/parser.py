# Combined parser that supports both LlamaParse and Docling
# Set environment variable USE_LLAMAPARSE=TRUE to use LlamaParse, otherwise uses Docling

import json
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from llama_index.core import Document
from llama_index.core.node_parser import MarkdownNodeParser
from llama_index.core.schema import MetadataMode

# Load environment variables
load_dotenv()

# Configuration from environment
USE_LLAMAPARSE = os.getenv("USE_LLAMAPARSE", "FALSE").upper() == "TRUE"
DATA_FOLDER = os.getenv("DATA_FOLDER", "data")
OUTPUT_MD = os.getenv("OUTPUT_MD", "parser/output/parsed.md")
OUTPUT_TOC = os.getenv("OUTPUT_TOC", "toc_tree.json")

# Hardcoded constants
HEADER_PATH_SEPARATOR = " > "  # Separator for header paths

# Ensure output directory exists
os.makedirs(os.path.dirname(OUTPUT_MD) if os.path.dirname(OUTPUT_MD) else ".", exist_ok=True)

HEADER_RE = re.compile(r"^(#+)\s+(.*)\s*$")


def find_document_file(data_folder: str) -> Optional[str]:
    """Find the first PDF or DOCX file in the data folder."""
    data_path = Path(data_folder)
    
    if not data_path.exists():
        raise FileNotFoundError(f"Data folder '{data_folder}' does not exist")
    
    # Supported file extensions
    supported_extensions = ['.pdf', '.docx']
    
    # Find all supported files
    files = []
    for ext in supported_extensions:
        files.extend(list(data_path.glob(f"*{ext}")))
    
    if not files:
        raise FileNotFoundError(f"No PDF or DOCX files found in '{data_folder}' folder")
    
    # Return the first file found (sorted for consistency)
    file_path = sorted(files)[0]
    print(f"Found document: {file_path}")
    return str(file_path)


def parse_pdf_with_llamaparse(pdf_path: str) -> str:
    """Parse PDF using LlamaParse and return markdown text."""
    from llama_parse import LlamaParse
    
    parser = LlamaParse(result_type="markdown")
    extra_info = {"file_name": pdf_path}
    
    with open(pdf_path, "rb") as f:
        docs = parser.load_data(f, extra_info=extra_info)
    
    markdown_text = "\n\n".join(d.text for d in docs)
    return markdown_text


def parse_pdf_with_docling(pdf_path: str) -> str:
    """Parse PDF using Docling and return markdown text."""
    from docling.document_converter import DocumentConverter
    
    converter = DocumentConverter()
    doc = converter.convert(pdf_path).document
    md = doc.export_to_markdown()
    return md


def parse_header_path(header_path: Optional[str], sep: str) -> List[str]:
    """MarkdownNodeParser stores an ancestor header path string; convert to list."""
    if not header_path or header_path == sep:
        return []
    s = header_path
    if s.startswith(sep):
        s = s[len(sep):]
    if s.endswith(sep):
        s = s[:-len(sep)]
    return [p.strip() for p in s.split(sep) if p.strip()]


def extract_heading_level_title_and_body(node) -> Dict[str, Any]:
    """
    Node content includes the header line + the body under it.
    We'll parse:
      - heading_level (len of #)
      - heading_title
      - body (text under the heading)
    """
    full_text = node.get_content(metadata_mode=MetadataMode.NONE)
    lines = full_text.splitlines()

    # Handle "preamble" / malformed markdown (no heading line)
    if not lines:
        return {
            "heading_level": None,
            "heading_title": "(empty)",
            "body": "",
        }

    m = HEADER_RE.match(lines[0])
    if not m:
        body = full_text.strip()
        return {
            "heading_level": None,
            "heading_title": "(preamble)",
            "body": body,
        }

    heading_level = len(m.group(1))
    heading_title = m.group(2).strip()
    body = "\n".join(lines[1:]).strip()

    return {
        "heading_level": heading_level,
        "heading_title": heading_title,
        "body": body,
    }


def ensure_child(parent: Dict[str, Any], title: str) -> Dict[str, Any]:
    """Ensure a child node exists in the parent, return it."""
    for c in parent["children"]:
        if c.get("title") == title:
            return c
    new_node = {"title": title, "children": []}
    parent["children"].append(new_node)
    return new_node


def nodes_to_toc_tree(nodes) -> Dict[str, Any]:
    """
    Builds TOC tree:
      - path = header_path (ancestors) + current heading
      - stores only ONE text field
    """
    root: Dict[str, Any] = {"title": "ROOT", "children": []}

    for n in nodes:
        meta = getattr(n, "metadata", {}) or {}
        ancestors = parse_header_path(meta.get("header_path"), HEADER_PATH_SEPARATOR)

        info = extract_heading_level_title_and_body(n)
        heading_title = info["heading_title"]

        # Build path (ancestors + current heading)
        path = ancestors + [heading_title]

        cur = root
        for t in path:
            cur = ensure_child(cur, t)

        # Store section text
        section_text = info["body"]

        payload = {
            "node_id": getattr(n, "node_id", None),
            "heading_level": info["heading_level"],
            "section_text": section_text,
        }

        cur.setdefault("sections", []).append(payload)

    return root


def parse_document_to_markdown(document_path: str) -> str:
    """Parse document (PDF/DOCX) to markdown text."""
    if USE_LLAMAPARSE:
        print(f"Parsing {document_path} with LlamaParse...")
        return parse_pdf_with_llamaparse(document_path)
    else:
        print(f"Parsing {document_path} with Docling...")
        return parse_pdf_with_docling(document_path)


def markdown_to_toc_tree(markdown_text: str) -> Dict[str, Any]:
    """Convert markdown text to TOC tree structure."""
    doc = Document(text=markdown_text)
    
    parser = MarkdownNodeParser.from_defaults(
        include_metadata=True,
        include_prev_next_rel=False,
        header_path_separator=HEADER_PATH_SEPARATOR,
    )
    
    nodes = parser.get_nodes_from_documents([doc])
    toc_tree = nodes_to_toc_tree(nodes)
    
    return toc_tree
