import { useEffect, useRef, useState } from 'react';
import { Transformer } from 'markmap-lib';
import { Markmap } from 'markmap-view';
import {
  Maximize2,
  Minimize2,
  Focus,
  Download,
  ZoomIn,
  ZoomOut,
  Expand,
  Shrink,
  Upload
} from 'lucide-react';
import { useChat } from '../contexts/ChatContext';

// Note: We'll check hasUploadedFile from ChatContext to show demo label

interface MarkmapPanelProps {
  isMaximized: boolean;
  onToggleMaximize: () => void;
  onMinimize: () => void;
  isMinimized: boolean;
}


// ============================================================================
// END TEXT WIDTH CALCULATION UTILITIES
// ============================================================================

// Convert JSON structure to markdown format for markmap
// This function is flexible and handles any JSON structure from backend
const jsonToMarkdown = (jsonData: any, level: number = 1, isRoot: boolean = false): string => {
  if (!jsonData) return '';

  let markdown = '';
  const indent = '#'.repeat(level);

  // Handle root node or any node
  const title = jsonData.title || '';
  // Note: description and keywords are hidden from display but kept in data for future use
  // const description = jsonData.description || '';
  // const keywords = jsonData.keywords || [];
  const items = jsonData.items || [];
  const children = jsonData.children || [];

  // Skip generic root titles - start from first meaningful child
  const genericRootTitles = ['my document mind map', 'document mind map', 'mind map', 'root'];
  const isGenericRoot = isRoot && title && genericRootTitles.includes(title.toLowerCase().trim());

  // If root is generic and has children, skip root and start from children
  if (isGenericRoot && children.length > 0) {
    // Start from children instead of root
    children.forEach((child: any) => {
      markdown += jsonToMarkdown(child, level, false); // Use same level, not root
    });
    return markdown;
  }

  // Add title (this is what we display)
  if (title && !isGenericRoot) {
    markdown += `${indent} ${title}\n\n`;
  }

  // Description and keywords are NOT displayed in the markdown visualization
  // They are still available in the JSON data for questions/chat functionality

  // Add items (flat list)
  // Handle both old format (strings) and new format (objects with text and question)
  if (items.length > 0) {
    items.forEach((item: any) => {
      // Support both string format (backward compatibility) and object format
      const itemText = typeof item === 'string' ? item : item.text || '';
      // Note: item.question is stored but not displayed in UI (for future use)
      markdown += `- ${itemText}\n`;
    });
    markdown += '\n';
  }

  // Recursively add children
  if (children.length > 0) {
    children.forEach((child: any) => {
      markdown += jsonToMarkdown(child, level + 1, false);
    });
  }

  return markdown;
};

// Build a mapping of node text to questions from JSON data
const buildQuestionMap = (jsonData: any, map: Map<string, string> = new Map(), path: string[] = [], isRoot: boolean = true): Map<string, string> => {
  if (!jsonData) return map;

  const title = jsonData.title || '';
  const question = jsonData.question;
  const items = jsonData.items || [];
  const children = jsonData.children || [];

  // Skip generic root titles - don't map them
  const genericRootTitles = ['my document mind map', 'document mind map', 'mind map', 'root'];
  const isGenericRoot = isRoot && title && genericRootTitles.includes(title.toLowerCase().trim());

  // Map title to question (skip generic root)
  if (title && question && !isGenericRoot) {
    map.set(title, question);
  }

  // Map items to questions
  items.forEach((item: any) => {
    const itemText = typeof item === 'string' ? item : item.text || '';
    const itemQuestion = typeof item === 'object' ? item.question : null;
    if (itemText && itemQuestion) {
      map.set(itemText, itemQuestion);
    }
  });

  // Recursively process children
  children.forEach((child: any) => {
    buildQuestionMap(child, map, [...path, title], false);
  });

  return map;
};

// Assign stable node IDs based on path
const assignIdsByPath = (node: any, path: string = "0"): void => {
  if (!node) return;
  node.nodeId = path;
  if (node.children) {
    node.children.forEach((ch: any, i: number) => {
      assignIdsByPath(ch, `${path}.${i}`);
    });
  }
};

// Build a mapping of node IDs to node text (for reverse lookup)
const buildNodeIdToTextMap = (node: any, map: Map<string, string> = new Map()): Map<string, string> => {
  if (!node) return map;
  if (node.nodeId && node.content) {
    map.set(node.nodeId, node.content);
  }
  if (node.children) {
    node.children.forEach((ch: any) => buildNodeIdToTextMap(ch, map));
  }
  return map;
};

// Build a mapping of content/text to questions from JSON data
// This function is flexible and handles ANY JSON structure from the backend:
// - Works with any depth of nesting (unlimited levels)
// - Handles nodes with or without questions
// - Processes both 'items' (leaf nodes) and 'children' (nested nodes)
// - Adapts to any field names or structure changes in the backend
const buildContentToQuestionMap = (jsonData: any, map: Map<string, string> = new Map(), isRoot: boolean = true): Map<string, string> => {
  if (!jsonData) return map;

  const title = jsonData.title || '';
  const question = jsonData.question;
  const items = jsonData.items || [];
  const children = jsonData.children || [];

  // Skip generic root titles - don't map them
  const genericRootTitles = ['my document mind map', 'document mind map', 'mind map', 'root'];
  const isGenericRoot = isRoot && title && genericRootTitles.includes(title.toLowerCase().trim());

  // Map title to question (skip generic root)
  if (title && question && !isGenericRoot) {
    map.set(title, question);
  }

  // Map items to questions (items become leaf nodes in markmap)
  // Supports both string format and object format with text/question
  items.forEach((item: any) => {
    const itemText = typeof item === 'string' ? item : item.text || '';
    const itemQuestion = typeof item === 'object' ? item.question : null;
    if (itemText && itemQuestion) {
      map.set(itemText, itemQuestion);
    }
  });

  // Recursively process children (handles unlimited nesting depth)
  // This ensures ALL nodes at ANY level are included
  if (children) {
    children.forEach((child: any) => {
      buildContentToQuestionMap(child, map, false);
    });
  }

  return map;
};

// Build a mapping of content/text to description from JSON data
const buildDescriptionMap = (jsonData: any, map: Map<string, string> = new Map(), isRoot: boolean = true): Map<string, string> => {
  if (!jsonData) return map;

  const title = jsonData.title || '';
  const description = jsonData.description || '';
  const children = jsonData.children || [];

  // Skip generic root titles
  const genericRootTitles = ['my document mind map', 'document mind map', 'mind map', 'root'];
  const isGenericRoot = isRoot && title && genericRootTitles.includes(title.toLowerCase().trim());

  // Map title to description (skip generic root)
  if (title && description && !isGenericRoot) {
    map.set(title, description);
  }

  // Recursively process children
  if (children) {
    children.forEach((child: any) => {
      buildDescriptionMap(child, map, false);
    });
  }

  return map;
};

// Build a mapping of content/text to keywords from JSON data
const buildKeywordsMap = (jsonData: any, map: Map<string, string[]> = new Map(), isRoot: boolean = true): Map<string, string[]> => {
  if (!jsonData) return map;

  const title = jsonData.title || '';
  const keywords = jsonData.keywords || [];
  const children = jsonData.children || [];

  // Skip generic root titles
  const genericRootTitles = ['my document mind map', 'document mind map', 'mind map', 'root'];
  const isGenericRoot = isRoot && title && genericRootTitles.includes(title.toLowerCase().trim());

  // Map title to keywords (skip generic root)
  if (title && keywords.length > 0 && !isGenericRoot) {
    map.set(title, keywords);
  }

  // Recursively process children
  if (children) {
    children.forEach((child: any) => {
      buildKeywordsMap(child, map, false);
    });
  }

  return map;
};

// Decode HTML entities to normal text
const decodeHtmlEntities = (text: string): string => {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  return textarea.value;
};

// Normalize content for matching (decode HTML entities, trim whitespace)
const normalizeContent = (content: string): string => {
  if (!content) return '';
  // Decode HTML entities (like &#x1f4e6; to 📦)
  const decoded = decodeHtmlEntities(content);
  // Trim and normalize whitespace
  return decoded.trim();
};

// Build nodeId to question mapping by matching root content to JSON questions
const buildNodeIdToQuestionMapFromRoot = (root: any, contentToQuestionMap: Map<string, string>, nodeIdMap: Map<string, string> = new Map()): Map<string, string> => {
  if (!root) return nodeIdMap;

  // Get the content/text of this node and normalize it
  const rawContent = root.content || '';
  const normalizedContent = normalizeContent(rawContent);

  // If this node has a nodeId and we can find a question for its content
  if (root.nodeId && normalizedContent) {
    // Try exact match first
    let question = contentToQuestionMap.get(normalizedContent);

    // If not found, try matching against all keys (case-insensitive, partial match)
    if (!question) {
      for (const [key, q] of contentToQuestionMap.entries()) {
        const normalizedKey = normalizeContent(key);
        // Try exact match after normalization
        if (normalizedKey === normalizedContent) {
          question = q;
          break;
        }
        // Try partial match (in case of extra whitespace or formatting)
        if (normalizedKey.includes(normalizedContent) || normalizedContent.includes(normalizedKey)) {
          question = q;
          break;
        }
      }
    }

    if (question) {
      nodeIdMap.set(root.nodeId, question);
    }
  }

  // Recursively process children
  if (root.children) {
    root.children.forEach((child: any) => {
      buildNodeIdToQuestionMapFromRoot(child, contentToQuestionMap, nodeIdMap);
    });
  }

  return nodeIdMap;
};

export default function MarkmapPanel({
  isMaximized,
  onToggleMaximize,
  onMinimize,
  isMinimized
}: MarkmapPanelProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const markmapRef = useRef<Markmap | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [markdownData, setMarkdownData] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [questionMap, setQuestionMap] = useState<Map<string, string>>(new Map());
  const [nodeIdToTextMap, setNodeIdToTextMap] = useState<Map<string, string>>(new Map());
  const [nodeIdToQuestionMap, setNodeIdToQuestionMap] = useState<Map<string, string>>(new Map());
  const [jsonData, setJsonData] = useState<any>(null);
  const [contentToQuestionMap, setContentToQuestionMap] = useState<Map<string, string>>(new Map());
  const [descriptionMap, setDescriptionMap] = useState<Map<string, string>>(new Map());
  const [keywordsMap, setKeywordsMap] = useState<Map<string, string[]>>(new Map());
  const currentAnchorRef = useRef<Element | null>(null);
  const currentNodeKeyRef = useRef<string | null>(null);
  const handleButtonActionRef = useRef<((nodeKey: string, btnId: string) => void) | null>(null);
  const lastRenderedMarkdownRef = useRef<string>(''); // Track last rendered markdown to prevent unnecessary re-renders
  const questionMapRef = useRef<Map<string, string>>(new Map());
  const contentToQuestionMapRef = useRef<Map<string, string>>(new Map());
  const nodeIdToTextMapRef = useRef<Map<string, string>>(new Map());
  const nodeIdToQuestionMapRef = useRef<Map<string, string>>(new Map());
  const descriptionMapRef = useRef<Map<string, string>>(new Map());
  const keywordsMapRef = useRef<Map<string, string[]>>(new Map());
  const sendMessageRef = useRef<((content: string) => Promise<void>) | null>(null);
  const { sendMessage, hasUploadedFile, uploadVersion, clearChat, currentMindmapData, selectedHistoryId } = useChat();
  const [isAllExpanded, setIsAllExpanded] = useState<boolean>(false); // Track expand/collapse all state - false means collapsed, true means expanded

  // Keep refs in sync with state/context
  useEffect(() => {
    questionMapRef.current = questionMap;
  }, [questionMap]);

  useEffect(() => {
    contentToQuestionMapRef.current = contentToQuestionMap;
  }, [contentToQuestionMap]);

  useEffect(() => {
    nodeIdToTextMapRef.current = nodeIdToTextMap;
  }, [nodeIdToTextMap]);

  useEffect(() => {
    nodeIdToQuestionMapRef.current = nodeIdToQuestionMap;
  }, [nodeIdToQuestionMap]);

  useEffect(() => {
    descriptionMapRef.current = descriptionMap;
  }, [descriptionMap]);

  useEffect(() => {
    keywordsMapRef.current = keywordsMap;
  }, [keywordsMap]);

  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  // Helper function to process mindmap data (JSON or markdown)
  const processMindmapData = (data: any) => {
    // Check if data is empty or has no meaningful content
    const isEmpty = !data ||
      (typeof data === 'object' && Object.keys(data).length === 0) ||
      (data.children && Array.isArray(data.children) && data.children.length === 0 && !data.title);

    if (isEmpty) {
      // Create a fallback mindmap with error message
      const fallbackData = {
        title: '⚠️ Unable to Generate Mind Map',
        description: 'The document could not be processed into a mind map structure.',
      };
      setJsonData(fallbackData);
      setMarkdownData('# ⚠️ Unable to Generate Mind Map');
      return;
    }

    // Check if response is already markdown (backward compatibility)
    if (data.markdown && typeof data.markdown === 'string') {
      setMarkdownData(data.markdown);
    }
    // Check if response is JSON structure (new format)
    else if (data.title || data.children) {
      // Check if the mindmap has no children (empty visualization)
      const hasNoChildren = !data.children || (Array.isArray(data.children) && data.children.length === 0);

      if (hasNoChildren && data.title) {
        // Still show the title, it's not empty
      }

      // Store JSON data for building nodeId mappings
      setJsonData(data);
      const map = buildQuestionMap(data, new Map(), [], true); // Pass isRoot=true
      setQuestionMap(map);
      const markdownText = jsonToMarkdown(data, 1, true); // Pass isRoot=true for root node
      setMarkdownData(markdownText);
    }
    else {
      console.error('Unknown data format:', data);
      // Instead of throwing, show a fallback
      const fallbackData = {
        title: '⚠️ Unable to Generate Mind Map',
        description: 'Invalid data format received.',
      };
      setJsonData(fallbackData);
      setMarkdownData('# ⚠️ Unable to Generate Mind Map');
    }
  };

  // Fetch mindmap data from backend or use history data
  useEffect(() => {
    const fetchMindmapData = async () => {
      try {
        setIsLoading(true);

        // If we have currentMindmapData from history, use it directly
        if (currentMindmapData && selectedHistoryId) {
          processMindmapData(currentMindmapData);
          return;
        }

        // Otherwise fetch from API
        const apiUrl = import.meta.env.DEV
          ? 'http://localhost:8000/api/mindmap'
          : '/api/mindmap';

        const response = await fetch(apiUrl);

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to fetch mindmap data: ${response.status} ${errorText}`);
        }

        const data = await response.json();

        processMindmapData(data);
      } catch (error) {
        console.error('Error fetching mindmap data:', error);
        // Show fallback error message instead of empty
        const fallbackData = {
          title: '⚠️ Unable to Generate Mind Map',
          description: 'Failed to load mindmap data. Please try again.',
        };
        setJsonData(fallbackData);
        setMarkdownData('# ⚠️ Unable to Generate Mind Map');
      } finally {
        setIsLoading(false);
      }
    };

    fetchMindmapData();
  }, [uploadVersion, currentMindmapData, selectedHistoryId]); // Refresh when file is uploaded or history is selected

  // Build content to question mapping when jsonData is available
  useEffect(() => {
    if (jsonData) {
      const contentMap = buildContentToQuestionMap(jsonData, new Map(), true); // Pass isRoot=true
      setContentToQuestionMap(contentMap);

      // Build description and keywords maps
      const descMap = buildDescriptionMap(jsonData, new Map(), true);
      setDescriptionMap(descMap);

      const kwMap = buildKeywordsMap(jsonData, new Map(), true);
      setKeywordsMap(kwMap);
    }
  }, [jsonData]);

  // Create popover element on mount
  useEffect(() => {
    // Use contentRef if available, otherwise fallback to containerRef
    const container = contentRef.current || containerRef.current;
    if (!container || popoverRef.current) return;

    const pop = document.createElement('div');
    pop.className = 'mm-popover';
    pop.style.position = 'absolute';
    pop.style.display = 'none';
    pop.style.zIndex = '9999';
    container.appendChild(pop);
    popoverRef.current = pop;

    // Handle button clicks via event delegation
    // Use a ref-based approach so we always have the latest handler
    const handleButtonClick = (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest('button[data-btn]');
      if (!btn || !currentNodeKeyRef.current) return;

      const btnId = btn.getAttribute('data-btn');
      const nodeKey = currentNodeKeyRef.current;

      if (!btnId || !nodeKey) {
        return;
      }

      // Call the handler via ref to ensure we have the latest version
      if (handleButtonActionRef.current) {
        handleButtonActionRef.current(nodeKey, btnId);
      }
    };

    pop.addEventListener('click', handleButtonClick);

    // Close on outside click
    const handleOutsideClick = (e: MouseEvent) => {
      if (!popoverRef.current) return;
      if (popoverRef.current.style.display === 'none') return;
      if (popoverRef.current.contains(e.target as Node)) return;
      if (currentAnchorRef.current && currentAnchorRef.current.contains(e.target as Node)) return;
      hidePopover();
    };

    // Close on Escape key
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        hidePopover();
      }
    };

    document.addEventListener('click', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('click', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
      if (pop) {
        pop.removeEventListener('click', handleButtonClick);
        if (pop.parentNode) {
          pop.parentNode.removeChild(pop);
        }
      }
    };
  }, []);

  // Helper functions for popover
  const hidePopover = () => {
    if (popoverRef.current) {
      popoverRef.current.style.display = 'none';
      popoverRef.current.classList.remove('show');
    }
    currentAnchorRef.current = null;
    currentNodeKeyRef.current = null;
  };

  const positionPopover = (anchorEl: Element) => {
    if (!popoverRef.current) return;

    // Use contentRef if available, otherwise fallback to containerRef
    const container = contentRef.current || containerRef.current;
    if (!container) return;

    const anchorRect = anchorEl.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    // Place popover below the node with some spacing
    const left = anchorRect.left - containerRect.left;
    const top = anchorRect.bottom - containerRect.top + 8;

    popoverRef.current.style.left = `${left}px`;
    popoverRef.current.style.top = `${top}px`;
  };

  const renderPopoverContent = (nodeKey: string) => {
    if (!popoverRef.current) return;

    // Use refs to get latest values
    const currentNodeIdToTextMap = nodeIdToTextMapRef.current;
    const currentNodeIdToQuestionMap = nodeIdToQuestionMapRef.current;
    const currentQuestionMap = questionMapRef.current;
    const currentDescriptionMap = descriptionMapRef.current;
    const currentKeywordsMap = keywordsMapRef.current;

    // Try to get node text from ID map, or use nodeKey directly
    let nodeText = currentNodeIdToTextMap.get(nodeKey) || nodeKey;
    // Normalize the text (decode HTML entities)
    const normalizedText = normalizeContent(nodeText);

    // Get question for this node - try nodeId first
    let question = currentNodeIdToQuestionMap.get(nodeKey);

    // If not found, try by normalized text
    if (!question) {
      question = currentQuestionMap.get(normalizedText);
      // If still not found, try matching against all keys
      if (!question) {
        for (const [key, q] of currentQuestionMap.entries()) {
          const normalizedKey = normalizeContent(key);
          if (normalizedKey === normalizedText || normalizedText.includes(normalizedKey) || normalizedKey.includes(normalizedText)) {
            question = q;
            break;
          }
        }
      }
    }

    // Get description for this node
    let description = currentDescriptionMap.get(normalizedText);
    if (!description) {
      for (const [key, desc] of currentDescriptionMap.entries()) {
        const normalizedKey = normalizeContent(key);
        if (normalizedKey === normalizedText || normalizedText.includes(normalizedKey) || normalizedKey.includes(normalizedText)) {
          description = desc;
          break;
        }
      }
    }

    // Get keywords for this node
    let keywords: string[] = currentKeywordsMap.get(normalizedText) || [];
    if (keywords.length === 0) {
      for (const [key, kw] of currentKeywordsMap.entries()) {
        const normalizedKey = normalizeContent(key);
        if (normalizedKey === normalizedText || normalizedText.includes(normalizedKey) || normalizedKey.includes(normalizedText)) {
          keywords = kw;
          break;
        }
      }
    }

    console.log(`renderPopoverContent for nodeKey: ${nodeKey}, nodeText: "${normalizedText}", question found: ${!!question}, description found: ${!!description}, keywords: ${keywords.length}`);

    // Build the popover HTML with Ask Question button and expandable sections
    let contentHtml = `<div class="mm-pop-title">${normalizedText}</div>`;
    contentHtml += `<div class="mm-pop-btnrow">`;

    // Ask Question button (only if question exists)
    if (question) {
      contentHtml += `<button class="mm-pop-btn" data-btn="ask-question">Ask Question</button>`;
    }

    // Description expandable section
    if (description) {
      contentHtml += `
        <div class="mm-pop-expandable">
          <button class="mm-pop-expand-btn" data-expand="description">
            <span class="mm-pop-expand-icon">▶</span>
            <span>Description</span>
          </button>
          <div class="mm-pop-expand-content" data-content="description">
            <p class="mm-pop-description-text">${description}</p>
          </div>
        </div>
      `;
    }

    // Keywords expandable section
    if (keywords.length > 0) {
      const keywordsHtml = keywords.map(kw => `<span class="mm-pop-keyword-tag">${kw}</span>`).join('');
      contentHtml += `
        <div class="mm-pop-expandable">
          <button class="mm-pop-expand-btn" data-expand="keywords">
            <span class="mm-pop-expand-icon">▶</span>
            <span>Keywords</span>
          </button>
          <div class="mm-pop-expand-content" data-content="keywords">
            <div class="mm-pop-keywords-container">${keywordsHtml}</div>
          </div>
        </div>
      `;
    }

    contentHtml += `</div>`;

    // If no content available at all
    if (!question && !description && keywords.length === 0) {
      contentHtml = `
        <div class="mm-pop-title">${normalizedText}</div>
        <div class="mm-pop-sub" style="color: var(--text-secondary); font-size: 0.875rem;">No additional information available for this node</div>
      `;
    }

    popoverRef.current.innerHTML = contentHtml;

    // Add event listeners for expandable sections
    const expandButtons = popoverRef.current.querySelectorAll('.mm-pop-expand-btn');
    expandButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const expandType = (btn as HTMLElement).getAttribute('data-expand');
        const content = popoverRef.current?.querySelector(`[data-content="${expandType}"]`);
        const icon = btn.querySelector('.mm-pop-expand-icon');
        
        if (content && icon) {
          const isExpanded = content.classList.contains('expanded');
          if (isExpanded) {
            content.classList.remove('expanded');
            icon.textContent = '▶';
            btn.classList.remove('expanded');
          } else {
            content.classList.add('expanded');
            icon.textContent = '▼';
            btn.classList.add('expanded');
          }
        }
      });
    });
  };

  const showPopover = (anchorEl: Element, nodeKey: string) => {
    if (!popoverRef.current) return;

    currentAnchorRef.current = anchorEl;
    currentNodeKeyRef.current = nodeKey;
    renderPopoverContent(nodeKey);
    popoverRef.current.style.display = 'block';
    popoverRef.current.classList.add('show');
    positionPopover(anchorEl);
  };

  const handleButtonAction = (nodeKey: string, _btnId: string) => {
    // Use refs to get latest values without triggering re-render
    const currentNodeIdToTextMap = nodeIdToTextMapRef.current;
    const currentNodeIdToQuestionMap = nodeIdToQuestionMapRef.current;
    const currentQuestionMap = questionMapRef.current;
    const currentSendMessage = sendMessageRef.current;

    const nodeText = currentNodeIdToTextMap.get(nodeKey) || nodeKey;
    const normalizedText = normalizeContent(nodeText);

    // Get question from nodeId mapping or text mapping
    let question = currentNodeIdToQuestionMap.get(nodeKey);

    if (!question) {
      question = currentQuestionMap.get(normalizedText);
    }

    // If still no question, try to find by matching text
    if (!question) {
      for (const [text, foundQuestion] of currentQuestionMap.entries()) {
        const normalizedKey = normalizeContent(text);
        if (normalizedKey === normalizedText || normalizedText.includes(normalizedKey) || normalizedKey.includes(normalizedText)) {
          question = foundQuestion;
          break;
        }
      }
    }

    if (question && currentSendMessage) {
      // Send the question text to the LLM
      currentSendMessage(question);
      // Optionally close popover after action
      hidePopover();
    } else {
      // Fallback: send a generic message
      sendMessage(`Tell me more about ${normalizedText}`);
      hidePopover();
    }
  };

  // Update the ref whenever handleButtonAction changes (which happens when dependencies change)
  useEffect(() => {
    handleButtonActionRef.current = handleButtonAction;
  }, [nodeIdToTextMap, nodeIdToQuestionMap, questionMap, sendMessage]);

  const scheduleReposition = () => {
    if (!currentAnchorRef.current) return;
    requestAnimationFrame(() => {
      if (currentAnchorRef.current) {
        positionPopover(currentAnchorRef.current);
      }
    });
  };

  useEffect(() => {
    if (svgRef.current) {
      // Reposition popover on pan/zoom
      svgRef.current.addEventListener('wheel', scheduleReposition, { passive: true });
      svgRef.current.addEventListener('mousemove', scheduleReposition);
      svgRef.current.addEventListener('touchmove', scheduleReposition, { passive: true });

      // Also reposition on window resize/scroll
      window.addEventListener('resize', scheduleReposition);
      window.addEventListener('scroll', scheduleReposition, true);

      // Observe transform changes on the main group
      const zoomGroup = svgRef.current.querySelector('g');
      if (zoomGroup) {
        const mo = new MutationObserver(() => scheduleReposition());
        mo.observe(zoomGroup, { attributes: true, attributeFilter: ['transform'] });
      }

      return () => {
        if (svgRef.current) {
          svgRef.current.removeEventListener('wheel', scheduleReposition);
          svgRef.current.removeEventListener('mousemove', scheduleReposition);
          svgRef.current.removeEventListener('touchmove', scheduleReposition);
        }
        window.removeEventListener('resize', scheduleReposition);
        window.removeEventListener('scroll', scheduleReposition);
      };
    }
  }, [markdownData, isLoading]);

  useEffect(() => {
    // Only render markmap if markdownData actually changed
    if (svgRef.current && !isMinimized && markdownData && !isLoading && markdownData !== lastRenderedMarkdownRef.current) {
      console.log('Creating markmap with data length:', markdownData.length);
      lastRenderedMarkdownRef.current = markdownData; // Update ref to track what we rendered
      try {
        const transformer = new Transformer();
        const { root } = transformer.transform(markdownData);
        console.log('Transformed markdown, root:', root);
        console.log('Root children:', root?.children?.length || 0);

        // Assign stable node IDs based on path
        assignIdsByPath(root);

        // Debug: Log root structure to understand its format
        console.log('Root structure sample:', {
          content: root.content,
          nodeId: (root as any).nodeId,
          children: root.children?.length || 0,
          firstChild: root.children?.[0] ? {
            content: root.children[0].content,
            nodeId: (root.children[0] as any).nodeId
          } : null
        });

        // Build node ID to text mapping
        const idToTextMap = buildNodeIdToTextMap(root);
        setNodeIdToTextMap(idToTextMap);

        // Build node ID to question mapping by matching root content to JSON questions
        // Use ref to get latest value without triggering re-render
        const currentContentToQuestionMap = contentToQuestionMapRef.current;
        if (currentContentToQuestionMap.size > 0) {
          const idToQuestionMap = buildNodeIdToQuestionMapFromRoot(root, currentContentToQuestionMap);
          setNodeIdToQuestionMap(idToQuestionMap);
        }

        // Use consistent maximum width across all levels for smooth transitions
        // Dynamic per-level widths caused glitchy animations during expand/collapse
        const CONSISTENT_MAX_WIDTH = 300; // Increased from 200px to accommodate longer text
        const levelWidthMap = new Map<number, number>();

        // Set same width for all levels to ensure smooth animations
        for (let level = 0; level <= 5; level++) {
          levelWidthMap.set(level, CONSISTENT_MAX_WIDTH);
        }

        // Always recreate markmap to ensure maxWidth is applied
        if (markmapRef.current) {
          // Destroy existing instance
          try {
            markmapRef.current.destroy?.();
          } catch (e) {
            // Silently ignore destruction errors
          }
          markmapRef.current = null;
        }

        // Clear SVG
        if (svgRef.current) {
          svgRef.current.innerHTML = '';
        }

        // Function to process foreignObject elements for text wrapping
        // This needs to be accessible to multiple places (addButtons, MutationObserver, etc.)
        // Uses consistent width across all levels for smooth transitions
        const processForeignObjects = () => {
          if (!svgRef.current) return;
          const allForeignObjects = svgRef.current.querySelectorAll('foreignObject');
          if (allForeignObjects.length > 0) {
            allForeignObjects.forEach((fo: any) => {
              // Use consistent width for all levels (prevents glitchy transitions)
              const consistentWidth = CONSISTENT_MAX_WIDTH;

              // CRITICAL: Set width attribute FIRST - this is what markmap uses for layout calculations
              // Using consistent width across all levels for smooth animations
              fo.setAttribute('width', String(consistentWidth));

              const divs = fo.querySelectorAll('div');
              divs.forEach((div: HTMLElement) => {
                div.style.maxWidth = `${consistentWidth}px`; // Consistent width for smooth transitions
                div.style.wordWrap = 'break-word';
                div.style.whiteSpace = 'normal';
                div.style.lineHeight = '1.5'; // Slightly reduced for better spacing
                div.style.textAlign = 'center'; // Center align text including new lines
                div.style.overflow = 'visible';
                div.style.width = 'auto';
                div.style.minWidth = '0';
              });
            });
          }
        };

        // Create new markmap instance with updated maxWidth
        // Inject CSS directly into SVG to override markmap's internal styles
        // This ensures uniform path styling (curved brackets and straight connectors)
        if (svgRef.current) {
          let styleEl = svgRef.current.querySelector('style') as SVGStyleElement | null;
          if (!styleEl) {
            styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style') as SVGStyleElement;
            if (svgRef.current.firstChild) {
              svgRef.current.insertBefore(styleEl, svgRef.current.firstChild);
            } else {
              svgRef.current.appendChild(styleEl);
            }
          }
          if (styleEl) {
            styleEl.textContent = `
            /* Only style curved bracket paths - straight lines use default */
            /* Stroke-width is set dynamically per level in JavaScript */
            .markmap-svg path.markmap-link {
              opacity: 1 !important;
              stroke-opacity: 1 !important;
              fill: none !important;
            }
            /* Allow wider text containers for proper text wrapping */
            .markmap-svg text {
              max-width: none !important;
            }
            .markmap-svg text tspan {
              textLength: none !important;
              lengthAdjust: none !important;
            }
            /* Style foreignObject elements (markmap uses these for text rendering) */
            .markmap-svg foreignObject {
              overflow: visible !important;
            }
            .markmap-svg foreignObject div {
              /* Dynamic width will be set via inline styles per level */
              word-wrap: break-word !important;
              white-space: normal !important;
              line-height: 1.5 !important;
              text-align: center !important;
            }
          `;
          }
        }

        // Use consistent maximum width for smooth animations
        const maxWidthAcrossAllLevels = CONSISTENT_MAX_WIDTH;

        markmapRef.current = Markmap.create(svgRef.current, {
          autoFit: true, // Enable autoFit initially, but we'll control it based on depth
          embedGlobalCSS: false,
          color: (node) => {
            // Color palette: Purple for first level (depth 1), Orange for second, etc.
            // Note: depth 0 is root, depth 1 is first visible level
            const colors = ['#8b5cf6', '#8b5cf6', '#f59e0b', '#10b981', '#10b981', '#ec4899'];
            return colors[node.state?.depth % colors.length || 0];
          },
          paddingX: 16, // Reduced padding to minimize extra space
          duration: 500, // Smooth animation for expand/collapse
          spacingVertical: 20, // Slightly reduced vertical spacing
          spacingHorizontal: 60, // Reduced from 120 to make lines shorter
          initialExpandLevel: 1, // 1=root+first level (show first level children by default so they're visible)
          fitRatio: 0.80, // Reasonable fit ratio for good visibility
          maxWidth: maxWidthAcrossAllLevels, // Dynamic width based on calculated level widths
        }, root);

        // Custom depth-based auto-fit control:
        // - Root (depth 0) and Level 1 (depth 1) expansions: use fit() to zoom/fit properly
        // - Level 2+ (depth >= 2) expansions: smoothly pan to center clicked node + children
        const DEPTH_THRESHOLD = 2; // fit() for depth 0,1. Pan/center for depth >= 2

        // Store the original handleClick method
        const originalHandleClick = (markmapRef.current as any).handleClick?.bind(markmapRef.current);

        // Helper function to smoothly pan to center clicked node using d3-zoom properly
        // IMPORTANT: Uses markmap's internal zoom behavior to keep d3-zoom state in sync
        const panToCenterNode = (node: any) => {
          if (!markmapRef.current || !svgRef.current) return;

          const markmap = markmapRef.current as any;
          const svg = svgRef.current;

          // Get markmap's zoom behavior and svg selection
          const zoom = markmap.zoom;
          const svgSelection = markmap.svg;

          if (!zoom || !svgSelection) {
            console.warn('Markmap zoom or svg selection not available');
            return;
          }

          // Find the DOM element for this node by matching content
          const nodeContent = node.data?.content || node.content || '';
          const allNodes = svg.querySelectorAll('g.markmap-node');

          let nodeElement: Element | null = null;
          for (const el of Array.from(allNodes)) {
            const d3Data = (el as any).__data__;
            const elContent = d3Data?.data?.content || d3Data?.content || '';
            if (elContent && elContent === nodeContent) {
              nodeElement = el;
              break;
            }
          }

          if (!nodeElement) {
            console.warn('Could not find node element for:', nodeContent);
            return;
          }

          // Get the node's current position on screen
          const nodeRect = nodeElement.getBoundingClientRect();
          const svgRect = svg.getBoundingClientRect();

          // Current node center position relative to SVG viewport
          const nodeCurrentX = nodeRect.left - svgRect.left + nodeRect.width / 2;
          const nodeCurrentY = nodeRect.top - svgRect.top + nodeRect.height / 2;

          // Target position: 30% from left (so children on right are visible), vertically centered
          const targetX = svgRect.width * 0.30;
          const targetY = svgRect.height * 0.5;

          // Calculate how much to pan (move view LEFT to bring node LEFT)
          const deltaX = targetX - nodeCurrentX;
          const deltaY = targetY - nodeCurrentY;

          console.log('Panning node to center:', {
            content: nodeContent,
            currentPos: { x: nodeCurrentX, y: nodeCurrentY },
            targetPos: { x: targetX, y: targetY },
            delta: { x: deltaX, y: deltaY }
          });

          try {
            // Use d3-zoom's translateBy to pan by the calculated delta
            // This properly updates d3-zoom's internal state - NO glitch!
            svgSelection
              .transition()
              .duration(600)
              .call(zoom.translateBy, deltaX, deltaY);
          } catch (e) {
            // Silently ignore pan errors
          }
        };

        // Keep autoFit ALWAYS disabled to prevent interference with dragging/panning
        (markmapRef.current as any).options.autoFit = false;

        // Override handleClick to control behavior based on depth
        // - Depth 0 (root) and 1 (level 1): Call fit() after expansion for full view
        // - Depth 2+ (level 2 onwards): Smoothly pan to center clicked node + children
        if (markmapRef.current && originalHandleClick) {
          (markmapRef.current as any).handleClick = async (e: MouseEvent, node: any) => {
            // If no node data, this might be a click on empty space - ignore
            if (!node) {
              return;
            }

            // Get node depth from the node's state
            const depth = node?.state?.depth ?? 0;

            // Check if node is being expanded (currently folded) or collapsed
            const isExpanding = node?.payload?.fold === 1 || node?.payload?.fold === true;

            // Call original click handler first (this triggers markmap's expansion animation)
            await originalHandleClick(e, node);

            // After expansion animation starts, apply appropriate view adjustment
            if (isExpanding) {
              if (depth < DEPTH_THRESHOLD) {
                // For shallow nodes (root, level 1): fit to show all expanded content
                setTimeout(() => {
                  if (markmapRef.current) {
                    markmapRef.current.fit();
                  }
                }, 150);
              } else {
                // For deep nodes (level 2+): smoothly pan to center clicked node + children
                // Wait for markmap to recalculate positions after expansion (300ms)
                setTimeout(() => {
                  panToCenterNode(node);
                }, 300);
              }
            }
          };
        }

        // Do initial fit, then ensure autoFit stays disabled
        setTimeout(() => {
          if (markmapRef.current) {
            markmapRef.current.fit();
            // Ensure autoFit is disabled (it should already be, but just to be safe)
            (markmapRef.current as any).options.autoFit = false;
          }
        }, 100);

        // CRITICAL: Process foreignObjects IMMEDIATELY when they're created
        // This prevents the "one letter per line" issue that causes vertical expansion
        // Use MutationObserver to catch foreignObjects as soon as they're created - NO DELAYS
        const foreignObjectObserver = new MutationObserver((mutations) => {
          // Process immediately for any foreignObject additions (no debounce, no delay)
          mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
              if (node.nodeType === Node.ELEMENT_NODE) {
                const element = node as Element;
                // If this is a foreignObject, process it immediately
                if (element.tagName === 'foreignObject') {
                  // Process this specific foreignObject immediately with consistent width
                  const fo = element as any;
                  fo.setAttribute('width', String(CONSISTENT_MAX_WIDTH)); // Use consistent 300px width
                  const divs = fo.querySelectorAll('div');
                  divs.forEach((div: HTMLElement) => {
                    div.style.maxWidth = `${CONSISTENT_MAX_WIDTH}px`; // Use consistent 300px width
                    div.style.wordWrap = 'break-word';
                    div.style.whiteSpace = 'normal';
                    div.style.lineHeight = '1.5';
                    div.style.textAlign = 'center';
                    div.style.overflow = 'visible';
                    div.style.width = 'auto';
                    div.style.minWidth = '0';
                  });
                } else if (element.querySelector('foreignObject')) {
                  // If container has foreignObjects, process all of them
                  processForeignObjects();
                }
              }
            });
          });
        });

        // Observe the SVG for foreignObject creation - watch immediately
        if (svgRef.current) {
          foreignObjectObserver.observe(svgRef.current, {
            childList: true,
            subtree: true
          });
        }

        // Process any existing foreignObjects immediately
        processForeignObjects();

        // Store observer for cleanup
        (svgRef.current as any)._foreignObjectObserver = foreignObjectObserver;

        // Process foreignObjects after markmap creates them
        setTimeout(() => {
          processForeignObjects();
          // Initial fit is now handled above after markmap creation
        }, 100);


        // Attach click handlers to markmap nodes (using markmap-node class)
        // This function attaches handlers to ALL nodes regardless of depth/level
        // It works for root, level 1, level 2, level 3, and any deeper nesting
        const attachNodeClicks = () => {
          const svg = svgRef.current;
          if (!svg) return;

          // Markmap uses <g class="markmap-node"> for EVERY node at ANY depth
          // querySelectorAll finds ALL of them, not just certain levels
          const nodeEls = svg.querySelectorAll('g.markmap-node');

          nodeEls.forEach((el) => {
            const htmlEl = el as HTMLElement;
            htmlEl.style.cursor = 'pointer';

            // Remove existing handler if any
            if ((el as any)._popoverClickHandler) {
              el.removeEventListener('click', (el as any)._popoverClickHandler);
            }

            const clickHandler = (e: Event) => {
              const target = e.target as Element;

              // Skip if clicking on a circle (expand/collapse circles)
              // Don't show popover when user clicks on circles to expand/collapse nodes
              if (target.tagName === 'circle' || target.closest('circle')) {
                // Allow markmap's default expand/collapse behavior
                return;
              }

              // Skip if clicking on chevron icons
              if (target.closest('.chevron-icon')) {
                return;
              }

              e.stopPropagation();

              // Try to get node data from D3 binding
              const bound = (el as any).__data__;

              // Get node key (prefer nodeId, fallback to content/text)
              const nodeKey =
                bound?.data?.nodeId ||
                bound?.nodeId ||
                bound?.data?.content ||
                el.textContent?.trim() ||
                '';

              if (!nodeKey) {
                console.warn('No node key found for clicked element');
                return;
              }

              // Use refs to get latest values without triggering re-render
              const currentNodeIdToTextMap = nodeIdToTextMapRef.current;
              const currentNodeIdToQuestionMap = nodeIdToQuestionMapRef.current;
              const currentQuestionMap = questionMapRef.current;

              // Check if this node has a question configured
              let nodeText = currentNodeIdToTextMap.get(nodeKey) || nodeKey;
              // Normalize the text (decode HTML entities)
              const normalizedText = normalizeContent(nodeText);

              // Try to get question by nodeId first
              let question = currentNodeIdToQuestionMap.get(nodeKey);

              // If not found, try by normalized text
              if (!question) {
                question = currentQuestionMap.get(normalizedText);
                // If still not found, try matching against all keys
                if (!question) {
                  for (const [key, q] of currentQuestionMap.entries()) {
                    const normalizedKey = normalizeContent(key);
                    if (normalizedKey === normalizedText || normalizedText.includes(normalizedKey) || normalizedKey.includes(normalizedText)) {
                      question = q;
                      break;
                    }
                  }
                }
              }

              // Always show popover, even if no question is found
              // renderPopoverContent will handle displaying appropriate content
              showPopover(el, nodeKey);
            };

            el.addEventListener('click', clickHandler);
            (el as any)._popoverClickHandler = clickHandler;
          });
        };

        // Add clickable buttons around text after render
        // Use a function that can be called multiple times if needed
        const addButtons = () => {
          const svg = svgRef.current;
          if (!svg) {
            return;
          }

          // Find ALL text elements in the SVG - markmap uses nested groups
          // Try multiple selectors to find text elements
          let textElements: NodeListOf<SVGTextElement> | null = null;
          let textElementsArray: SVGTextElement[] = [];

          // Markmap typically structures: g > g > text or g > text
          const selectors = [
            'g > g > text',      // Nested groups
            'g > text',          // Direct child
            'text',               // Any text
            'svg > g > text',     // Direct from svg
            'g[data-depth] text', // With data-depth attribute
            '.markmap-node text'  // With markmap-node class
          ];

          for (const selector of selectors) {
            textElements = svg.querySelectorAll(selector);
            if (textElements.length > 0) {
              textElementsArray = Array.from(textElements);
              break;
            }
          }

          // If still no elements, log the SVG structure for debugging
          if (textElementsArray.length === 0) {
            // Deep inspection - log full structure
            const inspectDeep = (el: Element, depth: number = 0, maxDepth: number = 4): any => {
              if (depth > maxDepth) return { tag: el.tagName, text: '...' };

              const className = (el as SVGElement).className;
              const classStr = typeof className === 'string' ? className : (className?.baseVal || '');
              const result: any = {
                tag: el.tagName,
                class: classStr,
                id: el.id || '',
              };

              // Check for text content directly
              if (el.textContent && el.textContent.trim() && el.children.length === 0) {
                result.text = el.textContent.trim().substring(0, 50);
              }

              // Check for foreignObject
              if (el.tagName === 'foreignObject') {
                result.type = 'foreignObject';
                result.htmlContent = el.innerHTML.substring(0, 200);
              }

              // Recursively inspect children
              if (el.children.length > 0) {
                result.children = Array.from(el.children).slice(0, 5).map(child => inspectDeep(child, depth + 1, maxDepth));
                if (el.children.length > 5) result.moreChildren = el.children.length - 5;
              }

              return result;
            };

            const svgStructure = Array.from(svg.children).map(c => inspectDeep(c, 0, 3));
            console.log('Full SVG structure:', JSON.stringify(svgStructure, null, 2));

            // Try multiple approaches to find text
            const allTexts = svg.getElementsByTagName('text');
            const allForeignObjects = svg.getElementsByTagName('foreignObject');

            // Markmap uses foreignObject to render HTML text inside SVG
            // We need to work with foreignObject elements instead of text elements
            if (allForeignObjects.length > 0) {
              // We'll process foreignObjects - they contain the actual text as HTML
              // Store them for processing (we'll handle them differently)
              const foreignObjectArray = Array.from(allForeignObjects);

              // Find the parent groups that contain foreignObjects
              const groupsWithForeignObjects: { group: Element; foreignObject: Element; text: string }[] = [];

              foreignObjectArray.forEach(fo => {
                const parentGroup = fo.closest('g');
                if (parentGroup) {
                  // Get text content from the HTML inside foreignObject
                  const htmlContent = fo.innerHTML;
                  // Try to extract text from HTML (could be div, span, etc.)
                  const tempDiv = document.createElement('div');
                  tempDiv.innerHTML = htmlContent;
                  const textContent = tempDiv.textContent || tempDiv.innerText || '';

                  if (textContent.trim()) {
                    groupsWithForeignObjects.push({
                      group: parentGroup,
                      foreignObject: fo,
                      text: textContent.trim()
                    });
                  }
                }
              });

              if (groupsWithForeignObjects.length > 0) {
                // We'll process these groups with foreignObjects
                // Store them in a way we can use later
                (window as any).__markmapGroups = groupsWithForeignObjects;
                textElementsArray = []; // Empty for now, we'll handle foreignObjects separately
              } else {
                return;
              }
            } else if (allTexts.length > 0) {
              textElementsArray = Array.from(allTexts);
            } else {
              return;
            }
          }

          // Process foreignObject elements for proper text wrapping (using dedicated function)
          processForeignObjects();

          // Use the array version for processing
          const textArray = textElementsArray.length > 0 ? textElementsArray : (textElements ? Array.from(textElements) : []);

          // Check if we have any text elements to process
          // foreignObjects are handled separately by processForeignObjects()
          if (textArray.length === 0) {
            console.warn('No text elements to process');
            return;
          }

          // Helper function to determine node depth by traversing up the DOM
          const getNodeDepth = (element: Element): number => {
            let depth = 0;
            let current: Element | null = element;
            while (current) {
              const parentElement = current.parentElement;
              if (!parentElement) break;
              // Check if we've reached the SVG root by comparing tagName
              if (parentElement.tagName === 'svg') break;
              if (parentElement.tagName === 'g') {
                depth++;
              }
              current = parentElement as Element;
            }
            return depth;
          };

          textArray.forEach((textEl: SVGTextElement, index: number) => {
            // Find parent group - could be direct parent or grandparent
            let parent: Element | null = textEl.parentElement;
            if (!parent) {
              return;
              return;
            }

            // If parent is not a 'g' element, try to find the group
            if (parent.tagName !== 'g') {
              const closestG = parent.closest('g');
              if (!closestG) {
                console.warn(`Text ${index} has no group parent, skipping`);
                return;
              }
              parent = closestG;
            }

            // Skip if this is a circle label
            if (parent.querySelector('circle')) {
              console.log(`Skipping text ${index} - has circle`);
              return;
            }

            // Get full text content
            const tspans = textEl.querySelectorAll('tspan');
            const fullText = Array.from(tspans).map((t: any) => t.textContent).join(' ').trim() || textEl.textContent?.trim() || '';

            if (!fullText) return;

            // Expand text width by removing textLength constraints
            if (tspans.length > 0) {
              tspans.forEach((tspan: any) => {
                tspan.removeAttribute('textLength');
                tspan.removeAttribute('lengthAdjust');
              });

              // Re-wrap text with wider lines to allow proper sentence wrapping
              // Use a more reasonable character limit per line (60-80 chars for readability)
              if (fullText.length > 0) {
                const words = fullText.split(/\s+/);
                const charsPerLine = 70; // Better line length for readability (approximately 10-15 words)
                let currentLine = '';
                const newTspans: string[] = [];

                words.forEach((word: string) => {
                  const testLine = currentLine ? currentLine + ' ' + word : word;
                  // Break line if it exceeds character limit
                  if (testLine.length > charsPerLine && currentLine) {
                    newTspans.push(currentLine);
                    currentLine = word;
                  } else {
                    currentLine = testLine;
                  }
                });
                if (currentLine) {
                  newTspans.push(currentLine);
                }

                // Apply proper text wrapping
                if (newTspans.length > 0) {
                  textEl.innerHTML = '';
                  newTspans.forEach((line, i) => {
                    const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
                    const x = textEl.getAttribute('x') || '0';
                    tspan.setAttribute('x', x);
                    tspan.setAttribute('dy', i === 0 ? '0' : '1.2em');
                    tspan.textContent = line;
                    // Remove any width constraints
                    tspan.removeAttribute('textLength');
                    tspan.removeAttribute('lengthAdjust');
                    textEl.appendChild(tspan);
                  });
                }
              }
            }

            // Determine depth/level
            const depth = getNodeDepth(textEl);
            const isRoot = depth === 0;
            const isParentLevel = depth <= 1;

            // Minimal, subtle button styling - match markmap's clean aesthetic
            // Use very light, transparent backgrounds that only appear on hover
            const parentColor = 'rgba(139, 92, 246, 0.05)'; // Very light purple, almost transparent
            const childColor = 'rgba(139, 92, 246, 0.03)';  // Even lighter for children
            const buttonColor = isParentLevel ? parentColor : childColor;

            // Remove existing elements
            const existingBox = parent.querySelector('rect.text-bg');
            if (existingBox) existingBox.remove();
            const existingChevron = parent.querySelector('g.chevron-icon');
            if (existingChevron) existingChevron.remove();

            try {
              // Get bounding box
              const bbox = textEl.getBBox();

              // Skip if bbox is invalid
              if (!bbox || bbox.width === 0 || bbox.height === 0) {
                return;
              }

              const padding = 12;
              const chevronSize = 16;
              const chevronSpacing = 8;

              // Create minimal button background - very subtle, only visible on hover
              const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
              rect.setAttribute('class', 'text-bg mindmap-button');
              rect.setAttribute('x', String(bbox.x - padding));
              rect.setAttribute('y', String(bbox.y - padding / 2));
              rect.setAttribute('width', String(bbox.width + padding * 2 + chevronSize + chevronSpacing));
              rect.setAttribute('height', String(bbox.height + padding));
              rect.setAttribute('rx', '8'); // Subtle rounded corners
              rect.setAttribute('ry', '8');
              rect.setAttribute('fill', buttonColor);
              rect.setAttribute('stroke', 'none'); // No border for cleaner look
              rect.setAttribute('stroke-width', '0');
              rect.setAttribute('opacity', '0'); // Start invisible - only show on hover
              rect.setAttribute('pointer-events', 'all');
              rect.style.cursor = 'pointer';
              rect.style.visibility = 'visible';
              rect.style.transition = 'opacity 0.2s ease';

              // Subtle hover effect - light background appears on hover
              rect.addEventListener('mouseenter', () => {
                rect.setAttribute('opacity', '0.15'); // Very light on hover
                rect.setAttribute('fill', 'rgba(139, 92, 246, 0.1)'); // Slightly more visible
              });
              rect.addEventListener('mouseleave', () => {
                rect.setAttribute('opacity', '0'); // Back to invisible
                rect.setAttribute('fill', buttonColor);
              });

              parent.insertBefore(rect, textEl);

              // Use ref to get latest questionMap without triggering re-render
              const currentQuestionMap = questionMapRef.current;

              // Get question for this node (for fallback behavior)
              const question = currentQuestionMap.get(fullText);

              // Try to find node ID from D3 data binding or by matching text
              let nodeId: string | null = null;

              // Method 1: Check if D3 data is bound to the element
              const d3Data = (parent as any).__data__;
              if (d3Data) {
                nodeId = d3Data.data?.nodeId || d3Data.nodeId || null;
              }

              // Method 2: Find node ID by matching text in the map
              if (!nodeId) {
                for (const [id, text] of nodeIdToTextMap.entries()) {
                  if (text === fullText) {
                    nodeId = id;
                    break;
                  }
                }
              }

              // Method 3: Use text as fallback key
              const nodeKey = nodeId || fullText;

              // Add click handler - show popover if question exists
              const clickHandler = (e: MouseEvent) => {
                const target = e.target as Element;

                // Skip if clicking on a circle (expand/collapse circles)
                // Don't show popover when user clicks on circles to expand/collapse nodes
                if (target.tagName === 'circle' || target.closest('circle')) {
                  // Allow markmap's default expand/collapse behavior
                  return;
                }

                // Skip if clicking on chevron icons
                if (target.closest('.chevron-icon')) {
                  return;
                }

                e.stopPropagation();

                // Always show popover, even if no question is found
                // renderPopoverContent will handle displaying appropriate content
                showPopover(parent, nodeKey);
              };

              // Make the entire button group clickable
              (parent as HTMLElement).style.cursor = 'pointer';
              rect.style.cursor = 'pointer';
              parent.addEventListener('click', clickHandler as EventListener);
              rect.addEventListener('click', clickHandler);

              // Store handler for cleanup
              (parent as any)._clickHandler = clickHandler;
              (rect as any)._clickHandler = clickHandler;

              // Add chevron icon
              const chevronGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
              chevronGroup.setAttribute('class', 'chevron-icon');
              (chevronGroup as any).style.cursor = question ? 'pointer' : 'default';

              const chevronX = bbox.x + bbox.width + padding + chevronSpacing;
              const chevronY = bbox.y + bbox.height / 2;

              // Minimal chevron icon - very subtle, only visible on hover
              const chevronPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
              if (isRoot) {
                // Left chevron for root
                chevronPath.setAttribute('d', `M ${chevronX} ${chevronY} L ${chevronX - 6} ${chevronY - 4} L ${chevronX - 6} ${chevronY + 4} Z`);
              } else {
                // Right chevron for others
                chevronPath.setAttribute('d', `M ${chevronX} ${chevronY} L ${chevronX + 6} ${chevronY - 4} L ${chevronX + 6} ${chevronY + 4} Z`);
              }
              chevronPath.setAttribute('fill', 'rgba(100, 116, 139, 0.4)'); // Lighter, more subtle
              chevronPath.setAttribute('stroke', 'none');
              chevronPath.setAttribute('opacity', '0.4'); // Start subtle
              chevronPath.style.transition = 'opacity 0.2s ease';

              // Make chevron more visible on hover
              chevronGroup.addEventListener('mouseenter', () => {
                chevronPath.setAttribute('opacity', '0.7');
              });
              chevronGroup.addEventListener('mouseleave', () => {
                chevronPath.setAttribute('opacity', '0.4');
              });

              chevronGroup.appendChild(chevronPath);
              parent.appendChild(chevronGroup);

              // Keep text styling minimal - match markmap's default
              // Don't force dark color, let markmap's color scheme work
              // Only ensure it's readable
              if (!textEl.getAttribute('fill')) {
                textEl.setAttribute('fill', '#1e293b');
              }
              textEl.style.fontWeight = '500'; // Slightly lighter weight

              console.log(`Button added for text ${index}: "${fullText}" (depth: ${depth}, question: ${question ? 'yes' : 'no'})`);
            } catch (e) {
              console.error(`Error adding button for text ${index}:`, e);
            }
          });

          console.log('Clickable buttons added');

          // Set consistent line colors at each level
          // Level colors - same brightness/color for all lines at each level
          // Note: depth 0 is root, depth 1 is first visible level (user wants this purple)
          const levelColors = [
            '#8b5cf6', // Level 0 (root) - Purple
            '#8b5cf6', // Level 1 (first visible level) - Purple (user requested)
            '#f59e0b', // Level 2 (second level) - Orange/Amber
            '#10b981', // Level 3 (third level) - Green/Teal
            '#10b981', // Level 4 (fourth level) - Green (changed from purple)
            '#ec4899'  // Level 5+ - Pink
          ];

          // Function to apply uniform styling to CURVED BRACKET paths only
          // Straight connector lines will use markmap's default thickness
          const applyUniformPathStyles = () => {
            // Only style paths with markmap-link class (curved bracket paths)
            // This excludes straight connector lines which don't have this class
            const curvedBracketPaths = svg.querySelectorAll('path.markmap-link');
            const styledPaths: Element[] = [];

            // Filter out chevron paths
            curvedBracketPaths.forEach((p: Element) => {
              // Skip chevron paths
              if (p.classList.contains('chevron-icon') || p.closest('.chevron-icon')) {
                return;
              }
              const parent = p.parentElement;
              if (parent && (parent.classList.contains('chevron-icon') || parent.closest('.chevron-icon'))) {
                return;
              }

              // Only include curved bracket paths (markmap-link class)
              styledPaths.push(p);
            });

            styledPaths.forEach((p: any) => {
              // Get D3 link data bound to this path for color and depth determination
              const d = p.__data__;

              let pathColor = levelColors[0];
              let depth = 0;

              if (d && d.source && d.source.data) {
                // Use D3 data if available to get correct color and depth for this level
                // Use target depth (where the path ends) to determine color for the connection
                const sourceNode = d.source.data;
                const targetNode = d.target?.data;
                // Use target depth for color (the level we're connecting TO)
                depth = targetNode?.state?.depth ?? (sourceNode?.state?.depth ?? 0) + 1;
                const levelIndex = Math.min(depth, levelColors.length - 1);
                pathColor = levelColors[levelIndex];
              } else {
                // Fallback: try to determine depth from DOM structure
                const markmapNode = p.closest('.markmap-node');
                if (markmapNode) {
                  let current: Element | null = markmapNode.parentElement;
                  let depthCount = 0;
                  while (current && current !== svg) {
                    if (current.classList.contains('markmap-node')) {
                      depthCount++;
                    }
                    current = current.parentElement;
                  }
                  depth = depthCount;
                  const levelIndex = Math.min(depthCount, levelColors.length - 1);
                  pathColor = levelColors[levelIndex];
                }
              }

              // Calculate stroke-width: reduce by 0.2px for each child level
              // Root (depth 0): 1.8px, Level 1: 1.6px, Level 2: 1.4px, etc.
              // Minimum of 0.4px to ensure visibility
              const baseWidth = 1.8;
              const reductionPerLevel = 0.2;
              const calculatedWidth = Math.max(0.4, baseWidth - (depth * reductionPerLevel));
              const strokeWidth = calculatedWidth.toFixed(1); // Round to 1 decimal place

              // Apply dynamic thickness to curved bracket paths based on depth
              // Straight connector lines are NOT styled here - they use markmap's default
              // Remove ALL existing stroke-related attributes and inline styles
              p.removeAttribute('stroke-width');
              p.removeAttribute('stroke');
              p.removeAttribute('opacity');
              p.removeAttribute('stroke-opacity');
              p.removeAttribute('style');

              // Set attributes with maximum specificity - dynamic width for curved brackets
              p.setAttribute('stroke', pathColor);
              p.setAttribute('stroke-width', strokeWidth);
              p.setAttribute('opacity', '1');
              p.setAttribute('stroke-opacity', '1');
              p.setAttribute('fill', 'none');

              // Force inline styles with !important - this overrides everything
              // Only applies to curved bracket paths (markmap-link class)
              const styleString = `stroke: ${pathColor} !important; stroke-width: ${strokeWidth}px !important; opacity: 1 !important; stroke-opacity: 1 !important; fill: none !important;`;
              p.setAttribute('style', styleString);

              // Also set via style property API as backup
              (p as SVGPathElement).style.cssText = styleString;
            });

            return styledPaths.length;
          };

          // Function to replace circles with right arrows for horizontal tree structure
          // Right arrows should match the color of lines connecting to their children
          const replaceCirclesWithArrows = () => {
            const allCircles = svg.querySelectorAll('circle:not([data-arrow-replaced])');
            const allPaths = svg.querySelectorAll('path.markmap-link');

            if (allCircles.length === 0) return 0;

            // Build a map: for each path, store the source node and its ACTUAL rendered color
            // Key: source node content, Value: actual stroke color of paths FROM that node
            const nodeToOutgoingColor = new Map<string, string>();

            // Also build a map of path elements to their colors for direct lookup
            const pathToColor = new Map<Element, string>();

            allPaths.forEach((path: any) => {
              const d = path.__data__;
              if (d && d.source && d.source.data) {
                const sourceNode = d.source.data;
                const targetNode = d.target?.data;
                // Use target depth for color (the level we're connecting TO)
                const depth = targetNode?.state?.depth ?? (sourceNode?.state?.depth ?? 0) + 1;
                const levelIndex = Math.min(depth, levelColors.length - 1);
                const pathColor = levelColors[levelIndex];

                // Get the actual rendered color from the path element
                const actualColor = path.getAttribute('stroke') ||
                  window.getComputedStyle(path).stroke ||
                  pathColor;

                // Store path to color mapping
                pathToColor.set(path, actualColor);

                // Use the source node's content as the key (normalize for matching)
                const nodeContent = (sourceNode?.content || '').trim();
                if (nodeContent) {
                  // Store the actual color for this source node
                  nodeToOutgoingColor.set(nodeContent, actualColor);
                }
              }
            });

            // Replace each circle with a right arrow for horizontal tree structure
            allCircles.forEach((circle: any) => {
              // Skip if already replaced
              if (circle.hasAttribute('data-arrow-replaced')) return;

              // Find the markmap-node that contains this circle
              const markmapNode = circle.closest('.markmap-node');
              if (!markmapNode) return;

              // Check if arrow already exists for this position
              const existingArrow = markmapNode.querySelector('.markmap-arrow');
              if (existingArrow) {
                circle.remove();
                return;
              }

              try {
                // Get circle position and properties
                const circleBBox = circle.getBBox();
                const cx = circleBBox.x + circleBBox.width / 2;
                const cy = circleBBox.y + circleBBox.height / 2;
                const r = parseFloat(circle.getAttribute('r') || '4');

                // Try to get the node data from D3 binding
                const nodeData = (markmapNode as any).__data__;
                let arrowColor = levelColors[0]; // Default to first level color
                let depth = 0;

                if (nodeData && nodeData.data) {
                  depth = nodeData.data?.state?.depth ?? 0;
                  const nodeContent = (nodeData.data?.content || '').trim();

                  // Method 1: Try to find outgoing paths from this node by content match
                  if (nodeContent && nodeToOutgoingColor.has(nodeContent)) {
                    arrowColor = nodeToOutgoingColor.get(nodeContent)!;
                  } else {
                    // Method 2: Try to find paths where this node is the source
                    for (const path of Array.from(allPaths)) {
                      const d = (path as any).__data__;
                      if (d && d.source && d.source.data) {
                        const sourceContent = (d.source.data?.content || '').trim();
                        if (sourceContent === nodeContent) {
                          const actualPathColor = path.getAttribute('stroke') ||
                            window.getComputedStyle(path).stroke ||
                            levelColors[Math.min(d.source.data?.state?.depth ?? 0, levelColors.length - 1)];
                          arrowColor = actualPathColor;
                          break;
                        }
                      }
                    }

                    // Method 3: Fallback to depth-based color
                    if (arrowColor === levelColors[0]) {
                      const levelIndex = Math.min(depth, levelColors.length - 1);
                      arrowColor = levelColors[levelIndex];
                    }
                  }
                } else {
                  // Fallback: determine depth from DOM structure
                  let current: Element | null = markmapNode.parentElement;
                  let depthCount = 0;
                  while (current && current !== svg) {
                    if (current.classList.contains('markmap-node')) {
                      depthCount++;
                    }
                    current = current.parentElement;
                  }
                  depth = depthCount;
                  const levelIndex = Math.min(depthCount, levelColors.length - 1);
                  arrowColor = levelColors[levelIndex];
                }

                // Create right arrow as a single continuous path (ensures solid line)
                const arrowSize = Math.max(r * 2, 10); // Arrow size - minimum 10px for visibility
                const arrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                arrowPath.setAttribute('class', 'markmap-arrow');

                // Create arrow as single path: horizontal line + arrowhead triangle
                // This ensures it's one continuous solid path
                const lineX1 = cx - arrowSize * 0.3;
                const lineX2 = cx + arrowSize * 0.6;
                const headSize = arrowSize * 0.35;
                const headX = cx + arrowSize * 0.7;

                // Single path: line from left to right, then arrowhead triangle
                const arrowPathData = `M ${lineX1} ${cy} L ${lineX2} ${cy} L ${headX - headSize} ${cy - headSize * 0.5} L ${headX} ${cy} L ${headX - headSize} ${cy + headSize * 0.5} Z`;

                arrowPath.setAttribute('d', arrowPathData);
                arrowPath.setAttribute('stroke', arrowColor);
                arrowPath.setAttribute('stroke-width', '2.5');
                arrowPath.setAttribute('fill', arrowColor);
                arrowPath.setAttribute('stroke-linecap', 'round');
                arrowPath.setAttribute('stroke-linejoin', 'round');

                // Force solid line with explicit style - no dashes
                const arrowStyle = `stroke: ${arrowColor} !important; stroke-width: 2.5px !important; fill: ${arrowColor} !important; stroke-dasharray: none !important; stroke-dashoffset: 0 !important; opacity: 1 !important;`;
                arrowPath.setAttribute('style', arrowStyle);
                (arrowPath as SVGPathElement).style.cssText = arrowStyle;

                // Set via style property as well
                (arrowPath as SVGPathElement).style.setProperty('stroke-dasharray', 'none', 'important');
                (arrowPath as SVGPathElement).style.setProperty('stroke-dashoffset', '0', 'important');

                // Copy click handler from circle to arrow (for expand/collapse)
                // Get the click handler from the circle's parent or the circle itself
                const circleClickHandler = (circle as any).onclick ||
                  (circle.parentElement as any)?.onclick;
                if (circleClickHandler) {
                  arrowPath.onclick = circleClickHandler;
                } else {
                  // Try to find and copy the click handler from D3 data
                  const circleData = (circle as any).__data__;
                  if (circleData) {
                    arrowPath.setAttribute('data-node-id', circleData.id || '');
                  }
                }
                arrowPath.style.cursor = 'pointer';

                // Mark circle as replaced before removing
                circle.setAttribute('data-arrow-replaced', 'true');

                // Insert arrow before circle, then remove circle
                circle.parentNode?.insertBefore(arrowPath, circle);
                circle.remove();
              } catch (e) {
                // Mark as replaced anyway to avoid infinite loops
                circle.setAttribute('data-arrow-replaced', 'true');
              }
            });

            return allCircles.length;
          };

          // Apply styles initially (only to curved bracket paths)
          // Stroke-width reduces by 0.2px per child level (1.8px root, 1.6px level 1, 1.4px level 2, etc.)
          applyUniformPathStyles();

          // Replace circles with arrows immediately and repeatedly
          // Run immediately first
          replaceCirclesWithArrows();

          // Then run after a short delay to catch any circles created during animation
          setTimeout(() => {
            replaceCirclesWithArrows();
          }, 50);

          // Re-apply styles after delays to catch paths added by markmap animations
          // Multiple delays to catch paths added at different times (initial render, animations, node expansions)
          setTimeout(() => {
            applyUniformPathStyles();
            // Replace circles with arrows after paths are styled
            setTimeout(() => {
              replaceCirclesWithArrows();
            }, 10);
          }, 100);

          setTimeout(() => {
            applyUniformPathStyles();
            setTimeout(() => {
              replaceCirclesWithArrows();
            }, 10);
          }, 500);

          setTimeout(() => {
            applyUniformPathStyles();
            setTimeout(() => {
              replaceCirclesWithArrows();
            }, 10);
          }, 1000);

          setTimeout(() => {
            applyUniformPathStyles();
            setTimeout(() => {
              replaceCirclesWithArrows();
            }, 10);
          }, 2000);

          // Set up MutationObserver to continuously enforce uniform styling
          // This catches paths added when nodes expand/collapse
          const pathStyleObserver = new MutationObserver((mutations) => {
            // Check if any foreignObjects were added - process them IMMEDIATELY (no delay)
            let hasNewForeignObjects = false;
            let hasNewCircles = false;

            mutations.forEach((mutation) => {
              mutation.addedNodes.forEach((node) => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                  const element = node as Element;
                  if (element.tagName === 'foreignObject' || element.querySelector('foreignObject')) {
                    hasNewForeignObjects = true;
                  }
                  // Check for new circles
                  if (element.tagName === 'circle' || element.querySelector('circle')) {
                    hasNewCircles = true;
                  }
                }
              });
            });

            // Process foreignObjects IMMEDIATELY if any were added (no debounce for foreignObjects)
            if (hasNewForeignObjects) {
              processForeignObjects();
            }

            // Replace circles immediately if any were added
            if (hasNewCircles) {
              setTimeout(() => {
                replaceCirclesWithArrows();
              }, 10);
            }

            // Debounce path styling to avoid too many calls
            clearTimeout((pathStyleObserver as any)._timeout);
            (pathStyleObserver as any)._timeout = setTimeout(() => {
              applyUniformPathStyles();
              // Replace circles with arrows after paths are styled
              setTimeout(() => {
                replaceCirclesWithArrows();
              }, 10);
            }, 50);
          });

          // Observe the SVG for any changes to paths
          pathStyleObserver.observe(svg, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style', 'stroke', 'stroke-width', 'opacity', 'stroke-opacity']
          });

          // Also periodically check and fix any path styling differences
          // More frequent checks to catch child node paths and new circles
          const styleCheckInterval = setInterval(() => {
            applyUniformPathStyles();
            // Replace circles with arrows after paths are styled
            // Run immediately and after a short delay to catch any new circles
            replaceCirclesWithArrows();
            setTimeout(() => {
              replaceCirclesWithArrows();
            }, 10);
          }, 300); // Check every 300ms to catch new circles quickly

          // Store cleanup function
          (svg as any)._pathStyleCleanup = () => {
            pathStyleObserver.disconnect();
            clearInterval(styleCheckInterval);
          };

          // Don't call fit() here - autoFit: true already handles initial fitting
          // Calling fit() again causes the zooming animation issue
        };

        // Wait for markmap animation (500ms) + buffer, then add buttons
        // Markmap uses D3 which renders asynchronously, so we need to wait longer
        const tryAddButtons = (attempt: number) => {
          processForeignObjects(); // Process foreignObjects first
          addButtons();
          attachNodeClicks(); // Attach popover click handlers

          // If still no elements found and we haven't tried too many times, retry
          if (attempt < 5) {
            setTimeout(() => tryAddButtons(attempt + 1), 500);
          }
        };

        // Start trying after animation completes
        setTimeout(() => tryAddButtons(1), 800);

        // Remove the periodic interval - we're using MutationObserver for immediate processing
        // The interval was causing delayed fixes that created the "one letter per line" then fix issue

        // Set up observer to re-attach handlers when markmap updates (nodes expand/collapse)
        // This ensures ALL nodes get click handlers, even when they're dynamically added
        const setupMarkmapObserver = () => {
          if (!svgRef.current) return;

          // Observe the SVG for changes (when nodes are added/removed)
          const observer = new MutationObserver((mutations) => {
            let shouldReattach = false;

            mutations.forEach((mutation) => {
              // Check if new markmap-node elements were added
              if (mutation.addedNodes.length > 0) {
                mutation.addedNodes.forEach((node) => {
                  if (node.nodeType === Node.ELEMENT_NODE) {
                    const element = node as Element;
                    // Check if this is a markmap-node or contains markmap-nodes
                    if (element.classList?.contains('markmap-node') ||
                      element.querySelector?.('g.markmap-node')) {
                      shouldReattach = true;
                    }
                  }
                });
              }
            });

            // Re-attach handlers if new nodes were added
            if (shouldReattach) {
              console.log('New markmap nodes detected, re-attaching click handlers...');
              setTimeout(() => {
                attachNodeClicks();
              }, 100); // Small delay to ensure DOM is fully updated
            }
          });

          // Observe the SVG for child list changes
          observer.observe(svgRef.current, {
            childList: true,
            subtree: true
          });

          // Also listen to markmap's internal events if available
          if (markmapRef.current) {
            // Markmap might trigger updates, so we'll also check periodically
            // But the MutationObserver should catch most cases
          }

          return () => {
            observer.disconnect();
          };
        };

        // Set up the observer after a short delay to ensure markmap is rendered
        let observerCleanupFn: (() => void) | null = null;
        const observerTimeout = setTimeout(() => {
          const cleanup = setupMarkmapObserver();
          if (cleanup) {
            observerCleanupFn = cleanup;
          }
        }, 1000);

        // Also set up a periodic check to ensure all nodes have handlers
        // This is a fallback in case MutationObserver misses some updates
        const periodicCheckInterval = setInterval(() => {
          if (svgRef.current) {
            const nodeEls = svgRef.current.querySelectorAll('g.markmap-node');
            let nodesWithoutHandlers = 0;
            nodeEls.forEach((el: any) => {
              if (!el._popoverClickHandler) {
                nodesWithoutHandlers++;
              }
            });

            if (nodesWithoutHandlers > 0) {
              console.log(`Found ${nodesWithoutHandlers} nodes without handlers, re-attaching...`);
              attachNodeClicks();
            }
          }
        }, 2000); // Check every 2 seconds

        // Cleanup function
        return () => {
          // Clear timeouts and intervals
          if (observerTimeout) clearTimeout(observerTimeout);
          if (periodicCheckInterval) clearInterval(periodicCheckInterval);
          if (observerCleanupFn) observerCleanupFn();

          // Cleanup foreignObject observer
          if (svgRef.current && (svgRef.current as any)._foreignObjectObserver) {
            (svgRef.current as any)._foreignObjectObserver.disconnect();
            delete (svgRef.current as any)._foreignObjectObserver;
          }

          // Cleanup path style observer
          if (svgRef.current && (svgRef.current as any)._pathStyleCleanup) {
            (svgRef.current as any)._pathStyleCleanup();
            delete (svgRef.current as any)._pathStyleCleanup;
          }

          // Hide popover on cleanup
          hidePopover();

          // Remove click handlers
          if (svgRef.current) {
            // Remove popover click handlers from markmap-node elements
            const nodeEls = svgRef.current.querySelectorAll('g.markmap-node');
            nodeEls.forEach((el: any) => {
              if (el._popoverClickHandler) {
                el.removeEventListener('click', el._popoverClickHandler);
                delete el._popoverClickHandler;
              }
            });

            // Remove old button click handlers
            const textElements = svgRef.current.querySelectorAll('g > text');
            textElements.forEach((textEl: any) => {
              const parent = textEl.parentElement;
              if (parent) {
                if ((parent as any)._clickHandler) {
                  parent.removeEventListener('click', (parent as any)._clickHandler);
                  delete (parent as any)._clickHandler;
                }
                const rect = parent.querySelector('rect.text-bg');
                if (rect && (rect as any)._clickHandler) {
                  rect.removeEventListener('click', (rect as any)._clickHandler);
                  delete (rect as any)._clickHandler;
                }
              }
            });
          }

          if (markmapRef.current) {
            try {
              markmapRef.current.destroy?.();
            } catch (e) {
              console.warn('Error destroying markmap on cleanup:', e);
            }
            markmapRef.current = null;
          }
        };
      } catch (error) {
        console.error('Error creating markmap:', error);
      }
    }
    // Only depend on markdownData, isMinimized, and isLoading for rendering
    // Other dependencies (questionMap, contentToQuestionMap, sendMessage) are used inside but don't trigger re-render
  }, [isMinimized, markdownData, isLoading]);

  useEffect(() => {
    const handleResize = () => {
      if (markmapRef.current) {
        markmapRef.current.fit();
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Re-fit when maximized state changes (panel size changes but window doesn't)
  useEffect(() => {
    if (markmapRef.current) {
      // Small delay to allow CSS transition to complete
      setTimeout(() => {
        if (markmapRef.current) {
          markmapRef.current.fit();
        }
      }, 100);
    }
  }, [isMaximized]);

  const fitToView = () => {
    if (markmapRef.current) {
      // Temporarily allow fit for manual "fit to view" button
      const originalFit = (markmapRef.current as any)._originalFit || markmapRef.current.fit.bind(markmapRef.current);
      originalFit();
    }
  };

  const handleZoomIn = () => {
    if (markmapRef.current && svgRef.current) {
      markmapRef.current.rescale(1.2);
    }
  };

  const handleZoomOut = () => {
    if (markmapRef.current && svgRef.current) {
      markmapRef.current.rescale(0.8);
    }
  };

  const handleDownload = () => {
    if (svgRef.current) {
      const svgData = new XMLSerializer().serializeToString(svgRef.current);
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'mindmap.svg';
      link.click();
      URL.revokeObjectURL(url);
    }
  };

  const handleExpandCollapseAll = () => {
    if (!markmapRef.current) return;

    const markmap = markmapRef.current as any;

    // Helper function to recursively set fold state directly on the data (in-place modification)
    const setFoldRecursive = (node: any, shouldFold: boolean, depth: number = 0): number => {
      if (!node) return 0;

      let nodeCount = 0;

      // Set fold state on this node if it has children
      if (node.children && node.children.length > 0) {
        if (!node.payload) {
          node.payload = {};
        }

        if (shouldFold) {
          // Collapse: set fold to 1 (or true)
          node.payload.fold = 1;
        } else {
          // Expand: DELETE the fold property entirely (not just set to 0)
          delete node.payload.fold;
        }

        nodeCount++;
        console.log(`  ${shouldFold ? 'Folding' : 'Unfolding'} at depth ${depth}, node has ${node.children.length} children`);

        // Recursively process children
        node.children.forEach((child: any) => {
          nodeCount += setFoldRecursive(child, shouldFold, depth + 1);
        });
      }

      return nodeCount;
    };

    console.log('Current isAllExpanded state:', isAllExpanded);

    if (isAllExpanded) {
      // Currently expanded, so collapse
      console.log('Collapsing all nodes');

      if (markmap.state && markmap.state.data) {
        const rootData = markmap.state.data;
        console.log('Root data:', rootData);

        // Collapse all nodes recursively (in-place)
        const count = setFoldRecursive(rootData, true);
        console.log(`Collapsed ${count} nodes`);

        // Force re-render using renderData if available, otherwise setData
        if (typeof markmap.renderData === 'function') {
          console.log('Using renderData()...');
          markmap.renderData();
        } else {
          console.log('Using setData()...');
          markmap.setData(rootData);
        }

        setTimeout(() => {
          if (markmapRef.current) {
            markmapRef.current.fit();
          }
        }, 100);

        // Update state AFTER successful collapse
        setIsAllExpanded(false);
      } else {
        console.error('No markmap state or data available');
      }
    } else {
      // Currently collapsed, so expand
      console.log('Expanding all nodes');

      if (markmap.state && markmap.state.data) {
        const rootData = markmap.state.data;
        console.log('Root data:', rootData);
        console.log('Root has children:', rootData.children?.length || 0);

        // Log current fold states before modification
        console.log('Current root payload:', JSON.stringify(rootData.payload));
        if (rootData.children) {
          rootData.children.forEach((child: any, i: number) => {
            console.log(`  Child ${i} payload:`, JSON.stringify(child.payload));
          });
        }

        // Expand all nodes recursively (in-place, DELETE fold property)
        const count = setFoldRecursive(rootData, false);
        console.log(`Expanded ${count} nodes`);

        // Log fold states after modification
        console.log('After modification - root payload:', JSON.stringify(rootData.payload));

        // Check what methods are available on markmap
        console.log('Markmap methods:', Object.keys(markmap).filter(k => typeof markmap[k] === 'function'));

        // Force re-render using renderData if available
        if (typeof markmap.renderData === 'function') {
          console.log('Using renderData()...');
          markmap.renderData();
        } else {
          console.log('renderData not available, using setData()...');
          // setData with same reference won't trigger update, so we need another approach
          // Try calling the internal render method
          if (typeof markmap.render === 'function') {
            console.log('Using render()...');
            markmap.render();
          } else {
            console.log('Using setData()...');
            markmap.setData(rootData);
          }
        }

        // Fit after a short delay to allow re-render
        setTimeout(() => {
          console.log('Calling fit...');
          if (markmapRef.current) {
            markmapRef.current.fit();
          }
          console.log('Done');
        }, 100);

        // Update state AFTER successful expand
        setIsAllExpanded(true);
      } else {
        console.error('No markmap state or data available');
      }
    }
  };

  if (isMinimized) {
    return (
      <div className="markmap-minimized" onClick={onMinimize}>
        <span>🧠 Mind Map</span>
        <Maximize2 size={16} />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`markmap-panel ${isMaximized ? 'maximized' : ''}`}
    >
      <div className="markmap-header">
        <h2>🧠 Mind Map</h2>
        {/* Only show controls when mindmap is loaded (document uploaded) */}
        {hasUploadedFile && (
          <div className="markmap-controls">
            <button onClick={clearChat} title="Upload New Document" className="markmap-btn upload-new-btn">
              <Upload size={16} stroke="#ffffff" strokeWidth={2.5} style={{ display: 'block' }} />
              <span>New Doc</span>
            </button>
            <button onClick={handleDownload} title="Download as SVG" className="markmap-btn">
              <Download size={20} stroke="#000000" strokeWidth={2.5} style={{ display: 'block' }} />
            </button>
            <button onClick={fitToView} title="Fit to view" className="markmap-btn">
              <Focus size={20} stroke="#000000" strokeWidth={2.5} style={{ display: 'block' }} />
            </button>
            <button onClick={onToggleMaximize} title={isMaximized ? 'Restore' : 'Maximize'} className="markmap-btn">
              {isMaximized
                ? <Minimize2 size={20} stroke="#000000" strokeWidth={2.5} style={{ display: 'block' }} />
                : <Maximize2 size={20} stroke="#000000" strokeWidth={2.5} style={{ display: 'block' }} />}
            </button>
          </div>
        )}
      </div>
      <div ref={contentRef} className="markmap-content">
        {!hasUploadedFile ? (
          /* Show placeholder when no document is uploaded */
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            padding: '2rem',
            boxSizing: 'border-box',
            background: '#ffffff',
            overflow: 'auto'
          }}>
            {/* Title */}
            <h2 style={{
              fontSize: '1.5rem',
              fontWeight: 600,
              color: '#1e3a5f',
              marginBottom: '1.5rem',
              fontFamily: 'system-ui, -apple-system, sans-serif'
            }}>
              Mind map displays here
            </h2>

            {/* Large Decorative mindmap illustration */}
            <div style={{
              position: 'relative',
              width: '100%',
              maxWidth: '700px',
              height: '280px',
              marginBottom: '2rem'
            }}>
              <svg viewBox="0 0 700 280" style={{ width: '100%', height: '100%' }}>
                {/* Center node - larger */}
                <circle cx="350" cy="140" r="14" fill="#64748b" opacity="0.7" />

                {/* Left branches - curved */}
                <path d="M336 140 Q280 140 220 70" stroke="#8b5cf6" strokeWidth="2.5" fill="none" opacity="0.5" />
                <path d="M336 140 Q280 140 220 140" stroke="#8b5cf6" strokeWidth="2.5" fill="none" opacity="0.5" />
                <path d="M336 140 Q280 140 220 210" stroke="#8b5cf6" strokeWidth="2.5" fill="none" opacity="0.5" />

                {/* Left nodes */}
                <rect x="100" y="55" width="120" height="28" rx="6" fill="#c4b5fd" opacity="0.4" />
                <rect x="100" y="125" width="120" height="28" rx="6" fill="#c4b5fd" opacity="0.4" />
                <rect x="120" y="195" width="100" height="28" rx="6" fill="#c4b5fd" opacity="0.4" />

                {/* Right main branches - curved */}
                <path d="M364 140 Q420 140 480 50" stroke="#f59e0b" strokeWidth="2.5" fill="none" opacity="0.6" />
                <path d="M364 140 Q420 140 480 90" stroke="#f59e0b" strokeWidth="2.5" fill="none" opacity="0.6" />
                <path d="M364 140 Q420 140 480 140" stroke="#f59e0b" strokeWidth="2.5" fill="none" opacity="0.6" />
                <path d="M364 140 Q420 140 480 190" stroke="#f59e0b" strokeWidth="2.5" fill="none" opacity="0.6" />
                <path d="M364 140 Q420 140 480 230" stroke="#f59e0b" strokeWidth="2.5" fill="none" opacity="0.6" />

                {/* Right level 1 nodes */}
                <rect x="480" y="38" width="70" height="24" rx="5" fill="#fcd34d" opacity="0.5" />
                <rect x="480" y="78" width="85" height="24" rx="5" fill="#fcd34d" opacity="0.5" />
                <rect x="480" y="128" width="75" height="24" rx="5" fill="#fcd34d" opacity="0.5" />
                <rect x="480" y="178" width="70" height="24" rx="5" fill="#fcd34d" opacity="0.5" />
                <rect x="480" y="218" width="65" height="24" rx="5" fill="#fcd34d" opacity="0.5" />

                {/* Right level 2 branches */}
                <path d="M555 50 L590 30" stroke="#10b981" strokeWidth="2" fill="none" opacity="0.5" />
                <path d="M555 50 L590 55" stroke="#10b981" strokeWidth="2" fill="none" opacity="0.5" />
                <path d="M570 90 L600 75" stroke="#10b981" strokeWidth="2" fill="none" opacity="0.5" />
                <path d="M570 90 L600 100" stroke="#10b981" strokeWidth="2" fill="none" opacity="0.5" />
                <path d="M555 140 L590 130" stroke="#10b981" strokeWidth="2" fill="none" opacity="0.5" />
                <path d="M555 140 L590 150" stroke="#10b981" strokeWidth="2" fill="none" opacity="0.5" />
                <path d="M555 230 L590 215" stroke="#10b981" strokeWidth="2" fill="none" opacity="0.5" />
                <path d="M555 230 L590 245" stroke="#10b981" strokeWidth="2" fill="none" opacity="0.5" />

                {/* Right level 2 nodes */}
                <rect x="590" y="20" width="90" height="20" rx="4" fill="#6ee7b7" opacity="0.45" />
                <rect x="590" y="45" width="100" height="20" rx="4" fill="#6ee7b7" opacity="0.45" />
                <rect x="600" y="65" width="80" height="20" rx="4" fill="#6ee7b7" opacity="0.45" />
                <rect x="600" y="90" width="90" height="20" rx="4" fill="#6ee7b7" opacity="0.45" />
                <rect x="590" y="120" width="85" height="20" rx="4" fill="#6ee7b7" opacity="0.45" />
                <rect x="590" y="142" width="75" height="20" rx="4" fill="#6ee7b7" opacity="0.45" />
                <rect x="590" y="205" width="80" height="20" rx="4" fill="#6ee7b7" opacity="0.45" />
                <rect x="590" y="235" width="70" height="20" rx="4" fill="#6ee7b7" opacity="0.45" />

                {/* Connector dots on right side */}
                <circle cx="480" cy="50" r="5" fill="#f59e0b" opacity="0.6" />
                <circle cx="480" cy="90" r="5" fill="#f59e0b" opacity="0.6" />
                <circle cx="480" cy="140" r="5" fill="#f59e0b" opacity="0.6" />
                <circle cx="480" cy="190" r="5" fill="#f59e0b" opacity="0.6" />
                <circle cx="480" cy="230" r="5" fill="#f59e0b" opacity="0.6" />
              </svg>
            </div>

            {/* Workflow Pipeline */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              flexWrap: 'wrap',
              maxWidth: '900px',
              padding: '0 1rem'
            }}>
              {/* Step 1: Upload */}
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '1rem',
                background: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
                borderRadius: '12px',
                minWidth: '120px'
              }}>
                <div style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '50%',
                  background: '#3b82f6',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                </div>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#1e40af', textAlign: 'center' }}>Upload Doc</span>
              </div>

              {/* Arrow 1 */}
              <svg width="32" height="24" viewBox="0 0 32 24" style={{ flexShrink: 0 }}>
                <path d="M4 12 L24 12 M18 6 L24 12 L18 18" stroke="#94a3b8" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>

              {/* Step 2: Parse */}
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '1rem',
                background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
                borderRadius: '12px',
                minWidth: '120px'
              }}>
                <div style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '50%',
                  background: '#f59e0b',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                </div>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#92400e', textAlign: 'center' }}>Docling Parses</span>
              </div>

              {/* Arrow 2 */}
              <svg width="32" height="24" viewBox="0 0 32 24" style={{ flexShrink: 0 }}>
                <path d="M4 12 L24 12 M18 6 L24 12 L18 18" stroke="#94a3b8" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>

              {/* Step 3: Extract */}
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '1rem',
                background: 'linear-gradient(135deg, #fce7f3 0%, #fbcfe8 100%)',
                borderRadius: '12px',
                minWidth: '120px'
              }}>
                <div style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '50%',
                  background: '#ec4899',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M12 1v6m0 6v6m11-7h-6m-6 0H1" />
                  </svg>
                </div>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#9d174d', textAlign: 'center' }}>LLM Extracts</span>
              </div>

              {/* Arrow 3 */}
              <svg width="32" height="24" viewBox="0 0 32 24" style={{ flexShrink: 0 }}>
                <path d="M4 12 L24 12 M18 6 L24 12 L18 18" stroke="#94a3b8" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>

              {/* Step 4: Visualize */}
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '1rem',
                background: 'linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%)',
                borderRadius: '12px',
                minWidth: '120px'
              }}>
                <div style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '50%',
                  background: '#10b981',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="2" />
                    <path d="M12 2v4m0 12v4M2 12h4m12 0h4" />
                    <path d="M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" />
                  </svg>
                </div>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#065f46', textAlign: 'center' }}>Visualize Map</span>
              </div>
            </div>
          </div>
        ) : isLoading ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: 'var(--text-secondary)'
          }}>
            <p>Loading mindmap data...</p>
          </div>
        ) : !markdownData ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: 'var(--error)'
          }}>
            <p>Error: No mindmap data available. Check console for details.</p>
          </div>
        ) : (
          <>
            <svg ref={svgRef} className="markmap-svg" />

            {/* Expand/Collapse All button - bottom left */}
            <div className="expand-collapse-controls">
              <button
                onClick={handleExpandCollapseAll}
                title={isAllExpanded ? "Collapse All" : "Expand All"}
                className="expand-collapse-btn"
              >
                {isAllExpanded ? (
                  <Shrink
                    size={22}
                    stroke="#000000"
                    strokeWidth={2.5}
                    fill="none"
                    style={{ display: 'block', width: '22px', height: '22px', minWidth: '22px', minHeight: '22px' }}
                  />
                ) : (
                  <Expand
                    size={22}
                    stroke="#000000"
                    strokeWidth={2.5}
                    fill="none"
                    style={{ display: 'block', width: '22px', height: '22px', minWidth: '22px', minHeight: '22px' }}
                  />
                )}
              </button>
            </div>

            {/* Zoom controls - bottom right */}
            <div className="zoom-controls">
              <button onClick={handleZoomIn} title="Zoom In" className="zoom-btn">
                <ZoomIn
                  size={22}
                  stroke="#000000"
                  strokeWidth={2.5}
                  fill="none"
                  style={{ display: 'block', width: '22px', height: '22px', minWidth: '22px', minHeight: '22px' }}
                />
              </button>
              <button onClick={handleZoomOut} title="Zoom Out" className="zoom-btn">
                <ZoomOut
                  size={22}
                  stroke="#000000"
                  strokeWidth={2.5}
                  fill="none"
                  style={{ display: 'block', width: '22px', height: '22px', minWidth: '22px', minHeight: '22px' }}
                />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}