"""End-to-end pipeline for document parsing and mindmap transformation."""

import json
import os
from typing import Optional

from dotenv import load_dotenv

from parser.parser import (
    DATA_FOLDER,
    OUTPUT_MD,
    OUTPUT_TOC,
    USE_LLAMAPARSE,
    find_document_file,
    markdown_to_toc_tree,
    parse_document_to_markdown,
)
from llm.llm_transform import transform_toc_tree_to_mindmap

# Load environment variables
load_dotenv()

# Configuration from environment
OUTPUT_MINDMAP = os.getenv("OUTPUT_MINDMAP", "mindmap_transformed.json")


def run_pipeline(
    data_folder: Optional[str] = None,
    output_md: Optional[str] = None,
    output_toc: Optional[str] = None,
    output_mindmap: Optional[str] = None,
    skip_transform: bool = False,
) -> dict:
    """
    Run the complete pipeline: parse document -> generate markdown -> create TOC tree -> transform to mindmap.
    
    Args:
        data_folder: Path to data folder (default: from env)
        output_md: Output markdown file path (default: from env)
        output_toc: Output TOC tree file path (default: from env)
        output_mindmap: Output mindmap file path (default: from env)
        skip_transform: Skip the transformation step (default: False)
    
    Returns:
        dict: The transformed mindmap data
    """
    # Use provided values or fall back to environment/config
    data_folder = data_folder or DATA_FOLDER
    output_md = output_md or OUTPUT_MD
    output_toc = output_toc or OUTPUT_TOC
    output_mindmap = output_mindmap or OUTPUT_MINDMAP
    
    # Step 1: Find and parse document
    try:
        document_path = find_document_file(data_folder)
    except FileNotFoundError as e:
        print(f"Error: {e}")
        return {}
    
    # Step 2: Parse document to markdown
    try:
        markdown_text = parse_document_to_markdown(document_path)
        
        # Ensure output directory exists
        import os
        os.makedirs(os.path.dirname(output_md) if os.path.dirname(output_md) else ".", exist_ok=True)
        
        # Write markdown to file
        with open(output_md, "w", encoding="utf-8") as f:
            f.write(markdown_text)
        
    except Exception as e:
        print(f"Error parsing PDF: {e}")
        return {}
    
    # Step 3: Parse markdown and generate TOC tree
    try:
        with open(output_md, "r", encoding="utf-8") as f:
            md = f.read()
        
        toc_tree = markdown_to_toc_tree(md)
        
        # Write TOC tree to file
        with open(output_toc, "w", encoding="utf-8") as f:
            json.dump(toc_tree, f, ensure_ascii=False, indent=2)
        
        # Step 4: Automatically transform to mindmap format (unless skipped)
        if not skip_transform:
            try:
                result = transform_toc_tree_to_mindmap(toc_file=output_toc, output_file=output_mindmap)
                return result
            except Exception as e:
                print(f"Warning: Could not transform to mindmap format: {e}")
                return {}
        
        return {}
    
    except Exception as e:
        print(f"Error generating TOC tree: {e}")
        return {}


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Run end-to-end pipeline: parse document and transform to mindmap")
    parser.add_argument(
        "--skip-transform",
        action="store_true",
        help="Skip the transformation step (only generate TOC tree)"
    )
    parser.add_argument(
        "--data-folder",
        type=str,
        default=None,
        help="Path to data folder (default: from env)"
    )
    parser.add_argument(
        "--output-md",
        type=str,
        default=None,
        help="Output markdown file path (default: from env)"
    )
    parser.add_argument(
        "--output-toc",
        type=str,
        default=None,
        help="Output TOC tree file path (default: from env)"
    )
    parser.add_argument(
        "--output-mindmap",
        type=str,
        default=None,
        help="Output mindmap file path (default: from env)"
    )
    args = parser.parse_args()
    
    # Run pipeline
    run_pipeline(
        data_folder=args.data_folder,
        output_md=args.output_md,
        output_toc=args.output_toc,
        output_mindmap=args.output_mindmap,
        skip_transform=args.skip_transform,
    )
