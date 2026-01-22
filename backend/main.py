from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import openai
import os
from pathlib import Path
from dotenv import load_dotenv
import io
import json
import shutil
import uuid
from datetime import datetime

# Import pipeline dependencies
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

# Import RAG pipeline
from RAG.rag_pipeline import build_or_load_index, query_document, chat_with_document, reset_chat_memory, clear_index_cache

load_dotenv()

# Configuration from environment
OUTPUT_MINDMAP = os.getenv("OUTPUT_MINDMAP", "mindmap_transformed.json")

# Local storage for history
LOCAL_STORAGE_DIR = Path(__file__).parent / "local_storage"
LOCAL_STORAGE_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI()

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize OpenAI client
client = openai.OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# Store current document ID for RAG queries
current_document_id: Optional[str] = None

class Message(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: List[Message]
    model: Optional[str] = "gpt-4.1"

class Source(BaseModel):
    index: int
    text: str
    score: Optional[float] = None

class ChatResponse(BaseModel):
    message: str
    role: str
    sources: Optional[List[Source]] = None

class MindmapItem(BaseModel):
    text: str
    question: Optional[str] = None

class MindmapNode(BaseModel):
    title: str
    description: Optional[str] = None
    question: Optional[str] = None  # Question for this node
    items: Optional[List[MindmapItem]] = None  # List of items, each with text and question
    children: Optional[List['MindmapNode']] = None  # Nested children nodes

class MindmapResponse(BaseModel):
    title: str
    description: Optional[str] = None
    question: Optional[str] = None  # Question for the root title
    children: Optional[List[MindmapNode]] = None

# Allow forward references
MindmapNode.model_rebuild()

class HistoryItem(BaseModel):
    id: str  # UUID
    document_name: str
    created_at: str
    has_mindmap: bool = True

class HistoryListResponse(BaseModel):
    items: List[HistoryItem]

def are_titles_similar(title1: str, title2: str) -> bool:
    """
    Check if two titles are similar enough to be considered duplicates.
    Handles cases like "Microsoft ML" vs "Microsoft's ML" or exact matches.
    """
    if not title1 or not title2:
        return False
    
    # Normalize titles: lowercase, remove punctuation, strip whitespace
    def normalize(t: str) -> str:
        # Remove common punctuation and normalize whitespace
        t = t.lower().strip()
        # Remove possessive 's
        t = t.replace("'s", "").replace("'", "")
        # Remove other punctuation
        t = ''.join(c for c in t if c.isalnum() or c.isspace())
        # Normalize whitespace
        return ' '.join(t.split())
    
    norm1 = normalize(title1)
    norm2 = normalize(title2)
    
    # Exact match after normalization
    if norm1 == norm2:
        return True
    
    # Check if one contains the other (for cases like "Microsoft ML" vs "Microsoft ML Engineering")
    if norm1 in norm2 or norm2 in norm1:
        # Only consider similar if the shorter one is at least 70% of the longer one
        shorter = min(len(norm1), len(norm2))
        longer = max(len(norm1), len(norm2))
        if shorter / longer >= 0.7:
            return True
    
    return False


def collapse_root_unary_nodes(node: Dict[str, Any], is_root_level: bool = True) -> Dict[str, Any]:
    """
    Collapse unary (single-child) nodes ONLY at the root level until root has multiple children.
    
    This ensures the root always connects to multiple children (tree structure, not straight line).
    Once root has multiple children, we stop - deeper nodes can have single children and that's fine.
    
    Example:
    - Before: Root → Node1 → Node2 → Node3 (4 children)  [straight line]
    - After:  Root → Node3 (4 children)  [tree structure]
    
    The goal is to eliminate the "straight line" at the top of the hierarchy.
    Deeper nodes (like Node3 → Child3) can have 1 child and that's totally fine.
    """
    if not isinstance(node, dict):
        return node
    
    # ONLY collapse at root level - deeper nodes are allowed to have single children
    if is_root_level:
        # Keep collapsing root-level unary nodes until root has multiple children
        # This handles cases like: Root → Node1 → Node2 → Node3 (multiple children)
        # We want: Root → Node3 (multiple children)
        max_iterations = 10  # Safety limit to prevent infinite loops
        iteration = 0
        
        while iteration < max_iterations:
            # Check if root has children
            if "children" not in node or not isinstance(node.get("children"), list):
                break
            
            children_count = len(node.get("children", []))
            
            # If root has multiple children, we're done - stop collapsing
            if children_count > 1:
                break
            
            # If root has no children, we're done
            if children_count == 0:
                break
            
            # Root has exactly 1 child - promote it
            child = node["children"][0]
            if not isinstance(child, dict):
                break
            
            # Merge properties: promote child's properties to root
            # Use child's title if root title is generic
            root_title = (node.get("title") or "").strip()
            child_title = (child.get("title") or "").strip()
            
            if not root_title or root_title.lower() in ["my document mind map", "document mind map", "mind map", "root"]:
                # Root has generic title, use child's title
                node["title"] = child_title
            # Otherwise keep root's title (it might be meaningful)
            
            # Merge descriptions: prefer child's if more complete
            if child.get("description"):
                if not node.get("description") or len(child.get("description", "")) > len(node.get("description", "")):
                    node["description"] = child.get("description")
            
            # Merge questions: prefer child's if root doesn't have one
            if child.get("question") and not node.get("question"):
                node["question"] = child.get("question")
            
            # Merge keywords
            parent_keywords = set(node.get("keywords", []))
            child_keywords = set(child.get("keywords", []))
            if parent_keywords or child_keywords:
                node["keywords"] = list(parent_keywords | child_keywords)
            
            # Adopt child's children as root's children
            node["children"] = child.get("children", [])
            
            iteration += 1
    
    # Now recursively process children (but DON'T collapse their unary nodes - they're allowed to have 1 child)
    # We only collapse at root level - deeper nodes can have single children
    if "children" in node and isinstance(node["children"], list):
        node["children"] = [
            collapse_root_unary_nodes(child, is_root_level=False) if isinstance(child, dict) else child
            for child in node["children"]
        ]
    
    return node


# Pipeline function integrated from pipeline.py
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
        raise HTTPException(status_code=404, detail=str(e))
    
    print(f"Using {'LlamaParse' if USE_LLAMAPARSE else 'Docling'} for document parsing...")
    
    # Step 2: Parse document to markdown
    try:
        markdown_text = parse_document_to_markdown(document_path)
        
        # Ensure output directory exists
        os.makedirs(os.path.dirname(output_md) if os.path.dirname(output_md) else ".", exist_ok=True)
        
        # Write markdown to file
        with open(output_md, "w", encoding="utf-8") as f:
            f.write(markdown_text)
        print(f"Wrote markdown to {output_md}")
        
    except Exception as e:
        print(f"Error parsing document: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error parsing document: {str(e)}")
    
    # Step 3: Parse markdown and generate TOC tree
    try:
        print(f"Reading {output_md} and generating TOC tree...")
        with open(output_md, "r", encoding="utf-8") as f:
            md = f.read()
        
        toc_tree = markdown_to_toc_tree(md)
        
        # Write TOC tree to file
        with open(output_toc, "w", encoding="utf-8") as f:
            json.dump(toc_tree, f, ensure_ascii=False, indent=2)
        
        print(f"Wrote TOC tree to {output_toc}")
        
        # Step 4: Automatically transform to mindmap format (unless skipped)
        if not skip_transform:
            print(f"\n🔄 Automatically transforming TOC tree to mindmap format...")
            try:
                result = transform_toc_tree_to_mindmap(toc_file=output_toc, output_file=output_mindmap)
                return result
            except Exception as e:
                print(f"⚠️  Warning: Could not transform TOC tree to mindmap format: {e}")
                print(f"   The TOC tree was still generated successfully at {output_toc}")
                import traceback
                traceback.print_exc()
                raise HTTPException(status_code=500, detail=f"Error transforming to mindmap: {str(e)}")
        else:
            print(f"\n⏭️  Skipping transformation step")
            return {}
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error generating TOC tree: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error generating TOC tree: {str(e)}")


@app.get("/api/mindmap")
async def get_mindmap():
    """
    Returns the mindmap data structure as JSON from the transformed mindmap file.
    This flexible schema can be generated by LLM.
    
    Schema:
    {
        "title": "Root node title",
        "description": "Optional description",
        "question": "Optional question for root title",
        "children": [
            {
                "title": "Child node title",
                "description": "Optional description",
                "question": "Optional question for this node",
                "items": [
                    {"text": "Item 1", "question": "Optional question for item"},
                    {"text": "Item 2", "question": "Optional question for item"}
                ],  // Optional list of items (each with text and optional question)
                "children": [...]  // Optional nested structure
            }
        ]
    }
    
    Note: Questions are stored but not displayed in UI (ready for future use).
    """
    print("=== /api/mindmap endpoint called ===")
    
    # First try to load from current document history if available
    if current_document_id:
        print(f"Loading mindmap from current document: {current_document_id}")
        history_folder = LOCAL_STORAGE_DIR / current_document_id
        history_mindmap = history_folder / "mindmap_transformed.json"
        
        if history_mindmap.exists():
            try:
                with open(history_mindmap, "r", encoding="utf-8") as f:
                    mindmap_data = json.load(f)
                
                # Apply root-level unary node collapsing
                mindmap_data = collapse_root_unary_nodes(mindmap_data, is_root_level=True)
                
                print(f"Loaded mindmap data from history: {history_mindmap}")
                return mindmap_data
            except Exception as e:
                print(f"Error loading mindmap from history: {e}")
                # Fall through to try other locations
    
    # Load mindmap data from transformed JSON file (legacy location)
    transformed_file = Path(__file__).parent / OUTPUT_MINDMAP
    if transformed_file.exists():
        try:
            with open(transformed_file, "r", encoding="utf-8") as f:
                mindmap_data = json.load(f)
            
            # Apply root-level unary node collapsing to eliminate straight-line structures
            # This ensures root always has multiple children (tree structure, not straight line)
            # Deeper nodes can have single children - that's totally fine
            mindmap_data = collapse_root_unary_nodes(mindmap_data, is_root_level=True)
            
            print(f"Loaded mindmap data from {transformed_file}")
            print(f"Applied root-level unary node collapsing (ensures tree structure)")
            return mindmap_data
        except Exception as e:
            print(f"Error loading mindmap data: {e}")
            import traceback
            traceback.print_exc()
            raise HTTPException(
                status_code=500,
                detail=f"Error loading mindmap data: {str(e)}"
            )
    else:
        # Fallback to sample structure if transformed file doesn't exist
        print(f"Warning: {transformed_file} not found, trying sample_mindmap.json")
        sample_file = Path(__file__).parent / "data" / "sample_mindmap.json"
        
        if sample_file.exists():
            try:
                with open(sample_file, 'r', encoding='utf-8') as f:
                    mindmap_data = json.load(f)
                print(f"Loaded sample mindmap from {sample_file}")
            except Exception as e:
                print(f"Error loading sample mindmap: {e}")
                mindmap_data = {
                    "title": "Welcome to Mind Map",
                    "description": "Upload a document to generate a mind map.",
                    "question": "What would you like to explore?",
                    "children": []
                }
        else:
            print(f"Warning: {sample_file} not found, using minimal structure")
            mindmap_data = {
                "title": "Welcome to Mind Map",
                "description": "Upload a document to generate a mind map.",
                "question": "What would you like to explore?",
                "children": []
            }
    
    print(f"Returning mindmap JSON structure")
    return mindmap_data


# ============================================================================
# HISTORY API ENDPOINTS
# ============================================================================

@app.get("/api/history", response_model=HistoryListResponse)
async def get_history():
    """
    Get list of all history items (previously uploaded documents).
    Returns items sorted by creation date (newest first).
    """
    items = []
    
    if LOCAL_STORAGE_DIR.exists():
        for folder in LOCAL_STORAGE_DIR.iterdir():
            if folder.is_dir():
                metadata_file = folder / "metadata.json"
                if metadata_file.exists():
                    try:
                        with open(metadata_file, "r", encoding="utf-8") as f:
                            metadata = json.load(f)
                        
                        mindmap_file = folder / "mindmap_transformed.json"
                        
                        items.append(HistoryItem(
                            id=metadata.get("id", folder.name),
                            document_name=metadata.get("document_name", "Unknown"),
                            created_at=metadata.get("created_at", ""),
                            has_mindmap=mindmap_file.exists()
                        ))
                    except Exception as e:
                        print(f"Error reading metadata for {folder.name}: {e}")
                        continue
    
    # Sort by creation date (newest first)
    items.sort(key=lambda x: x.created_at, reverse=True)
    
    return HistoryListResponse(items=items)


@app.get("/api/history/{history_id}")
async def get_history_item(history_id: str):
    """
    Get a specific history item's mindmap data.
    """
    history_folder = LOCAL_STORAGE_DIR / history_id
    
    if not history_folder.exists():
        raise HTTPException(status_code=404, detail="History item not found")
    
    # Load metadata
    metadata_file = history_folder / "metadata.json"
    if not metadata_file.exists():
        raise HTTPException(status_code=404, detail="Metadata not found")
    
    try:
        with open(metadata_file, "r", encoding="utf-8") as f:
            metadata = json.load(f)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error reading metadata: {e}")
    
    # Load mindmap data
    mindmap_file = history_folder / "mindmap_transformed.json"
    if not mindmap_file.exists():
        raise HTTPException(status_code=404, detail="Mindmap data not found")
    
    try:
        with open(mindmap_file, "r", encoding="utf-8") as f:
            mindmap_data = json.load(f)
        
        # Apply root-level unary node collapsing
        mindmap_data = collapse_root_unary_nodes(mindmap_data, is_root_level=True)
        
        return {
            "id": metadata.get("id"),
            "document_name": metadata.get("document_name"),
            "created_at": metadata.get("created_at"),
            "mindmap": mindmap_data
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error reading mindmap data: {e}")


@app.post("/api/history/{history_id}/select")
async def select_history_item(history_id: str):
    """
    Select a history item and load its document context for chat.
    This sets up the backend to use this document for RAG queries.
    """
    global current_document_id
    
    history_folder = LOCAL_STORAGE_DIR / history_id
    
    if not history_folder.exists():
        raise HTTPException(status_code=404, detail="History item not found")
    
    # Set current document ID for RAG queries
    current_document_id = history_id
    print(f"Set current document ID to: {current_document_id}")
    
    # Build or load RAG index for this document
    print(f"Building/loading RAG index for {history_id}...")
    try:
        build_or_load_index(history_id)
        print(f"RAG index ready for {history_id}")
    except Exception as e:
        print(f"Warning: Could not build/load RAG index: {e}")
        import traceback
        traceback.print_exc()
        # Continue anyway - we can still fall back to regular chat
    
    return {
        "message": "History item selected", 
        "rag_enabled": True,
        "history_id": history_id
    }


@app.delete("/api/history/{history_id}")
async def delete_history_item(history_id: str):
    """
    Delete a specific history item.
    """
    history_folder = LOCAL_STORAGE_DIR / history_id
    
    if not history_folder.exists():
        raise HTTPException(status_code=404, detail="History item not found")
    
    try:
        shutil.rmtree(history_folder)
        return {"message": "History item deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error deleting history item: {e}")


@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    """
    Upload file, save to data folder (clearing old files), and run pipeline to generate mindmap.
    Also builds RAG index for chat queries.
    """
    global current_document_id
    
    print(f"=== File Upload Request ===")
    print(f"Filename: {file.filename}")
    print(f"Content-Type: {file.content_type}")
    print(f"Size: {file.size if hasattr(file, 'size') else 'unknown'}")
    
    # Validate file type
    allowed_types = [
        "application/pdf", 
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "text/plain",
        "text/markdown"
    ]
    allowed_extensions = [".pdf", ".docx", ".txt", ".md"]
    
    file_extension = Path(file.filename).suffix.lower() if file.filename else ""
    print(f"File extension: {file_extension}")
    
    if file.content_type not in allowed_types and file_extension not in allowed_extensions:
        error_msg = f"Invalid file type. Received: content_type={file.content_type}, extension={file_extension}. Only PDF, DOCX, TXT, and MD files are allowed."
        print(f"ERROR: {error_msg}")
        raise HTTPException(
            status_code=400,
            detail=error_msg
        )
    
    try:
        # Read file content
        print("Reading file contents...")
        contents = await file.read()
        print(f"File contents read: {len(contents)} bytes")
        
        # Ensure data folder exists
        data_folder_path = Path(DATA_FOLDER)
        data_folder_path.mkdir(parents=True, exist_ok=True)
        
        # Clear all files in data folder
        print(f"Clearing all files in {DATA_FOLDER}...")
        for existing_file in data_folder_path.iterdir():
            if existing_file.is_file():
                try:
                    existing_file.unlink()
                    print(f"Deleted: {existing_file}")
                except Exception as e:
                    print(f"Warning: Could not delete {existing_file}: {e}")
        
        # Save uploaded file to data folder
        saved_file_path = data_folder_path / file.filename
        print(f"Saving file to {saved_file_path}...")
        with open(saved_file_path, "wb") as f:
            f.write(contents)
        print(f"File saved successfully to {saved_file_path}")
        
        # Run pipeline to generate mindmap
        print("Running pipeline to generate mindmap...")
        history_id = None
        try:
            mindmap_data = run_pipeline(
                data_folder=str(data_folder_path),
                skip_transform=False
            )
            print("Pipeline completed successfully")
            
            # Save to local_storage for history
            history_id = str(uuid.uuid4())
            history_folder = LOCAL_STORAGE_DIR / history_id
            history_folder.mkdir(parents=True, exist_ok=True)
            
            # Copy the uploaded document
            doc_dest = history_folder / file.filename
            with open(doc_dest, "wb") as f:
                f.write(contents)
            
            # Move toc_tree.json if exists (clean up original)
            toc_tree_src = Path(__file__).parent / "toc_tree.json"
            if toc_tree_src.exists():
                shutil.move(str(toc_tree_src), str(history_folder / "toc_tree.json"))
            
            # Move mindmap_transformed.json (clean up original)
            mindmap_src = Path(__file__).parent / OUTPUT_MINDMAP
            if mindmap_src.exists():
                shutil.move(str(mindmap_src), str(history_folder / "mindmap_transformed.json"))
            
            # Move parsed markdown output (clean up original)
            parsed_md_src = Path(__file__).parent / OUTPUT_MD
            if parsed_md_src.exists():
                shutil.move(str(parsed_md_src), str(history_folder / "parsed.md"))
            else:
                print(f"Warning: Parsed markdown file not found at {parsed_md_src}")
            
            # Save metadata
            metadata = {
                "id": history_id,
                "document_name": file.filename,
                "created_at": datetime.utcnow().isoformat(),
                "file_type": file_extension,
            }
            with open(history_folder / "metadata.json", "w", encoding="utf-8") as f:
                json.dump(metadata, f, ensure_ascii=False, indent=2)
            
            print(f"Saved to history with ID: {history_id}")
            
            # Build RAG index for the document
            print(f"Building RAG index for document {history_id}...")
            try:
                build_or_load_index(history_id)
                print(f"RAG index built successfully for {history_id}")
            except Exception as rag_error:
                print(f"Warning: RAG index build failed: {rag_error}")
                import traceback
                traceback.print_exc()
                # Continue anyway - mindmap was generated successfully
            
            # Set current document ID for chat queries
            current_document_id = history_id
            
            return JSONResponse(
                status_code=200,
                content={
                    "message": "File uploaded and mindmap generated successfully",
                    "filename": file.filename,
                    "mindmap_generated": True,
                    "history_id": history_id
                }
            )
        except HTTPException:
            raise
        except Exception as pipeline_error:
            print(f"Pipeline error: {pipeline_error}")
            import traceback
            traceback.print_exc()
            # Still return success for file upload, but note pipeline error
            return JSONResponse(
                status_code=200,
                content={
                    "message": "File uploaded successfully, but mindmap generation failed",
                    "filename": file.filename,
                    "mindmap_generated": False,
                    "error": str(pipeline_error)
                }
            )
    
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        error_details = traceback.format_exc()
        print(f"Error processing file: {str(e)}")
        print(f"Traceback: {error_details}")
        raise HTTPException(
            status_code=500,
            detail=f"Error processing file: {str(e)}"
        )

@app.post("/api/clear")
async def clear_context():
    """
    Clear the current RAG document selection and chat memory.
    """
    global current_document_id
    
    # Reset chat memory for current document before clearing
    if current_document_id:
        reset_chat_memory(current_document_id)
    
    current_document_id = None
    
    # Optionally clear RAG cache (uncomment if you want to free memory)
    # clear_index_cache()
    
    return JSONResponse(
        status_code=200,
        content={"message": "Context cleared successfully"}
    )

@app.post("/api/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """
    Chat endpoint that uses RAG to query the current document with conversation history.
    Falls back to regular OpenAI chat if no document is selected.
    """
    global current_document_id
    
    try:
        # Get the latest user message (the actual query)
        user_query = None
        for msg in reversed(request.messages):
            if msg.role == "user":
                user_query = msg.content
                break
        
        if not user_query:
            raise HTTPException(status_code=400, detail="No user message found")
        
        # If we have a current document, use RAG chat with full history
        if current_document_id:
            try:
                # Convert messages to chat history format
                chat_history = [
                    {"role": msg.role, "content": msg.content}
                    for msg in request.messages
                ]
                
                # Use conversational chat that maintains context
                result = chat_with_document(current_document_id, user_query, chat_history)
                assistant_message = result["response"]
                
                # Extract sources
                sources = result.get("sources", [])
                
                return ChatResponse(
                    message=assistant_message,
                    role="assistant",
                    sources=sources
                )
            except Exception as rag_error:
                print(f"RAG error: {rag_error}")
                # Fall through to regular OpenAI chat
        
        # Fallback: Use regular OpenAI chat (no document context)
        
        system_content = "You are a helpful assistant. Note: No document is currently loaded. Please upload a document to ask questions about it."
        
        messages = [
            {"role": "system", "content": system_content}
        ]
        
        for msg in request.messages:
            messages.append({"role": msg.role, "content": msg.content})
        
        response = client.chat.completions.create(
            model=request.model,
            messages=messages
        )
        
        assistant_message = response.choices[0].message.content
        
        return ChatResponse(
            message=assistant_message,
            role="assistant"
        )
    
    except Exception as e:
        print(f"Chat error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# Mount static files (built frontend)
dist_path = Path(__file__).parent.parent / "dist"
if dist_path.exists():
    app.mount("/assets", StaticFiles(directory=str(dist_path / "assets")), name="assets")
    
    @app.get("/api/health")
    def health_check():
        return {"status": "Backend API is running"}
    
    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        # Don't serve frontend for API routes - these should be handled by API endpoints above
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="API endpoint not found")
            
        file_path = dist_path / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(dist_path / "index.html")
else:
    @app.get("/")
    def read_root():
        return {"status": "Backend API is running", "note": "Frontend not built. Run in dev mode or build first."}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
