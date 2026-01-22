# Combined parser that supports both LlamaParse and Docling
# Set environment variable USE_LLAMAPARSE=TRUE to use LlamaParse, otherwise uses Docling
# 
# This file now imports from the refactored modules:
# - parser.py: Document parsing functions
# - llm_transform.py: LLM transformation functions
# - prompts.py: Prompt templates
# - pipeline.py: End-to-end pipeline orchestration

# For backward compatibility, import and re-export main functions
from parser.parser import (
    DATA_FOLDER,
    OUTPUT_MD,
    OUTPUT_TOC,
    USE_LLAMAPARSE,
    find_document_file,
    markdown_to_toc_tree,
    parse_document_to_markdown,
)
from llm.llm_transform import transform_toc_tree_to_api_format, transform_toc_tree_to_mindmap
from pipeline import run_pipeline


def main():
    """Main execution flow: parse PDF -> generate markdown -> create TOC tree -> transform to mindmap."""
    # Use the pipeline module for end-to-end execution
    run_pipeline()


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Parse document and optionally transform to mindmap")
    parser.add_argument(
        "--transform",
        action="store_true",
        help="Transform the generated TOC tree to mindmap format after parsing"
    )
    parser.add_argument(
        "--toc-file",
        type=str,
        default=OUTPUT_TOC,
        help=f"Path to TOC tree JSON file (default: {OUTPUT_TOC})"
    )
    parser.add_argument(
        "--output-file",
        type=str,
        default="mindmap_transformed.json",
        help="Output file for transformed mindmap (default: mindmap_transformed.json)"
    )
    args = parser.parse_args()
    
    # Run main parsing (transformation is automatic in pipeline)
    main()
    
    # Optionally transform to mindmap format (if not already done by pipeline)
    if args.transform:
        try:
            transform_toc_tree_to_mindmap(toc_file=args.toc_file, output_file=args.output_file)
        except Exception as e:
            print(f"Transformation error: {e}")
