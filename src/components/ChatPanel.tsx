import { useState, useRef, useEffect, Children } from 'react';
import { Send, User, Bot, Eraser, MessageCircle, ArrowRight, FileText, History, Trash2, Clock, ChevronDown, ChevronUp, X } from 'lucide-react';
import { useChat } from '../contexts/ChatContext';
import ReactMarkdown from 'react-markdown';

export default function ChatPanel() {
  const { 
    messages, 
    sendMessage: sendMessageToChat, 
    uploadFile, 
    clearChat, 
    selectedModel, 
    isLoading, 
    hasUploadedFile,
    history,
    selectedHistoryId,
    selectHistoryItem,
    deleteHistoryItem,
  } = useChat();
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(false);
  const [input, setInput] = useState('');
  const [uploadingFile, setUploadingFile] = useState(false);
  const [selectedSource, setSelectedSource] = useState<{ index: number; text: string; score?: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    
    const file = e.target.files[0];
    
    // Validate file type
    const allowedTypes = [
      'application/pdf', 
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'text/markdown'
    ];
    const allowedExtensions = ['.pdf', '.docx', '.txt', '.md'];
    const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
    
    if (!allowedTypes.includes(file.type) && !allowedExtensions.includes(fileExtension)) {
      alert('Please upload only PDF, DOCX, TXT, or MD files.');
      e.target.value = ''; // Reset input
      return;
    }
    
    setUploadingFile(true);
    await uploadFile(file);
    setUploadingFile(false);
    e.target.value = ''; // Reset input
  };

  const sendMessage = async () => {
    if (!input.trim()) return;

    const messageContent = input;
    setInput('');
    
    // Note: sendMessageToChat will add the user message to the messages array
    // So we don't need to add it here to avoid duplicates
    await sendMessageToChat(messageContent, selectedModel);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const handleHistorySelect = async (id: string) => {
    // Don't select if already selected or if loading
    if (isLoading || selectedHistoryId === id) return;
    await selectHistoryItem(id);
  };

  const handleHistoryDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (window.confirm('Are you sure you want to delete this document from history?')) {
      await deleteHistoryItem(id);
    }
  };

  // Function to render content with inline clickable citations
  const renderContentWithCitations = (content: string, sources: any[] | undefined) => {
    if (!sources || sources.length === 0) {
      return (
        <div className="markdown-content">
          <ReactMarkdown>{content}</ReactMarkdown>
        </div>
      );
    }

    // Custom component to handle text with inline citations
    const TextWithCitations = ({ value }: { value: string }) => {
      const parts = value.split(/(\[\d+\])/);
      
      return (
        <>
          {parts.map((part, idx) => {
            const citationMatch = part.match(/^\[(\d+)\]$/);
            
            if (citationMatch) {
              const citationNum = parseInt(citationMatch[1]);
              const source = sources.find(s => s.index === citationNum);
              
              return (
                <span
                  key={idx}
                  className="citation-link"
                  onClick={() => source && setSelectedSource(source)}
                  title={source ? "Click to view source" : "Source not found"}
                >
                  {part}
                </span>
              );
            }
            return <span key={idx}>{part}</span>;
          })}
        </>
      );
    };

    // Helper to process children (handles both strings and elements)
    const processChildren = (children: any): any => {
      return Children.map(children, (child) => {
        if (typeof child === 'string') {
          return <TextWithCitations value={child} />;
        }
        return child;
      });
    };

    return (
      <div className="markdown-content">
        <ReactMarkdown
          components={{
            // Override paragraph rendering
            p: ({ children, ...props }) => {
              if (typeof children === 'string') {
                return <p {...props}><TextWithCitations value={children} /></p>;
              }
              return <p {...props}>{processChildren(children)}</p>;
            },
            // Override list item rendering
            li: ({ children, ...props }) => {
              if (typeof children === 'string') {
                return <li {...props}><TextWithCitations value={children} /></li>;
              }
              return <li {...props}>{processChildren(children)}</li>;
            },
            // Override heading renderings
            h1: ({ children, ...props }) => {
              if (typeof children === 'string') {
                return <h1 {...props}><TextWithCitations value={children} /></h1>;
              }
              return <h1 {...props}>{processChildren(children)}</h1>;
            },
            h2: ({ children, ...props }) => {
              if (typeof children === 'string') {
                return <h2 {...props}><TextWithCitations value={children} /></h2>;
              }
              return <h2 {...props}>{processChildren(children)}</h2>;
            },
            h3: ({ children, ...props }) => {
              if (typeof children === 'string') {
                return <h3 {...props}><TextWithCitations value={children} /></h3>;
              }
              return <h3 {...props}>{processChildren(children)}</h3>;
            },
            h4: ({ children, ...props }) => {
              if (typeof children === 'string') {
                return <h4 {...props}><TextWithCitations value={children} /></h4>;
              }
              return <h4 {...props}>{processChildren(children)}</h4>;
            },
            // Handle strong/bold text
            strong: ({ children, ...props }) => {
              if (typeof children === 'string') {
                return <strong {...props}><TextWithCitations value={children} /></strong>;
              }
              return <strong {...props}>{processChildren(children)}</strong>;
            },
            // Handle text nodes directly
            text: ({ value }: any) => <TextWithCitations value={value} />,
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    );
  };

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <div className="chat-badge">
          <MessageCircle size={14} />
          <span>Chat with Documents</span>
        </div>
      </div>

      <div className="messages-container">
        {messages.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-content">
              <div className="upload-icon-decorative">
                <Bot size={48} strokeWidth={1.5} />
              </div>
              <h3>{history.length > 0 ? 'Select from History' : 'Upload a Document'}</h3>
              <p className="upload-hint-text">{history.length > 0 ? 'or upload a new document' : 'to Begin Chat'}</p>
              <div className="chat-empty-arrow">
                <ArrowRight size={20} />
              </div>
              <div className="chat-empty-features">
                <div className="chat-feature-item">
                  <FileText size={16} />
                  <span>Ask questions about your document</span>
                </div>
                <div className="chat-feature-item">
                  <Bot size={16} />
                  <span>Get AI-powered insights</span>
                </div>
              </div>
            </div>
          </div>
        )}
        {messages.map((message, index) => (
          <div key={index} className={`message ${message.role}`}>
            <div className="message-avatar">
              {message.role === 'user' ? <User size={20} /> : <Bot size={20} />}
            </div>
            <div className="message-content">
              {message.role === 'assistant' ? (
                renderContentWithCitations(message.content, message.sources)
              ) : (
                <p>{message.content}</p>
              )}
              {message.files && message.files.length > 0 && (
                <div className="message-files">
                  {message.files.map((file, i) => (
                    <span key={i} className="file-tag">📎 {file.name}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="message assistant">
            <div className="message-avatar">
              <Bot size={20} />
            </div>
            <div className="message-content">
              <div className="typing-indicator">
                <span></span><span></span><span></span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* History Section - Above input box */}
      <div className="history-section bottom">
        <button 
          className="history-toggle"
          onClick={() => setIsHistoryExpanded(!isHistoryExpanded)}
        >
          <div className="history-toggle-left">
            <History size={16} />
            <span>Document History {history.length > 0 ? `(${history.length})` : ''}</span>
          </div>
          {isHistoryExpanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
        
        {isHistoryExpanded && (
          <div className="history-list">
            {history.length === 0 ? (
              <div className="history-empty">
                <FileText size={20} />
                <span>No documents yet</span>
                <p>Upload a document to start building your history</p>
              </div>
            ) : (
              history.map((item) => (
                <div 
                  key={item.id}
                  className={`history-item ${selectedHistoryId === item.id ? 'selected' : ''}`}
                  onClick={() => handleHistorySelect(item.id)}
                >
                  <div className="history-item-icon">
                    <FileText size={16} />
                  </div>
                  <div className="history-item-content">
                    <span className="history-item-name" title={item.document_name}>
                      {item.document_name}
                    </span>
                    <span className="history-item-date">
                      <Clock size={12} />
                      {formatDate(item.created_at)}
                    </span>
                  </div>
                  <button
                    className="history-item-delete"
                    onClick={(e) => handleHistoryDelete(e, item.id)}
                    title="Delete from history"
                  >
                    <Trash2 size={16} strokeWidth={2.5} />
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <div className="input-container">
        <div className="input-row">
          <button 
            className="icon-btn clear-btn"
            onClick={clearChat}
            title="Clear chat and start fresh"
            disabled={isLoading || uploadingFile || (!hasUploadedFile && messages.length === 0)}
          >
            <Eraser size={24} strokeWidth={2.5} />
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
            hidden
          />
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={hasUploadedFile ? "Type a message..." : "Upload a doc first"}
            rows={1}
            disabled={!hasUploadedFile && messages.length === 0}
          />
          <button 
            className="send-btn"
            onClick={sendMessage}
            disabled={isLoading || !input.trim() || (!hasUploadedFile && messages.length === 0)}
            title={(!hasUploadedFile && messages.length === 0) ? "Upload a document first" : "Send message"}
          >
            <Send size={24} strokeWidth={2.5} />
          </button>
        </div>
      </div>

      {/* Source Modal */}
      {selectedSource && (
        <div className="source-modal-overlay" onClick={() => setSelectedSource(null)}>
          <div className="source-modal" onClick={(e) => e.stopPropagation()}>
            <div className="source-modal-header">
              <h3>Source [{selectedSource.index}]</h3>
              <button className="source-modal-close" onClick={() => setSelectedSource(null)} title="Close">
                <X size={20} />
              </button>
            </div>
            <div className="source-modal-content">
              <p>{selectedSource.text}</p>
              {selectedSource.score && (
                <div className="source-modal-score">
                  Relevance Score: {(selectedSource.score * 10).toFixed(1)}%
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
